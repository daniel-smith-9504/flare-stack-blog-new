import type { NovelSettings } from "@/features/novels/novels.schema";

/** Books a page of the public shelf shows. */
export const NOVELS_PER_PAGE = 12;

/** The largest file the Admin may upload; R2 takes it streamed, not buffered. */
export const NOVEL_IMPORT_MAX_BYTES = 30 * 1024 * 1024;

/** A book longer than this is refused rather than turned into that many R2 objects. */
export const NOVEL_MAX_CHAPTERS = 5000;

/** Characters of context kept on each side of a highlight, to re-find it. */
export const NOVEL_NOTE_CONTEXT_LENGTH = 32;

export const NOVEL_NOTE_MAX_LENGTH = 2000;
export const NOVEL_QUOTE_MAX_LENGTH = 4000;

export const NOVEL_FONT_SIZE_MIN = 14;
export const NOVEL_FONT_SIZE_MAX = 32;
export const NOVEL_LINE_HEIGHT_MIN = 1.4;
export const NOVEL_LINE_HEIGHT_MAX = 2.4;

/** The R2 prefix every chapter of a book lives under. */
export function novelChapterPrefix(novelId: number) {
  return `novels/${novelId}/chapters/`;
}

/** Where one chapter's plain text lives in R2. */
export function novelChapterKey(novelId: number, order: number) {
  return `${novelChapterPrefix(novelId)}${String(order).padStart(5, "0")}.txt`;
}

export const DEFAULT_NOVEL_SETTINGS: NovelSettings = {
  theme: "light",
  fontSize: 18,
  lineHeight: 1.8,
  fontFamily: "serif",
};
