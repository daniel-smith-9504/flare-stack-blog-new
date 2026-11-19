import { eq } from "drizzle-orm";
import {
  createAdminTestContext,
  createAuthTestContext,
  createMockSession,
  seedUser,
} from "tests/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CommentService from "@/features/comments/comments.service";
import * as PostService from "@/features/posts/services/posts.service";
import { PageViewsTable, PostsTable } from "@/lib/db/schema";
import { unwrap } from "@/lib/errors";

/**
 * The Admin list's two numbers per Post: published Comments and the views of
 * the last 30 days, and the sorts by each.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

describe("Admin post list metrics", () => {
  let adminContext: ReturnType<typeof createAdminTestContext>;
  let userContext: ReturnType<typeof createAuthTestContext>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    adminContext = createAdminTestContext();
    await seedUser(adminContext.db, adminContext.session.user);
    const userSession = createMockSession({
      user: {
        id: "user-1",
        name: "Test User",
        email: "user@example.com",
        role: null,
      },
    });
    userContext = createAuthTestContext({ session: userSession });
    await seedUser(userContext.db, userSession.user);
  });

  async function createPost(title: string, publish: boolean) {
    const { id } = await PostService.createEmptyPost(adminContext);
    unwrap(
      await PostService.updatePost(adminContext, {
        id,
        data: { title, slug: `${title}-${id}` },
      }),
    );
    if (publish) unwrap(await PostService.publishPost(adminContext, { id }));
    return id;
  }

  async function publicSlugOf(postId: number) {
    const [row] = await adminContext.db
      .select({ slug: PostsTable.publicSlug })
      .from(PostsTable)
      .where(eq(PostsTable.id, postId));
    if (!row?.slug) throw new Error(`Post ${postId} has no public slug`);
    return row.slug;
  }

  /** A page view of a Post, recorded as one of its visitors would. */
  async function view(postId: number, createdAt = new Date()) {
    const slug = await publicSlugOf(postId);
    await adminContext.db.insert(PageViewsTable).values({
      path: `/post/${encodeURIComponent(slug)}`,
      postSlug: slug,
      visitorId: `anon:${crypto.randomUUID()}`,
      device: "desktop",
      createdAt,
    });
  }

  async function comment(postId: number, content: string) {
    return unwrap(
      await CommentService.createComment(userContext, { postId, content }),
    );
  }

  const list = (input: Parameters<typeof PostService.listAdminPostsPage>[1]) =>
    PostService.listAdminPostsPage(adminContext, input);

  describe("commentCount", () => {
    it("counts the published Comments and replies of each Post, not deleted ones", async () => {
      const busy = await createPost("busy", true);
      const quiet = await createPost("quiet", true);
      const draft = await createPost("draft", false);
      const root = await comment(busy, "root");
      unwrap(
        await CommentService.createComment(userContext, {
          postId: busy,
          content: "reply",
          rootId: root.id,
          replyToCommentId: root.id,
        }),
      );
      const deleted = await comment(busy, "deleted");
      unwrap(
        await CommentService.deleteComment(userContext, { id: deleted.id }),
      );
      await comment(quiet, "one");

      const page = await list({});
      const counts = new Map(
        page.items.map((item) => [item.id, item.commentCount]),
      );
      expect(counts.get(busy)).toBe(2);
      expect(counts.get(quiet)).toBe(1);
      expect(counts.get(draft)).toBe(0);
    });

    it("is read only when asked for, so other readers of the Posts pay nothing for it", async () => {
      const id = await createPost("counted", true);
      await comment(id, "one");

      const plain = await PostService.getPosts(adminContext, {});
      expect(plain.map((row) => "commentCount" in row)).not.toContain(true);
      const asked = await PostService.getPosts(
        adminContext,
        {},
        { includeCommentCount: true },
      );
      expect(asked.find((row) => row.id === id)?.commentCount).toBe(1);
    });

    it("sorts by it in both directions, ties by id in that direction", async () => {
      const none = await createPost("none", true);
      const one = await createPost("one", true);
      const two = await createPost("two", true);
      const alsoOne = await createPost("also-one", true);
      await comment(one, "a");
      await comment(alsoOne, "b");
      await comment(two, "c");
      await comment(two, "d");

      const desc = await list({ sortBy: "commentCount", sortDir: "DESC" });
      expect(desc.items.map((item) => item.id)).toEqual([
        two,
        alsoOne,
        one,
        none,
      ]);
      const asc = await list({ sortBy: "commentCount", sortDir: "ASC" });
      expect(asc.items.map((item) => item.id)).toEqual([
        none,
        one,
        alsoOne,
        two,
      ]);
    });

    it("keeps paging stable and honours the filters while sorting by it", async () => {
      const first = await createPost("first", true);
      const second = await createPost("second", true);
      const draft = await createPost("draft", false);
      await comment(first, "a");
      await comment(second, "b");
      await comment(second, "c");

      const published = await list({
        sortBy: "commentCount",
        status: "published",
        limit: 1,
        offset: 0,
      });
      const next = await list({
        sortBy: "commentCount",
        status: "published",
        limit: 1,
        offset: 1,
      });
      expect(published.total).toBe(2);
      expect(published.items.map((item) => item.id)).toEqual([second]);
      expect(next.items.map((item) => item.id)).toEqual([first]);
      expect(draft).not.toBe(first);
    });
  });

  describe("viewCount", () => {
    it("counts views recorded today, not a daily snapshot", async () => {
      const id = await createPost("published", true);
      await view(id);
      await view(id);

      const page = await list({});
      expect(page.popularity).toBe("ready");
      expect(page.items.find((item) => item.id === id)?.viewCount).toBe(2);
    });

    it("is 0 for a published Post without views, absent for a draft", async () => {
      const viewed = await createPost("viewed", true);
      const unseen = await createPost("unseen", true);
      const draft = await createPost("draft", false);
      await view(viewed);

      const page = await list({});
      const views = new Map(
        page.items.map((item) => [item.id, item.viewCount]),
      );
      expect(views.get(viewed)).toBe(1);
      expect(views.get(unseen)).toBe(0);
      expect(views.has(draft)).toBe(true);
      expect(views.get(draft)).toBeUndefined();
    });

    it("counts only the last 30 days", async () => {
      const id = await createPost("old", true);
      await view(id, new Date(Date.now() - 31 * DAY_MS));

      const page = await list({});
      expect(page.items.find((item) => item.id === id)?.viewCount).toBe(0);
    });

    it("sorts by it in both directions, drafts and unseen Posts last, ties by id", async () => {
      const low = await createPost("low", true);
      const high = await createPost("high", true);
      const unseen = await createPost("unseen", true);
      const draft = await createPost("draft", false);
      for (let i = 0; i < 3; i++) await view(low);
      for (let i = 0; i < 9; i++) await view(high);

      const desc = await list({ sortBy: "viewCount", sortDir: "DESC" });
      expect(desc.items.map((item) => item.id)).toEqual([
        high,
        low,
        draft,
        unseen,
      ]);
      const asc = await list({ sortBy: "viewCount", sortDir: "ASC" });
      expect(asc.items.map((item) => item.id)).toEqual([
        unseen,
        draft,
        low,
        high,
      ]);
    });

    it("pages by views and keeps the filters, the total and the Category and Tags", async () => {
      const ids = [];
      for (const title of ["a", "b", "c", "d"])
        ids.push(await createPost(title, true));
      const draft = await createPost("draft", false);
      for (const [index, id] of ids.entries()) {
        for (let i = 0; i <= index; i++) await view(id);
      }

      const first = await list({
        sortBy: "viewCount",
        status: "published",
        limit: 3,
        offset: 0,
      });
      const second = await list({
        sortBy: "viewCount",
        status: "published",
        limit: 3,
        offset: 3,
      });
      expect(first.total).toBe(4);
      expect(first.items.map((item) => item.id)).toEqual([
        ids[3],
        ids[2],
        ids[1],
      ]);
      expect(second.items.map((item) => item.id)).toEqual([ids[0]]);
      expect(second.items[0]).toMatchObject({ tags: [], category: null });
      expect([...first.items, ...second.items].map((i) => i.id)).not.toContain(
        draft,
      );
    });
  });
});
