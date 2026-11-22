import { and, count, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { AnalyticsReport } from "@/features/analytics/analytics.schema";
import type {
  PostPopularityDailyViews,
  PostPopularityMetric,
} from "@/features/post-popularity/post-popularity";
import type { DB } from "@/lib/db";
import { PageViewsTable, PostsTable } from "@/lib/db/schema";
import type { PageViewDevice } from "@/lib/db/schema";

const DAY_SECONDS = 86_400;
const LIST_LIMIT = 10;

/**
 * The UTC day a row falls in, as an epoch day. CAST matters: the divisor is a
 * bound parameter, so a bare `/` would divide as REAL and never match a day.
 */
const dayBucket = sql<number>`cast(${PageViewsTable.createdAt} / ${DAY_SECONDS} as integer)`;

export type PageViewRow = {
  path: string;
  postSlug: string | null;
  /** Set for a novel read page, for the reading report. */
  novelId?: number | null;
  novelChapter?: number | null;
  visitorId: string;
  country: string | null;
  region: string | null;
  city: string | null;
  referrerHost: string | null;
  device: PageViewDevice;
};

export async function insertPageView(db: DB, view: PageViewRow): Promise<void> {
  await db.insert(PageViewsTable).values(view);
}

/** Path totals of a window, the shape post popularity ranks from. */
export async function countPathMetrics(
  db: DB,
  window: { since: Date; until: Date },
): Promise<PostPopularityMetric[]> {
  const rows = await db
    .select({ path: PageViewsTable.path, pageviews: count() })
    .from(PageViewsTable)
    .where(
      and(
        gte(PageViewsTable.createdAt, window.since),
        lt(PageViewsTable.createdAt, window.until),
      ),
    )
    .groupBy(PageViewsTable.path);
  return rows.map((row) => ({
    path: row.path,
    pageviews: row.pageviews,
  }));
}

/** Views per Post slug of a window, the Admin list's live counts. */
export async function countPostSlugViews(
  db: DB,
  window: { since: Date; until: Date },
): Promise<Array<{ slug: string; views: number }>> {
  const rows = await db
    .select({ slug: PageViewsTable.postSlug, views: count() })
    .from(PageViewsTable)
    .where(
      and(
        gte(PageViewsTable.createdAt, window.since),
        lt(PageViewsTable.createdAt, window.until),
        isNotNull(PageViewsTable.postSlug),
      ),
    )
    .groupBy(PageViewsTable.postSlug);
  return rows.flatMap((row) =>
    row.slug ? [{ slug: row.slug, views: row.views }] : [],
  );
}

/** Site-wide views per UTC day, oldest first. */
export async function countDailyViews(
  db: DB,
  window: { since: Date; until: Date },
): Promise<PostPopularityDailyViews[]> {
  const rows = await db
    .select({ day: dayBucket, views: count() })
    .from(PageViewsTable)
    .where(
      and(
        gte(PageViewsTable.createdAt, window.since),
        lt(PageViewsTable.createdAt, window.until),
      ),
    )
    .groupBy(dayBucket)
    .orderBy(dayBucket);
  return rows.map((row) => ({
    day: Number(row.day) * DAY_SECONDS * 1000,
    views: row.views,
  }));
}

/**
 * The published Posts with the most views in the window, most viewed first.
 * Ties go to the newer Post.
 */
export async function listTopPostsByViews(
  db: DB,
  window: { since: Date; until: Date },
  limit: number,
): Promise<Array<{ postId: number; views: number }>> {
  const rows = await db
    .select({ postId: PostsTable.id, views: count() })
    .from(PageViewsTable)
    .innerJoin(PostsTable, eq(PostsTable.publicSlug, PageViewsTable.postSlug))
    .where(
      and(
        gte(PageViewsTable.createdAt, window.since),
        lt(PageViewsTable.createdAt, window.until),
        isNotNull(PageViewsTable.postSlug),
      ),
    )
    .groupBy(PostsTable.id)
    .orderBy(desc(count()), desc(PostsTable.id))
    .limit(limit);
  return rows.map((row) => ({ postId: row.postId, views: row.views }));
}

/**
 * Everything the Admin analytics page shows, in one read per breakdown. The
 * window is rolling: the last `days` days up to now.
 */
export async function readAnalyticsReport(
  db: DB,
  window: { since: Date; until: Date },
  rangeDays: number,
  generatedAt: number,
): Promise<AnalyticsReport> {
  const inWindow = and(
    gte(PageViewsTable.createdAt, window.since),
    lt(PageViewsTable.createdAt, window.until),
  );
  const publicTitle = sql<
    string | null
  >`json_extract(${PostsTable.publicSnapshotJson}, '$.title')`;

  const country = PageViewsTable.country;
  const region = PageViewsTable.region;
  const city = PageViewsTable.city;

  const [
    summaryRows,
    daily,
    topPages,
    topPosts,
    referrers,
    countries,
    regions,
    cities,
    devices,
  ] = await Promise.all([
    db
      .select({
        views: count(),
        visitors: sql<number>`count(distinct ${PageViewsTable.visitorId})`,
      })
      .from(PageViewsTable)
      .where(inWindow),
    db
      .select({ day: dayBucket, views: count() })
      .from(PageViewsTable)
      .where(inWindow)
      .groupBy(dayBucket)
      .orderBy(dayBucket),
    db
      .select({ path: PageViewsTable.path, views: count() })
      .from(PageViewsTable)
      .where(inWindow)
      .groupBy(PageViewsTable.path)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({
        id: PostsTable.id,
        title: publicTitle,
        slug: PostsTable.publicSlug,
        views: count(),
      })
      .from(PageViewsTable)
      .innerJoin(PostsTable, eq(PostsTable.publicSlug, PageViewsTable.postSlug))
      .where(and(inWindow, isNotNull(PostsTable.publicSnapshotJson)))
      .groupBy(PostsTable.id, PostsTable.publicSlug, publicTitle)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({ host: PageViewsTable.referrerHost, views: count() })
      .from(PageViewsTable)
      .where(and(inWindow, isNotNull(PageViewsTable.referrerHost)))
      .groupBy(PageViewsTable.referrerHost)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({ country, views: count() })
      .from(PageViewsTable)
      .where(and(inWindow, isNotNull(country)))
      .groupBy(country)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({ country, region, views: count() })
      .from(PageViewsTable)
      .where(and(inWindow, isNotNull(region)))
      .groupBy(country, region)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({ country, region, city, views: count() })
      .from(PageViewsTable)
      .where(and(inWindow, isNotNull(city)))
      .groupBy(country, region, city)
      .orderBy(desc(count()))
      .limit(LIST_LIMIT),
    db
      .select({ device: PageViewsTable.device, views: count() })
      .from(PageViewsTable)
      .where(inWindow)
      .groupBy(PageViewsTable.device)
      .orderBy(desc(count())),
  ]);

  const summary = summaryRows[0] ?? { views: 0, visitors: 0 };

  return {
    rangeDays,
    generatedAt,
    summary: { views: summary.views, visitors: Number(summary.visitors) },
    daily: daily.map((row) => ({
      day: Number(row.day) * DAY_SECONDS * 1000,
      views: row.views,
    })),
    topPages,
    topPosts: topPosts.flatMap((row) =>
      row.slug
        ? [
            {
              id: row.id,
              title: row.title ?? row.slug,
              slug: row.slug,
              views: row.views,
            },
          ]
        : [],
    ),
    referrers: referrers.flatMap((row) =>
      row.host ? [{ host: row.host, views: row.views }] : [],
    ),
    countries: countries.flatMap((row) =>
      row.country ? [{ country: row.country, views: row.views }] : [],
    ),
    regions: regions.flatMap((row) =>
      row.country && row.region
        ? [{ country: row.country, region: row.region, views: row.views }]
        : [],
    ),
    cities: cities.flatMap((row) =>
      row.country && row.city
        ? [
            {
              country: row.country,
              region: row.region,
              city: row.city,
              views: row.views,
            },
          ]
        : [],
    ),
    devices,
  };
}
