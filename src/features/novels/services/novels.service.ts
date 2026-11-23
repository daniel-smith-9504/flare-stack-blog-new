import type {
  SaveSettingsInput,
  NovelSettings,
  OwnNote,
  AdminChapter,
  AdminChapterContent,
  MyNovelMute,
  AdminNovelMute,
} from "@/features/novels/novels.schema";
import * as NovelRepo from "@/features/novels/data/novels.data";
import {
  deleteImportFile,
  deleteNovelChapters,
  getChapterText,
  putChapterText,
  putImportFile,
} from "@/features/novels/data/novels.storage";
import {
  DEFAULT_NOVEL_SETTINGS,
  NOVELS_PER_PAGE,
  NOVEL_IMPORT_MAX_BYTES,
  NOVEL_NOTE_CONTEXT_LENGTH,
  NOVEL_REPORT_VOTE_THRESHOLD,
  NOVEL_RESOLVED_REPORT_POINTS,
  NOVEL_VOTE_POINTS,
} from "@/features/novels/novels.constants";
import {
  fetchGutenbergBook,
  searchGutenberg,
} from "@/features/novels/sources/gutenberg";
import { err, ok, type Result } from "@/lib/errors";

type ReadContext = { db: DB; env: Env };

// ==================== public reads ====================

export async function getNovelsPage(context: ReadContext, page: number) {
  const total = await NovelRepo.countReadyNovels(context.db);
  const totalPages = Math.max(1, Math.ceil(total / NOVELS_PER_PAGE));
  const current = Math.min(page, totalPages);
  const items = await NovelRepo.findReadyNovels(context.db, {
    limit: NOVELS_PER_PAGE,
    offset: (current - 1) * NOVELS_PER_PAGE,
  });
  return { items, page: current, totalPages };
}

export async function getNovelDetail(context: ReadContext, id: number) {
  const novel = await NovelRepo.findReadyNovelById(context.db, id);
  if (!novel) return null;
  const chapters = await NovelRepo.listChapters(context.db, id);
  return {
    id: novel.id,
    title: novel.title,
    slug: novel.slug,
    author: novel.author,
    description: novel.description,
    category: novel.category,
    coverUrl: novel.coverUrl,
    language: novel.language,
    chapterCount: novel.chapterCount,
    wordCount: novel.wordCount,
    updatedAt: novel.updatedAt,
    chapters,
  };
}

/** A book by its readable URL; a legacy numeric URL still resolves. */
export async function getNovelDetailBySlug(context: ReadContext, slug: string) {
  const novel =
    (await NovelRepo.findReadyNovelBySlug(context.db, slug)) ??
    (/^\d+$/u.test(slug)
      ? await NovelRepo.findReadyNovelById(context.db, Number(slug))
      : null);
  return novel ? getNovelDetail(context, novel.id) : null;
}

export function getProgress(
  context: ReadContext & { session: Session },
  novelId: number,
) {
  return NovelRepo.findProgress(context.db, context.session.user.id, novelId);
}

export async function getChapter(
  context: ReadContext,
  novelId: number,
  order: number,
) {
  const novel = await NovelRepo.findReadyNovelById(context.db, novelId);
  if (!novel) return null;
  const chapter = await NovelRepo.findChapter(context.db, novelId, order);
  if (!chapter) return null;
  const [content, neighbours] = await Promise.all([
    getChapterText(context.env, novelId, order),
    NovelRepo.findChapterNeighbours(context.db, novelId, order),
  ]);
  if (content === null) return null;
  return {
    novelId,
    novelTitle: novel.title,
    order,
    title: chapter.title,
    content,
    chapterCount: novel.chapterCount,
    ...neighbours,
  };
}

export function getPublicNotes(
  context: ReadContext,
  input: {
    novelId: number;
    chapterOrder: number;
    sort: "newest" | "hottest";
    viewerId?: string;
  },
) {
  return NovelRepo.listPublicNotes(
    context.db,
    input.novelId,
    input.chapterOrder,
    { viewerId: input.viewerId, sort: input.sort },
  );
}

