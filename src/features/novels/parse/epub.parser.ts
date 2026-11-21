import { strFromU8, unzipSync } from "fflate";
import type { ParsedChapter, ParsedNovel } from "./txt.parser";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
};

function decodeEntities(value: string) {
  return value.replace(
    /&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/giu,
    (match, entity: string) => {
      if (entity[0] === "#") {
        const code =
          entity[1] === "x" || entity[1] === "X"
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code > 0
          ? String.fromCodePoint(code)
          : match;
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    },
  );
}

function stripTags(value: string) {
  return decodeEntities(value.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

/** The readable text of one XHTML document, one paragraph per blank line. */
function htmlToText(html: string) {
  let text = html
    .replace(/<head[\s\S]*?<\/head>/giu, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(
      /<\/(?:p|div|h[1-6]|li|blockquote|section|article|tr|figcaption)>/giu,
      "\n\n",
    )
    .replace(/<[^>]*>/gu, "");
  text = decodeEntities(text)
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  return text;
}

function chapterTitle(html: string) {
  const heading = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/iu.exec(html);
  if (heading) {
    const title = stripTags(heading[1]);
    if (title.length > 0 && title.length <= 120) return title;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(html);
  if (titleTag) {
    const title = stripTags(titleTag[1]);
    if (title.length > 0 && title.length <= 120) return title;
  }
  return "";
}

function resolveHref(baseDir: string, href: string) {
  const clean = href.split("#")[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  const parts = `${baseDir}${decoded}`.split("/");
  const resolved: Array<string> = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function attribute(tag: string, name: string) {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu").exec(
    tag,
  );
  return match?.[1] ?? null;
}

function isEncrypted(encryptionXml: string) {
  // Fonts and images may be obfuscated legitimately; only encrypted reading
  // documents make the book unreadable.
  for (const block of encryptionXml.match(
    /<(?:enc:)?EncryptedData\b[\s\S]*?<\/(?:enc:)?EncryptedData>/giu,
  ) ?? []) {
    if (/(?:\.x?html?|\.opf)(?:[#?"']|$)/iu.test(block)) return true;
  }
  return false;
}

/**
 * Reads an EPUB: the container names the OPF package, the package names the
 * reading order, and each document in that order contributes a chapter.
 */
export function parseEpub(data: Uint8Array): ParsedNovel {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (file) =>
        file.name === "META-INF/container.xml" ||
        file.name === "META-INF/encryption.xml" ||
        /\.(?:opf|xml|x?html?)$/iu.test(file.name),
    });
  } catch {
    throw new Error("The file is not a readable EPUB archive.");
  }

  const container = files["META-INF/container.xml"];
  if (!container) throw new Error("The EPUB has no container.xml.");

  const containerXml = strFromU8(container);
  const rootPath = attribute(
    /<rootfile\b[^>]*>/iu.exec(containerXml)?.[0] ?? "",
    "full-path",
  );
  if (!rootPath) throw new Error("The EPUB names no package document.");

  if (files["META-INF/encryption.xml"]) {
    const encryptionXml = strFromU8(files["META-INF/encryption.xml"]);
    if (isEncrypted(encryptionXml))
      throw new Error("The EPUB is encrypted (DRM) and cannot be imported.");
  }

  const opf = files[rootPath];
  if (!opf) throw new Error("The EPUB's package document is missing.");
  const opfXml = strFromU8(opf);
  const baseDir = rootPath.includes("/")
    ? rootPath.slice(0, rootPath.lastIndexOf("/") + 1)
    : "";

  const title = stripTags(
    /<dc:title[^>]*>([\s\S]*?)<\/dc:title>/iu.exec(opfXml)?.[1] ?? "",
  );
  const author = stripTags(
    /<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/iu.exec(opfXml)?.[1] ?? "",
  );

  const manifest = new Map<string, { href: string; type: string }>();
  for (const tag of opfXml.match(/<item\b[^>]*\/?>/giu) ?? []) {
    const id = attribute(tag, "id");
    const href = attribute(tag, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      href: resolveHref(baseDir, href),
      type: attribute(tag, "media-type") ?? "",
    });
  }

  const spine: Array<string> = [];
  for (const tag of opfXml.match(/<itemref\b[^>]*\/?>/giu) ?? []) {
    const idref = attribute(tag, "idref");
    const item = idref ? manifest.get(idref) : undefined;
    if (item) spine.push(item.href);
  }

  const documents =
    spine.length > 0
      ? spine
      : [...manifest.values()]
          .filter((item) => /x?html|xml/iu.test(item.type))
          .map((item) => item.href);

  const chapters: Array<ParsedChapter> = [];
  for (const path of documents) {
    const file = files[path];
    if (!file) continue;
    const html = strFromU8(file);
    const content = htmlToText(html);
    if (content.length === 0) continue;
    const chapter: ParsedChapter = { title: chapterTitle(html), content };
    const previous = chapters.at(-1);
    // A document that is only a few lines is usually the tail of the one
    // before it (a title page, a split paragraph); keep the book readable.
    if (previous && content.length < 140) {
      previous.content = `${previous.content}\n\n${content}`.trim();
      if (previous.title === "") previous.title = chapter.title;
    } else {
      chapters.push(chapter);
    }
  }

  if (chapters.length === 0)
    throw new Error("The EPUB holds no readable text.");

  return {
    title: title || undefined,
    author: author || undefined,
    chapters,
  };
}
