import * as HistoryRepo from "@/features/reading-history/data/reading-history.data";
import type { ReadingHistory } from "@/features/reading-history/reading-history.schema";

const RECENT_LIMIT = 8;

/** The seconds SQLite returns for a timestamp column, as a Date. */
function dateOf(seconds: number) {
  return new Date(seconds * 1000);
}

export async function getReadingHistory(
  context: AuthContext,
): Promise<ReadingHistory> {
  const userId = context.session.user.id;
  const [posts, novels, postTotal, novelTotal, seconds] = await Promise.all([
    HistoryRepo.listReadPosts(context.db, userId, RECENT_LIMIT),
    HistoryRepo.listReadNovels(context.db, userId, RECENT_LIMIT),
    HistoryRepo.countReadPosts(context.db, userId),
    HistoryRepo.countReadNovels(context.db, userId),
    HistoryRepo.totalReadingSeconds(context.db, userId),
  ]);

  return {
    summary: { posts: postTotal, novels: novelTotal, seconds },
    posts: posts.map((post) => ({
      ...post,
      lastReadAt: dateOf(post.lastReadAt),
    })),
    novels: novels.map((novel) => ({
      ...novel,
      lastReadAt: dateOf(novel.lastReadAt),
    })),
  };
}
