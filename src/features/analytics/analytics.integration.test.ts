import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { listTopPostsByViews } from "@/features/analytics/data/analytics.data";
import { getAnalyticsReport } from "@/features/analytics/service/analytics.service";
import { getDb } from "@/lib/db";
import { PageViewsTable, PostsTable } from "@/lib/db/schema";

const db = getDb(env);

async function visit(overrides: Partial<typeof PageViewsTable.$inferInsert>) {
  await db.insert(PageViewsTable).values({
    path: "/posts",
    visitorId: "anon:5f0c8f4e-1f0a-4c4e-9a63-0f4f2b5d9c11",
    device: "desktop",
    ...overrides,
  });
}

const report = () =>
  getAnalyticsReport({ db } as Parameters<typeof getAnalyticsReport>[0], {
    days: 7,
  });

describe("Site analytics", () => {
  beforeEach(async () => {
    await db.delete(PageViewsTable);
  });

  it("counts views once per visitor and splits the breakdowns", async () => {
    await visit({
      path: "/posts",
      visitorId: "anon:11111111-1111-4111-8111-111111111111",
      country: "CN",
      region: "Sichuan",
      city: "Chengdu",
      referrerHost: "news.ycombinator.com",
      device: "mobile",
    });
    await visit({
      path: "/posts",
      visitorId: "anon:11111111-1111-4111-8111-111111111111",
      device: "mobile",
    });
    await visit({
      path: "/post/alpha",
      postSlug: "alpha",
      visitorId: "user:admin-user-id",
      device: "desktop",
    });

    const data = await report();

    expect(data.summary).toEqual({ views: 3, visitors: 2 });
    expect(data.topPages[0]).toEqual({ path: "/posts", views: 2 });
    expect(data.devices).toEqual([
      { device: "mobile", views: 2 },
      { device: "desktop", views: 1 },
    ]);
    expect(data.countries).toEqual([{ country: "CN", views: 1 }]);
    expect(data.cities).toEqual([
      { country: "CN", region: "Sichuan", city: "Chengdu", views: 1 },
    ]);
    expect(data.referrers).toEqual([
      { host: "news.ycombinator.com", views: 1 },
    ]);
    expect(data.daily.at(-1)?.views).toBe(3);
    expect(data.daily.length).toBeGreaterThanOrEqual(7);
  });

  it("names the Posts a view belongs to", async () => {
    await db.insert(PostsTable).values({
      title: "Alpha",
      slug: "alpha",
      status: "published",
      publicSlug: "alpha",
      publishedAt: new Date(),
      publicSnapshotJson: {
        title: "Alpha",
        summary: null,
        slug: "alpha",
        contentJson: null,
        tagIds: [],
        categoryId: null,
        publishedAt: new Date().toISOString(),
        cover: null,
      },
    });
    await visit({
      path: "/post/alpha",
      postSlug: "alpha",
      visitorId: "anon:22222222-2222-4222-8222-222222222222",
    });

    const data = await report();

    expect(data.topPosts).toHaveLength(1);
    expect(data.topPosts[0]).toMatchObject({
      title: "Alpha",
      slug: "alpha",
      views: 1,
    });
  });

  it("leaves the window empty when nothing was recorded", async () => {
    const data = await report();

    expect(data.summary).toEqual({ views: 0, visitors: 0 });
    expect(data.topPages).toEqual([]);
    expect(data.daily.every((point) => point.views === 0)).toBe(true);
  });

  it("ranks published Posts by views, newest first on a tie, drafts aside", async () => {
    const ids: number[] = [];
    for (const slug of ["alpha", "beta", "gamma"]) {
      const [row] = await db
        .insert(PostsTable)
        .values({
          title: slug,
          slug,
          status: "published",
          publicSlug: slug,
          publishedAt: new Date(),
          publicSnapshotJson: {
            title: slug,
            summary: null,
            slug,
            contentJson: null,
            tagIds: [],
            categoryId: null,
            publishedAt: new Date().toISOString(),
            cover: null,
          },
        })
        .returning({ id: PostsTable.id });
      ids.push(row!.id);
    }
    await db.insert(PostsTable).values({
      title: "draft",
      slug: "draft",
      status: "draft",
    });

    const times = { alpha: 1, beta: 3, gamma: 3, draft: 9 } as const;
    for (const [postSlug, count] of Object.entries(times)) {
      for (let i = 0; i < count; i++) {
        await visit({ path: `/post/${postSlug}`, postSlug });
      }
    }

    const top = await listTopPostsByViews(
      db,
      {
        since: new Date(Date.now() - 60_000),
        until: new Date(Date.now() + 60_000),
      },
      10,
    );

    expect(top).toEqual([
      { postId: ids[2], views: 3 },
      { postId: ids[1], views: 3 },
      { postId: ids[0], views: 1 },
    ]);
  });
});
