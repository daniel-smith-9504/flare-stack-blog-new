import type {
  SaveSettingsInput,
  NovelSettings,
  OwnNote,
} from "@/features/novels/novels.schema";
import * as NovelRepo from "@/features/novels/data/novels.data";
import {
  deleteImportFile,
  deleteNovelChapters,
  getChapterText,
  putImportFile,
} from "@/features/novels/data/novels.storage";
import {
  DEFAULT_NOVEL_SETTINGS,
  NOVELS_PER_PAGE,
  NOVEL_IMPORT_MAX_BYTES,
  NOVEL_NOTE_CONTEXT_LENGTH,
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
  novelId: number,
  chapterOrder: number,
) {
  return NovelRepo.listPublicNotes(context.db, novelId, chapterOrder);
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
  reason: "CHAPTER_NOT_FOUND" | "NOTE_OFFSET_INVALID";
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