// ==================== a signed-in reader's own data ====================

export function getOwnNotes(
  context: ReadContext & { session: Session },
  novelId: number,
  chapterOrder: number,
) {
  return NovelRepo.listOwnNotes(
    context.db,
    context.session.user.id,
    novelId,
    chapterOrder,
  );
}

export async function saveProgress(
  context: ReadContext & { session: Session },
  input: { novelId: number; chapterOrder: number; progressRatio: number },
) {
  const chapter = await NovelRepo.findChapter(
    context.db,
    input.novelId,
    input.chapterOrder,
  );
  if (!chapter) return false;
  await NovelRepo.upsertProgress(context.db, context.session.user.id, input);
  return true;
}

export type NoteError = {
  reason: "CHAPTER_NOT_FOUND" | "NOTE_OFFSET_INVALID" | "MUTED";
};

export async function createNote(
  context: ReadContext & { session: Session },
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
): Promise<Result<OwnNote, NoteError>> {
  if (await NovelRepo.findUserMutedAt(context.db, context.session.user.id))
    return err({ reason: "MUTED" });
  if (await NovelRepo.findActiveMute(context.db, context.session.user.id))
    return err({ reason: "MUTED" });
  const chapter = await NovelRepo.findChapter(
    context.db,
    input.novelId,
    input.chapterOrder,
  );
  if (!chapter) return err({ reason: "CHAPTER_NOT_FOUND" });

  const content = await getChapterText(
    context.env,
    input.novelId,
    input.chapterOrder,
  );
  if (
    content === null ||
    input.endOffset > content.length ||
    input.endOffset <= input.startOffset ||
    content.slice(input.startOffset, input.endOffset) !== input.quote
  )
    return err({ reason: "NOTE_OFFSET_INVALID" });

  const row = await NovelRepo.insertNote(context.db, context.session.user.id, {
    ...input,
    contextBefore:
      input.contextBefore ||
      content.slice(
        Math.max(0, input.startOffset - NOVEL_NOTE_CONTEXT_LENGTH),
        input.startOffset,
      ),
    contextAfter:
      input.contextAfter ||
      content.slice(
        input.endOffset,
        input.endOffset + NOVEL_NOTE_CONTEXT_LENGTH,
      ),
  });
  return ok(row);
}

export function updateNote(
  context: ReadContext & { session: Session },
  input: { id: number; note?: string; isPublic?: boolean },
) {
  return NovelRepo.updateNote(context.db, context.session.user.id, input.id, {
    note: input.note,
    isPublic: input.isPublic,
  });
}

export function deleteNote(
  context: ReadContext & { session: Session },
  id: number,
) {
  return NovelRepo.deleteNote(context.db, context.session.user.id, id);
}

/** Whether the reader may post a highlight: an account mute wins over one. */
export async function getMyMute(
  context: ReadContext & { session: Session },
): Promise<MyNovelMute> {
  const userId = context.session.user.id;
  if (await NovelRepo.findUserMutedAt(context.db, userId))
    return { muted: true, permanent: true, until: null, source: "account" };
  const mute = await NovelRepo.findActiveMute(context.db, userId);
  if (!mute)
    return { muted: false, permanent: false, until: null, source: null };
  return {
    muted: true,
    permanent: mute.permanent,
    until: mute.until,
    source: "novel",
  };
}

export async function getSettings(
  context: ReadContext & { session: Session },
): Promise<NovelSettings> {
  return (
    (await NovelRepo.findSettings(context.db, context.session.user.id)) ??
    DEFAULT_NOVEL_SETTINGS
  );
}

export function saveSettings(
  context: ReadContext & { session: Session },
  input: SaveSettingsInput,
) {
  return NovelRepo.upsertSettings(context.db, context.session.user.id, input);
}

// ==================== the Admin's view ====================

export function listAdminNovels(context: ReadContext) {
  return NovelRepo.listAdminNovels(context.db);
}

