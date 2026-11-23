import { and, asc, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  NovelBookmarksTable,
  NovelChaptersTable,
  NovelMutesTable,
  NovelNotesTable,
  NovelNoteLikesTable,
  NovelNoteReportsTable,
  NovelNoteVotesTable,
  NovelProgressTable,
  NovelReadingDailyTable,
  NovelScoreLogsTable,
  NovelSettingsTable,
  NovelsTable,
  PageViewsTable,
  user,
  type Novel,
  type NovelFileFormat,
  type NovelNoteStatus,
  type NovelStatus,
  type NovelVoteChoice,
} from "@/lib/db/schema";
import type {
  NovelSettings,
  SaveSettingsInput,
} from "@/features/novels/novels.schema";
import { NOVEL_MUTE_DAYS } from "@/features/novels/novels.constants";

/** CJK characters and Latin words, so a mixed book counts the usual way. */
export function countWords(text: string) {
  const cjk = text.match(/[\u3400-\u9fff\uf900-\ufaff]/gu)?.length ?? 0;
  const words = text
    .replace(/[\u3400-\u9fff\uf900-\ufaff]/gu, " ")
    .split(/\s+/u)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return cjk + words;
}

const summaryColumns = {
  id: NovelsTable.id,
  title: NovelsTable.title,
  slug: NovelsTable.slug,
  author: NovelsTable.author,
  description: NovelsTable.description,
  category: NovelsTable.category,
  coverUrl: NovelsTable.coverUrl,
  language: NovelsTable.language,
  chapterCount: NovelsTable.chapterCount,
  wordCount: NovelsTable.wordCount,
  updatedAt: NovelsTable.updatedAt,
};

export async function countReadyNovels(db: DB) {
  const [row] = await db
    .select({ total: count() })
    .from(NovelsTable)
    .where(eq(NovelsTable.status, "ready"));
  return Number(row?.total ?? 0);
}

export async function findReadyNovels(
  db: DB,
  options: { limit: number; offset: number },
) {
  return db
    .select(summaryColumns)
    .from(NovelsTable)
    .where(eq(NovelsTable.status, "ready"))
    .orderBy(desc(NovelsTable.updatedAt), desc(NovelsTable.id))
    .limit(options.limit)
    .offset(options.offset);
}

export async function findNovelById(db: DB, id: number): Promise<Novel | null> {
  const [novel] = await db
    .select()
    .from(NovelsTable)
    .where(eq(NovelsTable.id, id))
    .limit(1);
  return novel ?? null;
}

export async function findReadyNovelById(
  db: DB,
  id: number,
): Promise<Novel | null> {
  const [novel] = await db
    .select()
    .from(NovelsTable)
    .where(and(eq(NovelsTable.id, id), eq(NovelsTable.status, "ready")))
    .limit(1);
  return novel ?? null;
}

export async function findReadyNovelBySlug(
  db: DB,
  slug: string,
): Promise<Novel | null> {
  const [novel] = await db
    .select()
    .from(NovelsTable)
    .where(and(eq(NovelsTable.slug, slug), eq(NovelsTable.status, "ready")))
    .limit(1);
  return novel ?? null;
}

export async function listChapters(db: DB, novelId: number) {
  return db
    .select({
      order: NovelChaptersTable.chapterOrder,
      title: NovelChaptersTable.title,
      wordCount: NovelChaptersTable.wordCount,
    })
    .from(NovelChaptersTable)
    .where(eq(NovelChaptersTable.novelId, novelId))
    .orderBy(asc(NovelChaptersTable.chapterOrder));
}

export async function findChapter(db: DB, novelId: number, order: number) {
  const [chapter] = await db
    .select({
      order: NovelChaptersTable.chapterOrder,
      title: NovelChaptersTable.title,
    })
    .from(NovelChaptersTable)
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        eq(NovelChaptersTable.chapterOrder, order),
      ),
    )
    .limit(1);
  return chapter ?? null;
}

export async function findChapterNeighbours(
  db: DB,
  novelId: number,
  order: number,
) {
  const rows = await db
    .select({ order: NovelChaptersTable.chapterOrder })
    .from(NovelChaptersTable)
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        sql`${NovelChaptersTable.chapterOrder} IN (${order - 1}, ${order + 1})`,
      ),
    )
    .orderBy(asc(NovelChaptersTable.chapterOrder));
  return {
    prevOrder: rows.some((row) => row.order === order - 1) ? order - 1 : null,
    nextOrder: rows.some((row) => row.order === order + 1) ? order + 1 : null,
  };
}

// ==================== imports ====================

/** The readable URL a book's title becomes: Chinese stays, punctuation parts. */
export function novelSlugBase(title: string) {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120)
    .replace(/-+$/gu, "");
  return slug || "novel";
}

