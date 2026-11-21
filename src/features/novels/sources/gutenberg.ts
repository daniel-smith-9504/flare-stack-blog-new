import type { GutenbergBook } from "@/features/novels/novels.schema";

const GUTENDEX = "https://gutendex.com/books";

type GutendexBook = {
  id: number;
  title: string;
  authors: Array<{ name: string }>;
  languages: Array<string>;
  formats: Record<string, string>;
  download_count: number;
};

function toBook(book: GutendexBook): GutenbergBook {
  return {
    id: book.id,
    title: book.title,
    author: book.authors.map((author) => author.name).join(", "),
    languages: book.languages,
    coverUrl: book.formats["image/jpeg"] ?? null,
    downloadCount: book.download_count,
  };
}

async function request(url: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "flare-stack-blog novel-importer" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Gutenberg answered ${response.status} for ${url}.`);
  return (await response.json()) as unknown;
}

/** Searches Project Gutenberg's free catalogue through gutendex.com. */
export async function searchGutenberg(query: string) {
  const url = new URL(GUTENDEX);
  url.searchParams.set("search", query);
  const body = (await request(url.toString())) as { results?: unknown };
  const results = Array.isArray(body.results)
    ? (body.results as Array<GutendexBook>)
    : [];
  return results.slice(0, 12).map(toBook);
}

/** One Gutenberg book and the EPUB file an import downloads. */
export async function fetchGutenbergBook(id: number) {
  const body = (await request(`${GUTENDEX}/${id}`)) as GutendexBook;
  const epubUrl =
    body.formats["application/epub+zip"] ??
    body.formats["application/octet-stream"];
  if (!epubUrl)
    throw new Error("This Gutenberg book offers no EPUB file to import.");
  return { book: toBook(body), epubUrl };
}