export function updateNovelAdmin(
  context: ReadContext,
  input: {
    id: number;
    title?: string;
    author?: string;
    description?: string;
    category?: string | null;
    coverUrl?: string | null;
  },
) {
  const { id, ...data } = input;
  return NovelRepo.updateNovel(context.db, id, data);
}

export async function deleteNovelAdmin(context: ReadContext, id: number) {
  const novel = await NovelRepo.findNovelById(context.db, id);
  if (!novel) return false;
  await deleteNovelChapters(context.env, id);
  if (novel.fileKey) await deleteImportFile(context.env, novel.fileKey);
  return NovelRepo.deleteNovel(context.db, id);
}

export async function retryImportAdmin(context: ReadContext, id: number) {
  const novel = await NovelRepo.findNovelById(context.db, id);
  if (!novel?.fileKey || !novel.fileFormat) return null;
  await NovelRepo.setNovelStatus(context.db, id, "pending", { error: null });
  await context.env.QUEUE.send({
    type: "NOVEL_IMPORT",
    data: {
      novelId: id,
      fileKey: novel.fileKey,
      format: novel.fileFormat,
    },
  });
  return { id, status: "pending" as const };
}

export function searchGutenbergBooks(query: string) {
  return searchGutenberg(query);
}

/** Imports a Gutenberg book through the same queue an upload goes through. */
export async function importGutenbergAdmin(context: ReadContext, id: number) {
  const { book, epubUrl } = await fetchGutenbergBook(id);
  const response = await fetch(epubUrl);
  if (!response.ok)
    throw new Error(`Gutenberg answered ${response.status} for the EPUB file.`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > NOVEL_IMPORT_MAX_BYTES)
    throw new Error("The Gutenberg EPUB is larger than the import limit.");

  const fileKey = `novels/imports/${crypto.randomUUID()}.epub`;
  await putImportFile(context.env, fileKey, bytes, "application/epub+zip");

  const novelId = await NovelRepo.insertNovel(context.db, {
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    source: "gutenberg",
    sourceId: String(book.id),
    language: book.languages[0] ?? null,
    fileKey,
    fileFormat: "epub",
  });
  await context.env.QUEUE.send({
    type: "NOVEL_IMPORT",
    data: { novelId, fileKey, format: "epub" },
  });
  return { id: novelId, status: "pending" as const };
}

// ==================== bookmarks and reading time ====================

export function getBookmarks(
  context: ReadContext & { session: Session },
  novelId: number,
) {
  return NovelRepo.listBookmarks(context.db, context.session.user.id, novelId);
}

export async function setBookmark(
  context: ReadContext & { session: Session },
  input: { novelId: number; chapterOrder: number; bookmarked: boolean },
) {
  const chapter = await NovelRepo.findChapter(
    context.db,
    input.novelId,
    input.chapterOrder,
  );
  if (!chapter) return null;
  if (input.bookmarked)
    await NovelRepo.addBookmark(
      context.db,
      context.session.user.id,
      input.novelId,
      input.chapterOrder,
    );
  else
    await NovelRepo.removeBookmark(
      context.db,
      context.session.user.id,
      input.novelId,
      input.chapterOrder,
    );
  return { bookmarked: input.bookmarked };
}

export async function recordReading(
  context: ReadContext & { session: Session },
  input: {
    novelId: number;
    chapterOrder: number;
    seconds: number;
    words: number;
  },
) {
  const chapter = await NovelRepo.findChapter(
    context.db,
    input.novelId,
    input.chapterOrder,
  );
  if (!chapter) return false;
  await NovelRepo.addReadingTime(context.db, context.session.user.id, {
    ...input,
    countsChapter: true,
  });
  return true;
}

// ==================== the social layer on shared highlights ====================

export type NoteInteractionError = {
  reason:
    | "NOTE_NOT_FOUND"
    | "NOT_PUBLIC"
    | "ALREADY_REPORTED"
    | "TOO_FEW_REPORTS";
};

