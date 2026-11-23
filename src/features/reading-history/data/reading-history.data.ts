import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import {
  NovelProgressTable,
  NovelReadingDailyTable,
  NovelsTable,
  PageViewsTable,
  PostsTable,
} from "@/lib/db/schema";

/** How the page-view collector names a signed-in visitor. */
export function visitorIdOf(userId: string) {
  return `user:${userId}`;
}

const readPostsFrom = (db: DB, visitorId: string) =>
  db
    .select({
      id: PostsTable.id,
      title: sql<string>`coalesce(json_extract(${PostsTable.publicSnapshotJson}, '$.title'), ${PostsTable.title})`,
      slug: sql<string>`coalesce(${PostsTable.publicSlug}, '')`,
      lastReadAt: sql<number>`max(${PageViewsTable.createdAt})`,
    })
    .from(PageViewsTable)
    .innerJoin(PostsTable, eq(PostsTable.publicSlug, PageViewsTable.postSlug))
    .where(
      and(
        eq(PageViewsTable.visitorId, visitorId),
        isNotNull(PageViewsTable.postSlug),
        eq(PostsTable.status, "published"),
        isNotNull(PostsTable.publicSlug),
      ),
    )
    .groupBy(PostsTable.id);

export async function listReadPosts(db: DB, userId: string, limit: number) {
  return readPostsFrom(db, visitorIdOf(userId))
    .orderBy(desc(sql`max(${PageViewsTable.createdAt})`))
    .limit(limit);
}

export async function countReadPosts(db: DB, userId: string) {
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${PostsTable.id})` })
    .from(PageViewsTable)
    .innerJoin(PostsTable, eq(PostsTable.publicSlug, PageViewsTable.postSlug))
    .where(
      and(
        eq(PageViewsTable.visitorId, visitorIdOf(userId)),
        isNotNull(PageViewsTable.postSlug),
        eq(PostsTable.status, "published"),
        isNotNull(PostsTable.publicSlug),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function listReadNovels(db: DB, userId: string, limit: number) {
  const visitorId = visitorIdOf(userId);
  const rows = await db
    .select({
      id: NovelsTable.id,
      title: NovelsTable.title,
      author: NovelsTable.author,
      chapterCount: NovelsTable.chapterCount,
      lastReadAt: sql<number>`max(${PageViewsTable.createdAt})`,
    })
    .from(PageViewsTable)
    .innerJoin(NovelsTable, eq(NovelsTable.id, PageViewsTable.novelId))
    .where(
      and(
        eq(PageViewsTable.visitorId, visitorId),
        isNotNull(PageViewsTable.novelId),
      ),
    )
    .groupBy(NovelsTable.id)
    .orderBy(desc(sql`max(${PageViewsTable.createdAt})`))
    .limit(limit);

  const progress = await db
    .select({
      novelId: NovelProgressTable.novelId,
      chapterOrder: NovelProgressTable.chapterOrder,
    })
    .from(NovelProgressTable)
    .where(eq(NovelProgressTable.userId, userId));
  const at = new Map(progress.map((row) => [row.novelId, row.chapterOrder]));
  return rows.map((row) => ({
    ...row,
    chapterOrder: at.get(row.id) ?? 1,
  }));
}

export async function countReadNovels(db: DB, userId: string) {
  const [row] = await db
    .select({ total: sql<number>`count(distinct ${NovelsTable.id})` })
    .from(PageViewsTable)
    .innerJoin(NovelsTable, eq(NovelsTable.id, PageViewsTable.novelId))
    .where(
      and(
        eq(PageViewsTable.visitorId, visitorIdOf(userId)),
        isNotNull(PageViewsTable.novelId),
      ),
    );
  return Number(row?.total ?? 0);
}

export async function totalReadingSeconds(db: DB, userId: string) {
  const [row] = await db
    .select({
      seconds: sql<number>`coalesce(sum(${NovelReadingDailyTable.seconds}), 0)`,
    })
    .from(NovelReadingDailyTable)
    .where(eq(NovelReadingDailyTable.userId, userId));
  return Number(row?.seconds ?? 0);
}
