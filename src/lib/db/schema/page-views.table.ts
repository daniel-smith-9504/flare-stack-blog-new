import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, id } from "./helper";

export const PAGE_VIEW_DEVICES = ["desktop", "mobile", "tablet"] as const;

export const PageViewsTable = sqliteTable(
  "page_views",
  {
    id,
    /** The public pathname, normalized: no query, no trailing slash. */
    path: text().notNull(),
    /** Set when the path is a Post page, for the per-Post totals. */
    postSlug: text("post_slug"),
    /** Set when the path is a novel page, for the reading report. */
    novelId: integer("novel_id"),
    /** Set when the path is a novel chapter, for the per-chapter heat. */
    novelChapter: integer("novel_chapter"),
    /**
     * Who viewed: `user:<id>` signed in, `anon:<uuid>` otherwise. The
     * anonymous uuid lives in the visitor's own cookie; no IP is stored.
     */
    visitorId: text("visitor_id").notNull(),
    /** From Cloudflare's request metadata, never from the visitor's IP. */
    country: text(),
    region: text(),
    city: text(),
    /** The linking page's host, only when it is another site. */
    referrerHost: text("referrer_host"),
    device: text("device", { enum: PAGE_VIEW_DEVICES }).notNull(),
    createdAt,
  },
  (table) => [
    index("page_views_created_idx").on(table.createdAt),
    index("page_views_path_created_idx").on(table.path, table.createdAt),
    index("page_views_post_slug_created_idx").on(
      table.postSlug,
      table.createdAt,
    ),
    index("page_views_novel_idx").on(
      table.novelId,
      table.novelChapter,
      table.createdAt,
    ),
    index("page_views_visitor_created_idx").on(
      table.visitorId,
      table.createdAt,
    ),
  ],
);

export type PageView = typeof PageViewsTable.$inferSelect;
export type PageViewDevice = (typeof PAGE_VIEW_DEVICES)[number];