export async function toggleNoteLike(
  context: ReadContext & { session: Session },
  id: number,
): Promise<
  Result<{ liked: boolean; likeCount: number }, NoteInteractionError>
> {
  const note = await NovelRepo.findNote(context.db, id);
  if (!note || note.status !== "visible")
    return err({ reason: "NOTE_NOT_FOUND" });
  if (!note.isPublic) return err({ reason: "NOT_PUBLIC" });
  return ok(await NovelRepo.likeNote(context.db, id, context.session.user.id));
}

export async function reportNote(
  context: ReadContext,
  input: {
    id: number;
    reason: string;
    reporterKey: string;
    reporterId: string | null;
  },
): Promise<
  Result<{ reported: boolean; reportCount: number }, NoteInteractionError>
> {
  const note = await NovelRepo.findNote(context.db, input.id);
  if (!note || note.status !== "visible")
    return err({ reason: "NOTE_NOT_FOUND" });
  if (!note.isPublic) return err({ reason: "NOT_PUBLIC" });
  return ok(
    await NovelRepo.insertReport(context.db, {
      noteId: input.id,
      reporterId: input.reporterId,
      reporterKey: input.reporterKey,
      reason: input.reason,
    }),
  );
}

export async function voteNote(
  context: ReadContext & { session: Session },
  input: { id: number; choice: "remove" | "keep" },
): Promise<
  Result<
    { choice: "remove" | "keep"; removeVotes: number; keepVotes: number },
    NoteInteractionError
  >
> {
  const note = await NovelRepo.findNote(context.db, input.id);
  if (!note || note.status !== "visible")
    return err({ reason: "NOTE_NOT_FOUND" });
  if (!note.isPublic) return err({ reason: "NOT_PUBLIC" });
  if (note.reportCount < NOVEL_REPORT_VOTE_THRESHOLD)
    return err({ reason: "TOO_FEW_REPORTS" });
  const counts = await NovelRepo.castVote(
    context.db,
    input.id,
    context.session.user.id,
    input.choice,
  );
  await NovelRepo.addScore(
    context.db,
    context.session.user.id,
    NOVEL_VOTE_POINTS,
    "novel_note_vote",
  );
  return ok({ choice: input.choice, ...counts });
}

// ==================== the Admin's chapters ====================

export function listAdminChapters(
  context: ReadContext,
  novelId: number,
): Promise<AdminChapter[]> {
  return NovelRepo.listAdminChapters(context.db, novelId);
}

export async function getAdminChapter(
  context: ReadContext,
  novelId: number,
  order: number,
): Promise<AdminChapterContent | null> {
  const meta = await NovelRepo.findAdminChapter(context.db, novelId, order);
  if (!meta) return null;
  const content = await getChapterText(context.env, novelId, order);
  if (content === null) return null;
  return { ...meta, content };
}

async function recountNovel(context: ReadContext, novelId: number) {
  const chapters = await NovelRepo.listAdminChapters(context.db, novelId);
  await NovelRepo.setNovelChapterTotals(
    context.db,
    novelId,
    chapters.length,
    chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
  );
}

/** Makes room in R2 for a chapter inserted at `order`. */
async function shiftChapterTextsUp(
  context: ReadContext,
  novelId: number,
  order: number,
  max: number,
) {
  const texts: Array<{ order: number; text: string }> = [];
  for (let current = order; current <= max; current += 1) {
    const text = await getChapterText(context.env, novelId, current);
    if (text !== null) texts.push({ order: current, text });
  }
  for (const item of texts.reverse())
    await putChapterText(context.env, novelId, item.order + 1, item.text);
}

export async function createAdminChapter(
  context: ReadContext,
  input: { novelId: number; title: string; content: string; order?: number },
) {
  const novel = await NovelRepo.findNovelById(context.db, input.novelId);
  if (!novel) return null;
  const max = await NovelRepo.findMaxChapterOrder(context.db, input.novelId);
  const order = Math.min(input.order ?? max + 1, max + 1);
  if (order < 1) return null;
  if (order <= max)
    await shiftChapterTextsUp(context, input.novelId, order, max);
  await putChapterText(context.env, input.novelId, order, input.content);
  await NovelRepo.insertChapterRow(
    context.db,
    input.novelId,
    order,
    input.title,
    NovelRepo.countWords(input.content),
  );
  await recountNovel(context, input.novelId);
  return NovelRepo.findAdminChapter(context.db, input.novelId, order);
}

