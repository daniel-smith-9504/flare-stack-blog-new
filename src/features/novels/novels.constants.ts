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

export const NOVEL_PAGE_WIDTH_MIN = 560;
export const NOVEL_PAGE_WIDTH_MAX = 960;
export const NOVEL_PAGE_WIDTH_DEFAULT = 720;

/** A reading heartbeat's longest interval, so an idle tab adds no time. */
export const NOVEL_READING_HEARTBEAT_SECONDS = 30;

/** Shared highlights longer than this start folded, as the reference does. */
export const NOVEL_NOTE_COLLAPSE_LENGTH = 220;

/** Reports on one highlight needed before the community may vote. */
export const NOVEL_REPORT_VOTE_THRESHOLD = 3;

/** Points a reader earns for casting a vote, and an Admin loses per report. */
export const NOVEL_VOTE_POINTS = 0.1;
export const NOVEL_RESOLVED_REPORT_POINTS = 0.2;
export const NOVEL_IGNORED_REPORT_POINTS = -1;

/** A removed highlight's author is muted this many days, step by step. */
export const NOVEL_MUTE_DAYS = [1, 3, 7, 30] as const;

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
  pageWidth: NOVEL_PAGE_WIDTH_DEFAULT,
  readingMode: "scroll",
};
