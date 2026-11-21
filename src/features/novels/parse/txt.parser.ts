export type ParsedChapter = { title: string; content: string };

export type ParsedNovel = {
  title?: string;
  author?: string;
  chapters: Array<ParsedChapter>;
};

// 第1章 / 第十二回 / 第三卷 之类的中文分章标题，允许标题后带一段副标题。
const CJK_HEADING =
  /^\s*(第[0-9０-９一二三四五六七八九十百千零两〇]+[章节回卷集部篇][^\n]{0,60})\s*$/u;
// 英文书常见的 Chapter 1 / CHAPTER IV。
const LATIN_HEADING =
  /^\s*((?:chapter|part|book)\s+[0-9ivxlcdm]+[^\n]{0,60})\s*$/iu;

function isHeading(line: string) {
  return CJK_HEADING.test(line) || LATIN_HEADING.test(line);
}

function normalize(text: string) {
  return text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u00a0/gu, " ");
}

/**
 * Splits a plain-text book by its chapter headings. A text without any
 * heading is one chapter, which the shelf still shows as a book.
 */
export function parseTxt(text: string): ParsedNovel {
  const normalized = normalize(text);
  if (normalized.trim().length === 0)
    throw new Error("The text file is empty.");

  const lines = normalized.split("\n");
  const chapters: Array<ParsedChapter> = [];
  let title = "";
  let buffer: Array<string> = [];
  let started = false;

  const flush = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (content.length === 0) return;
    chapters.push({ title, content });
  };

  for (const line of lines) {
    if (isHeading(line)) {
      flush();
      title = line.trim();
      started = true;
      continue;
    }
    if (!started && line.trim().length === 0) continue;
    buffer.push(line);
  }
  flush();

  if (chapters.length === 0) {
    const content = normalized.trim();
    return { chapters: [{ title: "", content }] };
  }

  return { chapters };
}