export async function updateAdminChapter(
  context: ReadContext,
  input: {
    novelId: number;
    order: number;
    title: string;
    content: string;
    version: number;
  },
) {
  const current = await NovelRepo.findAdminChapter(
    context.db,
    input.novelId,
    input.order,
  );
  if (!current) return { status: "missing" as const };
  if (current.version !== input.version) return { status: "conflict" as const };
  const wordCount = NovelRepo.countWords(input.content);
  const updated = await NovelRepo.updateChapterRow(context.db, {
    ...input,
    wordCount,
  });
  if (!updated) return { status: "conflict" as const };
  await putChapterText(context.env, input.novelId, input.order, input.content);
  await recountNovel(context, input.novelId);
  return { status: "ok" as const, chapter: updated };
}

/** Moves every R2 chapter text down one, after deleting `orders`. */
async function closeChapterGaps(
  context: ReadContext,
  novelId: number,
  deleted: number[],
  max: number,
) {
  const deletedSet = new Set(deleted);
  const texts: Array<{ order: number; text: string }> = [];
  for (let current = 1; current <= max; current += 1) {
    if (deletedSet.has(current)) continue;
    const text = await getChapterText(context.env, novelId, current);
    if (text !== null) texts.push({ order: current, text });
  }
  for (const order of deleted)
    await context.env.R2.delete(`novels/${novelId}/chapters/${order}.txt`);
  for (const item of texts) {
    const newOrder =
      item.order - deleted.filter((value) => value < item.order).length;
    if (newOrder !== item.order)
      await putChapterText(context.env, novelId, newOrder, item.text);
  }
}

export async function deleteAdminChapters(
  context: ReadContext,
  novelId: number,
  orders: number[],
) {
  const max = await NovelRepo.findMaxChapterOrder(context.db, novelId);
  await closeChapterGaps(context, novelId, orders, max);
  await NovelRepo.deleteChapterRows(context.db, novelId, orders);
  await recountNovel(context, novelId);
  return true;
}

export async function moveAdminChapter(
  context: ReadContext,
  novelId: number,
  from: number,
  to: number,
) {
  const max = await NovelRepo.findMaxChapterOrder(context.db, novelId);
  if (from < 1 || to < 1 || from > max || to > max || from === to) return false;
  const [fromText, toText] = await Promise.all([
    getChapterText(context.env, novelId, from),
    getChapterText(context.env, novelId, to),
  ]);
  await NovelRepo.swapChapters(context.db, novelId, from, to);
  if (fromText !== null)
    await putChapterText(context.env, novelId, to, fromText);
  if (toText !== null) await putChapterText(context.env, novelId, from, toText);
  return true;
}

// ==================== the Admin's reading report ====================

export function getNovelStats(context: ReadContext, days: number) {
  return NovelRepo.readNovelStats(context.db, days);
}

// ==================== annotation moderation ====================

export function listAdminNotes(
  context: ReadContext,
  input: { status?: "visible" | "removed"; limit: number },
) {
  return NovelRepo.listAdminNotes(context.db, input);
}

export async function removeAdminNote(
  context: ReadContext & { session: Session },
  id: number,
  reason: string,
) {
  const note = await NovelRepo.findNote(context.db, id);
  if (!note) return null;
  const status = await NovelRepo.setNoteStatus(context.db, id, "removed", {
    removedBy: context.session.user.id,
    removeReason: reason,
  });
  await NovelRepo.resolveReports(context.db, id);
  await NovelRepo.addScore(
    context.db,
    note.userId,
    NOVEL_RESOLVED_REPORT_POINTS,
    "novel_note_removed",
  );
  await NovelRepo.muteUser(
    context.db,
    note.userId,
    reason || "novel_note_removed",
  );
  return status;
}