/** Two books may share a title, so later ones get a number. */
async function uniqueNovelSlug(db: DB, title: string, excludeId?: number) {
  const base = novelSlugBase(title);
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const [taken] = await db
      .select({ id: NovelsTable.id })
      .from(NovelsTable)
      .where(eq(NovelsTable.slug, candidate))
      .limit(1);
    if (!taken || taken.id === excludeId) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function insertNovel(
  db: DB,
  data: {
    title: string;
    author?: string;
    description?: string;
    category?: string | null;
    coverUrl?: string | null;
    source?: Novel["source"];
    sourceId?: string | null;
    language?: string | null;
    fileKey?: string | null;
    fileFormat?: NovelFileFormat | null;
  },
) {
  const [novel] = await db
    .insert(NovelsTable)
    .values({
      title: data.title,
      slug: await uniqueNovelSlug(db, data.title),
      author: data.author ?? "",
      description: data.description ?? "",
      category: data.category ?? null,
      coverUrl: data.coverUrl ?? null,
      source: data.source ?? "upload",
      sourceId: data.sourceId ?? null,
      language: data.language ?? null,
      fileKey: data.fileKey ?? null,
      fileFormat: data.fileFormat ?? null,
      status: "pending",
    })
    .returning({ id: NovelsTable.id });
  return novel.id;
}

export async function updateNovel(
  db: DB,
  id: number,
  data: Partial<{
    title: string;
    author: string;
    description: string;
    category: string | null;
    coverUrl: string | null;
  }>,
) {
  const patch: typeof data & { slug?: string } = { ...data };
  if (data.title !== undefined)
    patch.slug = await uniqueNovelSlug(db, data.title, id);
  const written = await db
    .update(NovelsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(NovelsTable.id, id))
    .returning({ id: NovelsTable.id });
  return written.length > 0;
}

export async function setNovelStatus(
  db: DB,
  id: number,
  status: NovelStatus,
  data: Partial<{
    error: string | null;
    chapterCount: number;
    wordCount: number;
    title: string;
    author: string;
    description: string;
  }> = {},
) {
  const patch: typeof data & { slug?: string } = { ...data };
  if (data.title !== undefined)
    patch.slug = await uniqueNovelSlug(db, data.title, id);
  await db
    .update(NovelsTable)
    .set({
      status,
      ...patch,
      ...(status === "ready" ? { error: null, fileKey: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(NovelsTable.id, id));
}

export async function deleteNovel(db: DB, id: number) {
  const deleted = await db
    .delete(NovelsTable)
    .where(eq(NovelsTable.id, id))
    .returning({ id: NovelsTable.id });
  return deleted.length > 0;
}

export async function deleteChapters(db: DB, novelId: number) {
  await db
    .delete(NovelChaptersTable)
    .where(eq(NovelChaptersTable.novelId, novelId));
}

/** Writes chapter rows in D1 batches, one statement per chapter. */
export async function insertChapters(
  db: DB,
  novelId: number,
  chapters: ReadonlyArray<{ title: string; wordCount: number }>,
) {
  const statements: Array<BatchItem<"sqlite">> = chapters.map((chapter, i) =>
    db
      .insert(NovelChaptersTable)
      .values({
        novelId,
        chapterOrder: i + 1,
        title: chapter.title,
        wordCount: chapter.wordCount,
      })
      .onConflictDoNothing(),
  );
  for (let i = 0; i < statements.length; i += 40)
    await db.batch(
      statements.slice(i, i + 40) as [
        BatchItem<"sqlite">,
        ...Array<BatchItem<"sqlite">>,
      ],
    );
}

// ==================== a reader's own data ====================

export async function findProgress(db: DB, userId: string, novelId: number) {
  const [row] = await db
    .select({
      chapterOrder: NovelProgressTable.chapterOrder,
      progressRatio: NovelProgressTable.progressRatio,
      updatedAt: NovelProgressTable.updatedAt,
    })
    .from(NovelProgressTable)
    .where(
      and(
        eq(NovelProgressTable.userId, userId),
        eq(NovelProgressTable.novelId, novelId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function upsertProgress(
  db: DB,
  userId: string,
  input: { novelId: number; chapterOrder: number; progressRatio: number },
) {
  await db
    .insert(NovelProgressTable)
    .values({
      userId,
      novelId: input.novelId,
      chapterOrder: input.chapterOrder,
      progressRatio: input.progressRatio,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [NovelProgressTable.userId, NovelProgressTable.novelId],
      set: {
        chapterOrder: input.chapterOrder,
        progressRatio: input.progressRatio,
        updatedAt: new Date(),
      },
    });
}

export async function listOwnNotes(
  db: DB,
  userId: string,
  novelId: number,
  chapterOrder: number,
) {
  return db
    .select({
      id: NovelNotesTable.id,
      chapterOrder: NovelNotesTable.chapterOrder,
      startOffset: NovelNotesTable.startOffset,
      endOffset: NovelNotesTable.endOffset,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      isPublic: NovelNotesTable.isPublic,
      createdAt: NovelNotesTable.createdAt,
      updatedAt: NovelNotesTable.updatedAt,
    })
    .from(NovelNotesTable)
    .where(
      and(
        eq(NovelNotesTable.userId, userId),
        eq(NovelNotesTable.novelId, novelId),
        eq(NovelNotesTable.chapterOrder, chapterOrder),
      ),
    )
    .orderBy(asc(NovelNotesTable.startOffset));
}

export async function listPublicNotes(
  db: DB,
  novelId: number,
  chapterOrder: number,
  options: { viewerId?: string; sort?: "newest" | "hottest" } = {},
) {
  const likeCount = sql<number>`(
    select count(*) from ${NovelNoteLikesTable}
    where ${NovelNoteLikesTable.noteId} = ${NovelNotesTable.id}
  )`;
  const likedByMe = options.viewerId
    ? sql<number>`exists(
        select 1 from ${NovelNoteLikesTable}
        where ${NovelNoteLikesTable.noteId} = ${NovelNotesTable.id}
          and ${NovelNoteLikesTable.userId} = ${options.viewerId}
      )`
    : sql<number>`0`;
  const rows = await db
    .select({
      id: NovelNotesTable.id,
      chapterOrder: NovelNotesTable.chapterOrder,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      userName: user.name,
      userImage: user.image,
      likeCount,
      likedByMe,
      reportCount: NovelNotesTable.reportCount,
      createdAt: NovelNotesTable.createdAt,
    })
    .from(NovelNotesTable)
    .innerJoin(user, eq(user.id, NovelNotesTable.userId))
    .where(
      and(
        eq(NovelNotesTable.novelId, novelId),
        eq(NovelNotesTable.chapterOrder, chapterOrder),
        eq(NovelNotesTable.isPublic, true),
        eq(NovelNotesTable.status, "visible"),
      ),
    )
    .orderBy(
      options.sort === "hottest"
        ? desc(likeCount)
        : desc(NovelNotesTable.createdAt),
      desc(NovelNotesTable.id),
    );
  return rows.map((row) => ({
    ...row,
    likeCount: Number(row.likeCount),
    likedByMe: Boolean(row.likedByMe),
  }));
}

export async function insertNote(
  db: DB,
  userId: string,
  input: {
    novelId: number;
    chapterOrder: number;
    startOffset: number;
    endOffset: number;
    quote: string;
    contextBefore: string;
    contextAfter: string;
    note: string;
    isPublic: boolean;
  },
) {
  const [row] = await db
    .insert(NovelNotesTable)
    .values({ userId, ...input })
    .returning({
      id: NovelNotesTable.id,
      chapterOrder: NovelNotesTable.chapterOrder,
      startOffset: NovelNotesTable.startOffset,
      endOffset: NovelNotesTable.endOffset,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      isPublic: NovelNotesTable.isPublic,
      createdAt: NovelNotesTable.createdAt,
      updatedAt: NovelNotesTable.updatedAt,
    });
  return row;
}

export async function updateNote(
  db: DB,
  userId: string,
  id: number,
  data: { note?: string; isPublic?: boolean },
) {
  const [row] = await db
    .update(NovelNotesTable)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(NovelNotesTable.id, id), eq(NovelNotesTable.userId, userId)))
    .returning({
      id: NovelNotesTable.id,
      chapterOrder: NovelNotesTable.chapterOrder,
      startOffset: NovelNotesTable.startOffset,
      endOffset: NovelNotesTable.endOffset,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      isPublic: NovelNotesTable.isPublic,
      createdAt: NovelNotesTable.createdAt,
      updatedAt: NovelNotesTable.updatedAt,
    });
  return row ?? null;
}

export async function deleteNote(db: DB, userId: string, id: number) {
  const deleted = await db
    .delete(NovelNotesTable)
    .where(and(eq(NovelNotesTable.id, id), eq(NovelNotesTable.userId, userId)))
    .returning({ id: NovelNotesTable.id });
  return deleted.length > 0;
}

export async function findSettings(
  db: DB,
  userId: string,
): Promise<NovelSettings | null> {
  const [row] = await db
    .select({
      theme: NovelSettingsTable.theme,
      fontSize: NovelSettingsTable.fontSize,
      lineHeight: NovelSettingsTable.lineHeight,
      fontFamily: NovelSettingsTable.fontFamily,
      pageWidth: NovelSettingsTable.pageWidth,
      readingMode: NovelSettingsTable.readingMode,
    })
    .from(NovelSettingsTable)
    .where(eq(NovelSettingsTable.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function upsertSettings(
  db: DB,
  userId: string,
  data: SaveSettingsInput,
) {
  const next = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  ) as SaveSettingsInput;
  await db
    .insert(NovelSettingsTable)
    .values({ userId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: NovelSettingsTable.userId,
      set: { ...next, updatedAt: new Date() },
    });
  return findSettings(db, userId);
}

/** The Admin's list: newest first, every status. */
export async function listAdminNovels(db: DB, limit = 200) {
  return db
    .select({
      ...summaryColumns,
      status: NovelsTable.status,
      source: NovelsTable.source,
      sourceId: NovelsTable.sourceId,
      error: NovelsTable.error,
      fileFormat: NovelsTable.fileFormat,
      createdAt: NovelsTable.createdAt,
    })
    .from(NovelsTable)
    .orderBy(desc(NovelsTable.createdAt), desc(NovelsTable.id))
    .limit(limit);
}

// ==================== bookmarks ====================

export async function listBookmarks(db: DB, userId: string, novelId: number) {
  return db
    .select({
      id: NovelBookmarksTable.id,
      chapterOrder: NovelBookmarksTable.chapterOrder,
      chapterTitle: NovelChaptersTable.title,
      createdAt: NovelBookmarksTable.createdAt,
    })
    .from(NovelBookmarksTable)
    .innerJoin(
      NovelChaptersTable,
      and(
        eq(NovelChaptersTable.novelId, NovelBookmarksTable.novelId),
        eq(NovelChaptersTable.chapterOrder, NovelBookmarksTable.chapterOrder),
      ),
    )
    .where(
      and(
        eq(NovelBookmarksTable.userId, userId),
        eq(NovelBookmarksTable.novelId, novelId),
      ),
    )
    .orderBy(desc(NovelBookmarksTable.createdAt));
}

export async function addBookmark(
  db: DB,
  userId: string,
  novelId: number,
  chapterOrder: number,
) {
  await db
    .insert(NovelBookmarksTable)
    .values({ userId, novelId, chapterOrder })
    .onConflictDoNothing();
}

export async function removeBookmark(
  db: DB,
  userId: string,
  novelId: number,
  chapterOrder: number,
) {
  await db
    .delete(NovelBookmarksTable)
    .where(
      and(
        eq(NovelBookmarksTable.userId, userId),
        eq(NovelBookmarksTable.novelId, novelId),
        eq(NovelBookmarksTable.chapterOrder, chapterOrder),
      ),
    );
}

export async function isBookmarked(
  db: DB,
  userId: string,
  novelId: number,
  chapterOrder: number,
) {
  const [row] = await db
    .select({ id: NovelBookmarksTable.id })
    .from(NovelBookmarksTable)
    .where(
      and(
        eq(NovelBookmarksTable.userId, userId),
        eq(NovelBookmarksTable.novelId, novelId),
        eq(NovelBookmarksTable.chapterOrder, chapterOrder),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ==================== reading time ====================

/** Adds one heartbeat to the reader's UTC day for this book. */
export async function addReadingTime(
  db: DB,
  userId: string,
  input: {
    novelId: number;
    chapterOrder: number;
    seconds: number;
    words: number;
    countsChapter: boolean;
  },
) {
  const day = new Date().toISOString().slice(0, 10);
  await db
    .insert(NovelReadingDailyTable)
    .values({
      userId,
      novelId: input.novelId,
      day,
      seconds: input.seconds,
      words: input.words,
      chapters: input.countsChapter ? 1 : 0,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        NovelReadingDailyTable.userId,
        NovelReadingDailyTable.novelId,
        NovelReadingDailyTable.day,
      ],
      set: {
        seconds: sql`${NovelReadingDailyTable.seconds} + ${input.seconds}`,
        words: sql`${NovelReadingDailyTable.words} + ${input.words}`,
        chapters: input.countsChapter
          ? sql`${NovelReadingDailyTable.chapters} + 1`
          : NovelReadingDailyTable.chapters,
        updatedAt: new Date(),
      },
    });
}

// ==================== likes, reports and votes ====================

export async function findNote(db: DB, id: number) {
  const [row] = await db
    .select({
      id: NovelNotesTable.id,
      userId: NovelNotesTable.userId,
      novelId: NovelNotesTable.novelId,
      isPublic: NovelNotesTable.isPublic,
      status: NovelNotesTable.status,
      reportCount: NovelNotesTable.reportCount,
    })
    .from(NovelNotesTable)
    .where(eq(NovelNotesTable.id, id))
    .limit(1);
  return row ?? null;
}

export async function countLikes(db: DB, noteId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(NovelNoteLikesTable)
    .where(eq(NovelNoteLikesTable.noteId, noteId));
  return Number(row?.total ?? 0);
}

export async function likeNote(db: DB, noteId: number, userId: string) {
  const [existing] = await db
    .select({ noteId: NovelNoteLikesTable.noteId })
    .from(NovelNoteLikesTable)
    .where(
      and(
        eq(NovelNoteLikesTable.noteId, noteId),
        eq(NovelNoteLikesTable.userId, userId),
      ),
    )
    .limit(1);
  if (existing) {
    await db
      .delete(NovelNoteLikesTable)
      .where(
        and(
          eq(NovelNoteLikesTable.noteId, noteId),
          eq(NovelNoteLikesTable.userId, userId),
        ),
      );
  } else {
    await db
      .insert(NovelNoteLikesTable)
      .values({ noteId, userId })
      .onConflictDoNothing();
  }
  return { liked: !existing, likeCount: await countLikes(db, noteId) };
}

export async function insertReport(
  db: DB,
  input: {
    noteId: number;
    reporterId: string | null;
    reporterKey: string;
    reason: string;
  },
) {
  const inserted = await db
    .insert(NovelNoteReportsTable)
    .values({
      noteId: input.noteId,
      reporterId: input.reporterId,
      reporterKey: input.reporterKey,
      reason: input.reason,
    })
    .onConflictDoNothing()
    .returning({ id: NovelNoteReportsTable.id });
  if (inserted.length > 0) {
    await db
      .update(NovelNotesTable)
      .set({ reportCount: sql`${NovelNotesTable.reportCount} + 1` })
      .where(eq(NovelNotesTable.id, input.noteId));
    return {
      reported: true,
      reportCount: await countReports(db, input.noteId),
    };
  }
  return { reported: false, reportCount: await countReports(db, input.noteId) };
}

export async function countReports(db: DB, noteId: number) {
  const [row] = await db
    .select({ total: count() })
    .from(NovelNoteReportsTable)
    .where(eq(NovelNoteReportsTable.noteId, noteId));
  return Number(row?.total ?? 0);
}

export async function castVote(
  db: DB,
  noteId: number,
  userId: string,
  choice: NovelVoteChoice,
) {
  await db
    .insert(NovelNoteVotesTable)
    .values({ noteId, userId, choice })
    .onConflictDoUpdate({
      target: [NovelNoteVotesTable.noteId, NovelNoteVotesTable.userId],
      set: { choice },
    });
  return countVotes(db, noteId);
}

export async function countVotes(db: DB, noteId: number) {
  const rows = await db
    .select({ choice: NovelNoteVotesTable.choice, total: count() })
    .from(NovelNoteVotesTable)
    .where(eq(NovelNoteVotesTable.noteId, noteId))
    .groupBy(NovelNoteVotesTable.choice);
  const of = (choice: NovelVoteChoice) =>
    Number(rows.find((row) => row.choice === choice)?.total ?? 0);
  return { removeVotes: of("remove"), keepVotes: of("keep") };
}

export async function findVote(db: DB, noteId: number, userId: string) {
  const [row] = await db
    .select({ choice: NovelNoteVotesTable.choice })
    .from(NovelNoteVotesTable)
    .where(
      and(
        eq(NovelNoteVotesTable.noteId, noteId),
        eq(NovelNoteVotesTable.userId, userId),
      ),
    )
    .limit(1);
  return row?.choice ?? null;
}

// ==================== moderation ====================

export async function listAdminNotes(
  db: DB,
  options: { status?: NovelNoteStatus; limit: number },
) {
  const likes = sql<number>`(
    select count(*) from ${NovelNoteLikesTable}
    where ${NovelNoteLikesTable.noteId} = ${NovelNotesTable.id}
  )`;
  const removeVotes = sql<number>`(
    select count(*) from ${NovelNoteVotesTable}
    where ${NovelNoteVotesTable.noteId} = ${NovelNotesTable.id}
      and ${NovelNoteVotesTable.choice} = 'remove'
  )`;
  const keepVotes = sql<number>`(
    select count(*) from ${NovelNoteVotesTable}
    where ${NovelNoteVotesTable.noteId} = ${NovelNotesTable.id}
      and ${NovelNoteVotesTable.choice} = 'keep'
  )`;
  const rows = await db
    .select({
      id: NovelNotesTable.id,
      novelId: NovelNotesTable.novelId,
      novelTitle: NovelsTable.title,
      chapterOrder: NovelNotesTable.chapterOrder,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      userName: user.name,
      userImage: user.image,
      status: NovelNotesTable.status,
      reportCount: NovelNotesTable.reportCount,
      likes,
      removeVotes,
      keepVotes,
      removeReason: NovelNotesTable.removeReason,
      createdAt: NovelNotesTable.createdAt,
    })
    .from(NovelNotesTable)
    .innerJoin(user, eq(user.id, NovelNotesTable.userId))
    .innerJoin(NovelsTable, eq(NovelsTable.id, NovelNotesTable.novelId))
    .where(
      options.status ? eq(NovelNotesTable.status, options.status) : undefined,
    )
    .orderBy(desc(NovelNotesTable.reportCount), desc(NovelNotesTable.createdAt))
    .limit(options.limit);
  return rows.map((row) => ({
    ...row,
    likes: Number(row.likes),
    removeVotes: Number(row.removeVotes),
    keepVotes: Number(row.keepVotes),
  }));
}

export async function setNoteStatus(
  db: DB,
  id: number,
  status: NovelNoteStatus,
  data: {
    removedBy?: string | null;
    removeReason?: string | null;
  } = {},
) {
  const [row] = await db
    .update(NovelNotesTable)
    .set({
      status,
      removedBy: status === "removed" ? (data.removedBy ?? null) : null,
      removedAt: status === "removed" ? new Date() : null,
      removeReason: status === "removed" ? (data.removeReason ?? null) : null,
      updatedAt: new Date(),
    })
    .where(eq(NovelNotesTable.id, id))
    .returning({ status: NovelNotesTable.status });
  return row?.status ?? null;
}

export async function resolveReports(db: DB, noteId: number) {
  await db
    .update(NovelNoteReportsTable)
    .set({ status: "resolved" })
    .where(eq(NovelNoteReportsTable.noteId, noteId));
}

export async function addScore(
  db: DB,
  userId: string,
  delta: number,
  reason: string,
) {
  await db.insert(NovelScoreLogsTable).values({ userId, delta, reason });
}

export async function findActiveMute(db: DB, userId: string) {
  const [row] = await db
    .select({ id: NovelMutesTable.id, until: NovelMutesTable.until })
    .from(NovelMutesTable)
    .where(eq(NovelMutesTable.userId, userId))
    .orderBy(desc(NovelMutesTable.level), desc(NovelMutesTable.createdAt))
    .limit(1);
  if (!row) return null;
  if (row.until === null) return { permanent: true, until: null };
  return row.until.getTime() > Date.now()
    ? { permanent: false, until: row.until }
    : null;
}

/** The account-wide mute an Admin sets on the user row, if any. */
export async function findUserMutedAt(db: DB, userId: string) {
  const [row] = await db
    .select({ mutedAt: user.mutedAt })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.mutedAt ?? null;
}

export async function listNovelMutes(db: DB) {
  return db
    .select({
      id: NovelMutesTable.id,
      userId: NovelMutesTable.userId,
      userName: user.name,
      userImage: user.image,
      level: NovelMutesTable.level,
      until: NovelMutesTable.until,
      reason: NovelMutesTable.reason,
      createdAt: NovelMutesTable.createdAt,
    })
    .from(NovelMutesTable)
    .innerJoin(user, eq(user.id, NovelMutesTable.userId))
    .orderBy(desc(NovelMutesTable.createdAt));
}

export async function findNovelMuteById(db: DB, id: number) {
  const [row] = await db
    .select({ id: NovelMutesTable.id, until: NovelMutesTable.until })
    .from(NovelMutesTable)
    .where(eq(NovelMutesTable.id, id))
    .limit(1);
  return row ?? null;
}

/** Ends a mute now, keeping the row so the next offence still escalates. */
export async function endNovelMute(db: DB, id: number) {
  const [row] = await db
    .update(NovelMutesTable)
    .set({ until: new Date() })
    .where(eq(NovelMutesTable.id, id))
    .returning({ id: NovelMutesTable.id });
  return Boolean(row);
}

/** A mute steps 1 → 3 → 7 → 30 days and is permanent from the fifth. */
export async function muteUser(db: DB, userId: string, reason: string) {
  const [row] = await db
    .select({ total: count() })
    .from(NovelMutesTable)
    .where(eq(NovelMutesTable.userId, userId));
  const level = Number(row?.total ?? 0) + 1;
  const days = NOVEL_MUTE_DAYS[Math.min(level - 1, NOVEL_MUTE_DAYS.length - 1)];
  const until =
    level > NOVEL_MUTE_DAYS.length
      ? null
      : new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  await db.insert(NovelMutesTable).values({ userId, level, until, reason });
  return { level, until };
}

// ==================== the Admin's chapters ====================

const chapterColumns = {
  novelId: NovelChaptersTable.novelId,
  order: NovelChaptersTable.chapterOrder,
  title: NovelChaptersTable.title,
  wordCount: NovelChaptersTable.wordCount,
  version: NovelChaptersTable.version,
};

export async function listAdminChapters(db: DB, novelId: number) {
  return db
    .select(chapterColumns)
    .from(NovelChaptersTable)
    .where(eq(NovelChaptersTable.novelId, novelId))
    .orderBy(asc(NovelChaptersTable.chapterOrder));
}

export async function findAdminChapter(db: DB, novelId: number, order: number) {
  const [row] = await db
    .select(chapterColumns)
    .from(NovelChaptersTable)
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        eq(NovelChaptersTable.chapterOrder, order),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findMaxChapterOrder(db: DB, novelId: number) {
  const [row] = await db
    .select({ max: sql<number>`max(${NovelChaptersTable.chapterOrder})` })
    .from(NovelChaptersTable)
    .where(eq(NovelChaptersTable.novelId, novelId));
  return Number(row?.max ?? 0);
}

/** Makes room at `order` by shifting everything from it up one. */
export async function shiftChaptersUp(db: DB, novelId: number, order: number) {
  await db
    .update(NovelChaptersTable)
    .set({ chapterOrder: sql`-(${NovelChaptersTable.chapterOrder} + 1)` })
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        gte(NovelChaptersTable.chapterOrder, order),
      ),
    );
  await db
    .update(NovelChaptersTable)
    .set({ chapterOrder: sql`-${NovelChaptersTable.chapterOrder} - 1` })
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        lt(NovelChaptersTable.chapterOrder, 0),
      ),
    );
}

export async function insertChapterRow(
  db: DB,
  novelId: number,
  order: number,
  title: string,
  wordCount: number,
) {
  await db.insert(NovelChaptersTable).values({
    novelId,
    chapterOrder: order,
    title,
    wordCount,
    version: 0,
  });
}

export async function updateChapterRow(
  db: DB,
  input: {
    novelId: number;
    order: number;
    title: string;
    wordCount: number;
    version: number;
  },
) {
  const [row] = await db
    .update(NovelChaptersTable)
    .set({
      title: input.title,
      wordCount: input.wordCount,
      version: sql`${NovelChaptersTable.version} + 1`,
    })
    .where(
      and(
        eq(NovelChaptersTable.novelId, input.novelId),
        eq(NovelChaptersTable.chapterOrder, input.order),
        eq(NovelChaptersTable.version, input.version),
      ),
    )
    .returning(chapterColumns);
  return row ?? null;
}

/** Renumbers a book's chapters 1..n, in two phases to keep the unique index. */
async function renumberChapters(db: DB, novelId: number) {
  const rows = await db
    .select({ id: NovelChaptersTable.id })
    .from(NovelChaptersTable)
    .where(eq(NovelChaptersTable.novelId, novelId))
    .orderBy(asc(NovelChaptersTable.chapterOrder));
  if (rows.length === 0) return;
  const statements: Array<BatchItem<"sqlite">> = [
    ...rows.map((row, index) =>
      db
        .update(NovelChaptersTable)
        .set({ chapterOrder: -(index + 1) })
        .where(eq(NovelChaptersTable.id, row.id)),
    ),
    ...rows.map((row, index) =>
      db
        .update(NovelChaptersTable)
        .set({ chapterOrder: index + 1 })
        .where(eq(NovelChaptersTable.id, row.id)),
    ),
  ];
  for (let i = 0; i < statements.length; i += 40)
    await db.batch(
      statements.slice(i, i + 40) as [
        BatchItem<"sqlite">,
        ...Array<BatchItem<"sqlite">>,
      ],
    );
}

export async function deleteChapterRows(
  db: DB,
  novelId: number,
  orders: number[],
) {
  await db
    .delete(NovelChaptersTable)
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        inArray(NovelChaptersTable.chapterOrder, orders),
      ),
    );
  await renumberChapters(db, novelId);
}

export async function swapChapters(
  db: DB,
  novelId: number,
  from: number,
  to: number,
) {
  await db
    .update(NovelChaptersTable)
    .set({ chapterOrder: -1 })
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        eq(NovelChaptersTable.chapterOrder, from),
      ),
    );
  await db
    .update(NovelChaptersTable)
    .set({ chapterOrder: from })
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        eq(NovelChaptersTable.chapterOrder, to),
      ),
    );
  await db
    .update(NovelChaptersTable)
    .set({ chapterOrder: to })
    .where(
      and(
        eq(NovelChaptersTable.novelId, novelId),
        eq(NovelChaptersTable.chapterOrder, -1),
      ),
    );
}

export async function setNovelChapterTotals(
  db: DB,
  novelId: number,
  chapterCount: number,
  wordCount: number,
) {
  await db
    .update(NovelsTable)
    .set({ chapterCount, wordCount, updatedAt: new Date() })
    .where(eq(NovelsTable.id, novelId));
}

// ==================== the Admin's reading report ====================

export async function readNovelStats(db: DB, days: number) {
  const dayMs = 86_400_000;
  const today = Math.floor(Date.now() / dayMs) * dayMs;
  const since = new Date(today - (days - 1) * dayMs);
  const sinceDay = since.toISOString().slice(0, 10);
  const inWindow = and(
    gte(PageViewsTable.createdAt, since),
    sql`${PageViewsTable.novelId} is not null`,
  );

  const [
    summaryRows,
    dailyViews,
    dailyReading,
    topNovelRows,
    topChapterRows,
    readingByNovel,
    readingSummary,
  ] = await Promise.all([
    db
      .select({
        views: count(),
        visitors: sql<number>`count(distinct ${PageViewsTable.visitorId})`,
      })
      .from(PageViewsTable)
      .where(inWindow),
    db
      .select({
        day: sql<number>`cast(${PageViewsTable.createdAt} / 86400 as integer)`,
        views: count(),
      })
      .from(PageViewsTable)
      .where(inWindow)
      .groupBy(sql`cast(${PageViewsTable.createdAt} / 86400 as integer)`)
      .orderBy(sql`cast(${PageViewsTable.createdAt} / 86400 as integer)`),
    db
      .select({
        day: NovelReadingDailyTable.day,
        seconds: sql<number>`coalesce(sum(${NovelReadingDailyTable.seconds}), 0)`,
      })
      .from(NovelReadingDailyTable)
      .where(gte(NovelReadingDailyTable.day, sinceDay))
      .groupBy(NovelReadingDailyTable.day)
      .orderBy(asc(NovelReadingDailyTable.day)),
    db
      .select({
        id: NovelsTable.id,
        title: NovelsTable.title,
        views: count(),
      })
      .from(PageViewsTable)
      .innerJoin(NovelsTable, eq(NovelsTable.id, PageViewsTable.novelId))
      .where(inWindow)
      .groupBy(NovelsTable.id, NovelsTable.title)
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({
        novelId: PageViewsTable.novelId,
        novelTitle: NovelsTable.title,
        chapterOrder: PageViewsTable.novelChapter,
        views: count(),
      })
      .from(PageViewsTable)
      .innerJoin(NovelsTable, eq(NovelsTable.id, PageViewsTable.novelId))
      .where(and(inWindow, sql`${PageViewsTable.novelChapter} is not null`))
      .groupBy(
        PageViewsTable.novelId,
        NovelsTable.title,
        PageViewsTable.novelChapter,
      )
      .orderBy(desc(count()))
      .limit(10),
    db
      .select({
        novelId: NovelReadingDailyTable.novelId,
        seconds: sql<number>`coalesce(sum(${NovelReadingDailyTable.seconds}), 0)`,
      })
      .from(NovelReadingDailyTable)
      .where(gte(NovelReadingDailyTable.day, sinceDay))
      .groupBy(NovelReadingDailyTable.novelId),
    db
      .select({
        seconds: sql<number>`coalesce(sum(${NovelReadingDailyTable.seconds}), 0)`,
        words: sql<number>`coalesce(sum(${NovelReadingDailyTable.words}), 0)`,
      })
      .from(NovelReadingDailyTable)
      .where(gte(NovelReadingDailyTable.day, sinceDay)),
  ]);

  const secondsByNovel = new Map(
    readingByNovel.map((row) => [row.novelId, Number(row.seconds)]),
  );
  const viewsByDay = new Map(
    dailyViews.map((row) => [Number(row.day), Number(row.views)]),
  );
  const secondsByDay = new Map(
    dailyReading.map((row) => [row.day, Number(row.seconds)]),
  );
  // Exactly the requested number of days, ending today, so a bar per day.
  const daily = Array.from({ length: days }, (_, index) => {
    const day = today - (days - 1 - index) * dayMs;
    const key = new Date(day).toISOString().slice(0, 10);
    return {
      day,
      views: viewsByDay.get(day / dayMs) ?? 0,
      seconds: secondsByDay.get(key) ?? 0,
    };
  });

  const summary = summaryRows[0] ?? { views: 0, visitors: 0 };
  const reading = readingSummary[0] ?? { seconds: 0, words: 0 };

  return {
    days,
    summary: {
      views: summary.views,
      visitors: Number(summary.visitors),
      seconds: Number(reading.seconds),
      words: Number(reading.words),
    },
    daily,
    topNovels: topNovelRows.map((row) => ({
      ...row,
      seconds: secondsByNovel.get(row.id) ?? 0,
    })),
    topChapters: topChapterRows.flatMap((row) =>
      row.novelId !== null && row.chapterOrder !== null
        ? [
            {
              novelId: row.novelId,
              novelTitle: row.novelTitle,
              chapterOrder: row.chapterOrder,
              views: row.views,
            },
          ]
        : [],
    ),
  };
}
