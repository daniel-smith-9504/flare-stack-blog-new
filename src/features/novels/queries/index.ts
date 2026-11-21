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
export function novelQuery(id: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "detail", id],
    queryFn: async ({ signal }) => {
      try {
        return await orpcClient.novels.byId({ id }, { signal });
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

export function publicNotesQuery(novelId: number, chapterOrder: number) {
  return queryOptions({
    queryKey: [...NOVELS_QUERY_KEY, "public-notes", novelId, chapterOrder],
    queryFn: ({ signal }) =>
      orpcClient.novels.publicNotes({ novelId, chapterOrder }, { signal }),
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