export async function restoreAdminNote(context: ReadContext, id: number) {
  const note = await NovelRepo.findNote(context.db, id);
  if (!note) return null;
  return NovelRepo.setNoteStatus(context.db, id, "visible");
}

export async function listAdminMutes(
  context: ReadContext,
): Promise<AdminNovelMute[]> {
  const now = Date.now();
  const rows = await NovelRepo.listNovelMutes(context.db);
  return rows.map((row) => ({
    ...row,
    active: row.until === null || row.until.getTime() > now,
  }));
}

/** Ends one mute by its row id; the escalation history stays. */
export async function unmuteNovelReader(context: ReadContext, id: number) {
  const mute = await NovelRepo.findNovelMuteById(context.db, id);
  if (!mute) return null;
  await NovelRepo.endNovelMute(context.db, id);
  return { id };
}

// ==================== export and backup ====================

export async function exportChapterText(
  context: ReadContext,
  novelId: number,
  order: number,
) {
  const meta = await NovelRepo.findAdminChapter(context.db, novelId, order);
  if (!meta) return null;
  const content = await getChapterText(context.env, novelId, order);
  if (content === null) return null;
  return { title: meta.title, content };
}

export async function exportNovelText(context: ReadContext, novelId: number) {
  const novel = await NovelRepo.findNovelById(context.db, novelId);
  if (!novel) return null;
  const chapters = await NovelRepo.listAdminChapters(context.db, novelId);
  const parts: string[] = [`${novel.title}\n${novel.author}\n`];
  for (const chapter of chapters) {
    const content = await getChapterText(context.env, novelId, chapter.order);
    parts.push(
      `\n\n${chapter.title || `第 ${chapter.order} 章`}\n\n${content ?? ""}`,
    );
  }
  return { title: novel.title, content: parts.join("") };
}

export type NovelBackup = {
  version: 1;
  exportedAt: string;
  novels: Array<{
    title: string;
    author: string;
    description: string;
    category: string | null;
    coverUrl: string | null;
    language: string | null;
    chapters: Array<{ title: string; content: string }>;
  }>;
};

export async function exportNovelBackup(
  context: ReadContext,
): Promise<NovelBackup> {
  const novels = await NovelRepo.listAdminNovels(context.db, 1000);
  const backup: NovelBackup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    novels: [],
  };
  for (const novel of novels) {
    const chapters = await NovelRepo.listAdminChapters(context.db, novel.id);
    const items: Array<{ title: string; content: string }> = [];
    for (const chapter of chapters)
      items.push({
        title: chapter.title,
        content:
          (await getChapterText(context.env, novel.id, chapter.order)) ?? "",
      });
    backup.novels.push({
      title: novel.title,
      author: novel.author,
      description: novel.description,
      category: novel.category,
      coverUrl: novel.coverUrl,
      language: novel.language,
      chapters: items,
    });
  }
  return backup;
}

export async function restoreNovelBackup(
  context: ReadContext,
  backup: NovelBackup,
) {
  let restored = 0;
  for (const book of backup.novels) {
    const novelId = await NovelRepo.insertNovel(context.db, {
      title: book.title,
      author: book.author,
      description: book.description,
      category: book.category,
      coverUrl: book.coverUrl,
      language: book.language,
    });
    let words = 0;
    for (const [index, chapter] of book.chapters.entries()) {
      await putChapterText(context.env, novelId, index + 1, chapter.content);
      const wordCount = NovelRepo.countWords(chapter.content);
      words += wordCount;
      await NovelRepo.insertChapterRow(
        context.db,
        novelId,
        index + 1,
        chapter.title,
        wordCount,
      );
    }
    await NovelRepo.setNovelStatus(context.db, novelId, "ready", {
      chapterCount: book.chapters.length,
      wordCount: words,
    });
    restored += 1;
  }
  return restored;
}
