import { queryOptions } from "@tanstack/react-query";
import { ORPCError } from "@orpc/client";
import { orpcClient } from "@/lib/orpc";

export const NOVELS_QUERY_KEY = ["novels"] as const;

export function novelsPageQuery(page: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "list", page],
    queryFn: ({ signal }) => orpcClient.novels.list({ page }, { signal }),
  });
}

/** Resolves to null for a book that does not exist (the server answers 404). */
export function novelQuery(slug: string) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "detail", slug],
    queryFn: async ({ signal }) => {
      try {
        return await orpcClient.novels.bySlug({ slug }, { signal });
      } catch (error) {
        if (error instanceof ORPCError && error.code === "NOVEL_NOT_FOUND")
          return null;
        throw error;
      }
    },
  });
}

/** Resolves to null for a chapter that does not exist. */
export function novelChapterQuery(novelId: number, order: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "chapter", novelId, order],
    queryFn: async ({ signal }) => {
      try {
        return await orpcClient.novels.chapter({ novelId, order }, { signal });
      } catch (error) {
        if (error instanceof ORPCError && error.code === "CHAPTER_NOT_FOUND")
          return null;
        throw error;
      }
    },
  });
}

export function publicNotesQuery(
  novelId: number,
  chapterOrder: number,
  sort: "newest" | "hottest" = "newest",
) {
  return queryOptions({
    queryKey: [
      ...NOVELS_QUERY_KEY,
      "public-notes",
      novelId,
      chapterOrder,
      sort,
    ],
    queryFn: ({ signal }) =>
      orpcClient.novels.publicNotes(
        { novelId, chapterOrder, sort },
        { signal },
      ),
  });
}

export function bookmarksQuery(novelId: number, enabled: boolean) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "bookmarks", novelId],
    queryFn: ({ signal }) =>
      orpcClient.novels.bookmarks({ novelId }, { signal }),
    enabled,
    retry: false,
  });
}

export function ownNotesQuery(
  novelId: number,
  chapterOrder: number,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "my-notes", novelId, chapterOrder],
    queryFn: ({ signal }) =>
      orpcClient.novels.myNotes({ novelId, chapterOrder }, { signal }),
    enabled,
    retry: false,
  });
}

export function novelProgressQuery(novelId: number, enabled: boolean) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "progress", novelId],
    queryFn: ({ signal }) =>
      orpcClient.novels.progress({ novelId }, { signal }),
    enabled,
    retry: false,
  });
}

export function myMuteQuery(enabled: boolean) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "my-mute"],
    queryFn: ({ signal }) => orpcClient.novels.myMute(undefined, { signal }),
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

export function novelSettingsQuery(enabled: boolean) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "settings"],
    queryFn: ({ signal }) => orpcClient.novels.settings(undefined, { signal }),
    enabled,
    retry: false,
  });
}

export const adminNovelsQuery = queryOptions({
  queryKey: [...NOVELS_QUERY_KEY, "admin"],
  queryFn: ({ signal }) => orpcClient.novels.admin.list(undefined, { signal }),
  refetchInterval: (query) => {
    const novels = query.state.data;
    return novels?.some(
      (novel) => novel.status === "pending" || novel.status === "parsing",
    )
      ? 3000
      : false;
  },
});

export function adminChaptersQuery(novelId: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "admin", "chapters", novelId],
    queryFn: ({ signal }) =>
      orpcClient.novels.admin.chapters({ novelId }, { signal }),
  });
}

export function adminChapterQuery(novelId: number, order: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "admin", "chapter", novelId, order],
    queryFn: ({ signal }) =>
      orpcClient.novels.admin.chapter({ novelId, order }, { signal }),
  });
}

export const adminNovelMutesQuery = queryOptions({
  queryKey: [...NOVELS_QUERY_KEY, "admin", "mutes"],
  queryFn: ({ signal }) => orpcClient.novels.admin.mutes(undefined, { signal }),
});

export function adminNotesQuery(status?: "visible" | "removed") {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "admin", "notes", status ?? "all"],
    queryFn: ({ signal }) =>
      orpcClient.novels.admin.notes({ status, limit: 100 }, { signal }),
    refetchInterval: 15000,
  });
}

export function adminNovelStatsQuery(days: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "admin", "stats", days],
    queryFn: ({ signal }) =>
      orpcClient.novels.admin.stats({ days }, { signal }),
  });
}
