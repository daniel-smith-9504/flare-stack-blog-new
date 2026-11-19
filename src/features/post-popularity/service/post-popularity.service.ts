import { invalidate } from "@/features/cache/public-cache";
import {
  countDailyViews,
  countPathMetrics,
} from "@/features/analytics/data/analytics.data";
import * as PostPopularityRepo from "@/features/post-popularity/data/post-popularity.data";
import {
  buildPostPopularitySnapshot,
  getPostPopularityWindow,
  isPostPopularitySnapshotUsable,
  isPostPopularityUnchanged,
  POST_POPULARITY_MAX_AGE_MS,
  type PostPopularityDailyViews,
  type PostPopularityMetric,
  type PostPopularityWindow,
  type PublishedPostPopularityRef,
} from "@/features/post-popularity/post-popularity";
import {
  PostPopularitySyncStatusSchema,
  type PostPopularitySnapshot,
  type PostPopularityStatusRecord,
  type PostPopularitySyncStatus,
} from "@/features/post-popularity/post-popularity.schema";
import type { Result } from "@/lib/errors";
import { err, ok } from "@/lib/errors";

type SyncResult = Result<PostPopularitySyncStatus, { reason: "SYNC_FAILED" }>;

type Dependencies = {
  now: () => Date;
  getPathMetrics: (
    db: DB,
    window: PostPopularityWindow,
  ) => Promise<PostPopularityMetric[]>;
  getDailyViews: (
    db: DB,
    window: PostPopularityWindow,
  ) => Promise<PostPopularityDailyViews[]>;
  listPublishedPosts: (db: DB) => Promise<PublishedPostPopularityRef[]>;
  readSnapshot: (env: Env) => Promise<PostPopularitySnapshot | null>;
  writeSnapshot: (env: Env, snapshot: PostPopularitySnapshot) => Promise<void>;
  readStatus: (env: Env) => Promise<PostPopularityStatusRecord | null>;
  writeStatus: (env: Env, status: PostPopularityStatusRecord) => Promise<void>;
  invalidate: (
    context: DbContext & { executionCtx: ExecutionContext },
  ) => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The snapshot window as the `page_views` reader's half-open Date range. */
function windowRange(window: PostPopularityWindow) {
  return { since: new Date(window.startAt), until: new Date(window.endAt + 1) };
}

function toSyncStatus({
  snapshot,
  status,
  now,
}: {
  snapshot: PostPopularitySnapshot | null;
  status: PostPopularityStatusRecord | null;
  now: number;
}): PostPopularitySyncStatus {
  return PostPopularitySyncStatusSchema.parse({
    configured: true,
    expired: snapshot ? !isPostPopularitySnapshotUsable(snapshot, now) : false,
    postCount: snapshot?.entries.length ?? 0,
    lastAttemptAt: status?.lastAttemptAt ?? null,
    lastSuccessAt: status?.lastSuccessAt ?? snapshot?.syncedAt ?? null,
    expiresAt: snapshot?.syncedAt
      ? snapshot.syncedAt + POST_POPULARITY_MAX_AGE_MS
      : null,
    lastError: status?.lastError ?? null,
    windowStart: snapshot?.windowStart ?? status?.windowStart ?? null,
    windowEnd: snapshot?.windowEnd ?? status?.windowEnd ?? null,
  });
}

export function createPostPopularityService(dependencies: Dependencies) {
  /** The sync status together with the snapshot it describes, from one read. */
  async function getStatusWithSnapshot(context: BaseContext): Promise<{
    status: PostPopularitySyncStatus;
    snapshot: PostPopularitySnapshot | null;
  }> {
    const now = dependencies.now().getTime();
    const [snapshot, status] = await Promise.all([
      dependencies.readSnapshot(context.env),
      dependencies.readStatus(context.env),
    ]);

    return {
      status: toSyncStatus({
        snapshot,
        status,
        now,
      }),
      snapshot,
    };
  }

  async function getStatus(context: BaseContext) {
    return (await getStatusWithSnapshot(context)).status;
  }

  async function sync(
    context: DbContext & { executionCtx: ExecutionContext },
  ): Promise<SyncResult> {
    const now = dependencies.now();
    const attemptedAt = now.getTime();
    const window = getPostPopularityWindow(now);
    const [previousStatus, previousSnapshot] = await Promise.all([
      dependencies.readStatus(context.env),
      dependencies.readSnapshot(context.env),
    ]);
    let snapshotWritten = false;

    try {
      const [metrics, posts, daily] = await Promise.all([
        dependencies.getPathMetrics(context.db, window),
        dependencies.listPublishedPosts(context.db),
        // The per-day series is extra: failing to get it must not fail the sync.
        dependencies
          .getDailyViews(context.db, window)
          .catch((error: unknown) => {
            console.error(
              JSON.stringify({
                message: "post popularity daily views failed",
                error: errorMessage(error),
              }),
            );
            return [];
          }),
      ]);
      const snapshot = buildPostPopularitySnapshot({
        metrics,
        posts,
        window,
        syncedAt: attemptedAt,
        daily,
      });
      await dependencies.writeSnapshot(context.env, snapshot);
      snapshotWritten = true;
      // Skip the purge only when the last sync finished its own purge;
      // otherwise cached pages may still show what that snapshot replaced.
      const lastSyncCompleted =
        previousStatus?.lastError === null &&
        previousStatus.lastSuccessAt === previousSnapshot?.syncedAt;
      if (
        !lastSyncCompleted ||
        !isPostPopularityUnchanged(previousSnapshot, snapshot, attemptedAt)
      ) {
        await dependencies.invalidate(context);
      }
      const status = {
        lastAttemptAt: attemptedAt,
        lastSuccessAt: attemptedAt,
        lastError: null,
        windowStart: window.startAt,
        windowEnd: window.endAt,
      } satisfies PostPopularityStatusRecord;
      await dependencies.writeStatus(context.env, status);
      return ok(
        toSyncStatus({
          snapshot,
          status,
          now: attemptedAt,
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      console.error(
        JSON.stringify({
          message: "post popularity sync failed",
          error: message,
        }),
      );
      await dependencies
        .writeStatus(context.env, {
          lastAttemptAt: attemptedAt,
          lastSuccessAt: snapshotWritten
            ? attemptedAt
            : (previousStatus?.lastSuccessAt ?? null),
          lastError: message,
          windowStart: window.startAt,
          windowEnd: window.endAt,
        })
        .catch((statusError) =>
          console.error(
            JSON.stringify({
              message: "post popularity status write failed",
              error: errorMessage(statusError),
            }),
          ),
        );
      return err({ reason: "SYNC_FAILED" });
    }
  }

  return {
    getStatus,
    getStatusWithSnapshot,
    sync,
  };
}

export const postPopularityService = createPostPopularityService({
  now: () => new Date(),
  // The site's own page views (the `page_views` table), never an outside
  // analytics service.
  getPathMetrics: (db, window) => countPathMetrics(db, windowRange(window)),
  getDailyViews: (db, window) => countDailyViews(db, windowRange(window)),
  listPublishedPosts: PostPopularityRepo.listPublishedPosts,
  readSnapshot: PostPopularityRepo.readSnapshot,
  writeSnapshot: PostPopularityRepo.writeSnapshot,
  readStatus: PostPopularityRepo.readStatus,
  writeStatus: PostPopularityRepo.writeStatus,
  invalidate: (context) => invalidate.postPopularityUpdated(context),
});
