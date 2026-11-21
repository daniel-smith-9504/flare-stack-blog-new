import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  NovelChaptersTable,
  NovelNotesTable,
  NovelProgressTable,
  NovelSettingsTable,
  NovelsTable,
  user,
  type Novel,
  type NovelFileFormat,
  type NovelStatus,
} from "@/lib/db/schema";
import type {
  NovelSettings,
  SaveSettingsInput,
} from "@/features/novels/novels.schema";

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
  const written = await db
    .update(NovelsTable)
    .set({ ...data, updatedAt: new Date() })
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
  await db
    .update(NovelsTable)
    .set({
      status,
      ...data,
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
) {
  return db
    .select({
      id: NovelNotesTable.id,
      chapterOrder: NovelNotesTable.chapterOrder,
      quote: NovelNotesTable.quote,
      note: NovelNotesTable.note,
      userName: user.name,
      userImage: user.image,
      createdAt: NovelNotesTable.createdAt,
    })
    .from(NovelNotesTable)
    .innerJoin(user, eq(user.id, NovelNotesTable.userId))
    .where(
      and(
        eq(NovelNotesTable.novelId, novelId),
        eq(NovelNotesTable.chapterOrder, chapterOrder),
        eq(NovelNotesTable.isPublic, true),
      ),
    )
    .orderBy(asc(NovelNotesTable.startOffset));
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
