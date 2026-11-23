import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";
import type { ParsedChapter, ParsedNovel } from "./txt.parser";

/**
 * The EPUB reader is built the way Readium and epub.js read a package: the
 * container names the OPF, the OPF's spine names the reading order, and the
 * NAV (EPUB 3) or NCX (EPUB 2) supplies chapter titles. Unlike epub.js it
 * needs no DOM, so it runs in the Worker that consumes the import queue.
 */
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

type XmlObject = Record<string, unknown>;

type ManifestItem = {
  id: string;
  href: string;
  type: string;
  properties: string;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  middot: "·",
  bull: "•",
  dagger: "†",
  permil: "‰",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  para: "¶",
  sect: "§",
  laquo: "«",
  raquo: "»",
  cent: "¢",
  pound: "£",
  yen: "¥",
  euro: "€",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
};

function isObject(value: unknown): value is XmlObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** XML repeats a tag as an array only when it occurs more than once. */
function nodes(value: unknown): Array<unknown> {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    for (const part of value) {
      const text = textOf(part);
      if (text.trim().length > 0) return text;
    }
    return "";
  }
  if (isObject(value)) return textOf(value["#text"]);
  return "";
}

function attribute(node: unknown, name: string): string | null {
  if (!isObject(node)) return null;
  const value = node[`@_${name}`];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

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

/** One normalized path inside the archive, so `./OEBPS/x` and `OEBPS/x` match. */
function normalizePath(path: string) {
  return path
    .replace(/\\/gu, "/")
    .replace(/^(?:\.\/)+/u, "")
    .replace(/^\/+/u, "")
    .replace(/\/+/gu, "/");
}

function decodePath(path: string) {
  try {
    return normalizePath(decodeURIComponent(path));
  } catch {
    return path;
  }
}

function resolveHref(baseDir: string, href: string) {
  const clean = href.split(/[?#]/u)[0] ?? "";
  const parts = `${baseDir}${decodePath(clean)}`.split("/");
  const resolved: Array<string> = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function directoryOf(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index + 1);
}

/** Looks an entry up literally, percent-decoded, then case-insensitively. */
function archiveReader(files: Record<string, Uint8Array>) {
  const exact = new Map<string, Uint8Array>();
  const folded = new Map<string, string>();
  for (const [name, bytes] of Object.entries(files)) {
    const path = normalizePath(name);
    exact.set(path, bytes);
    exact.set(decodePath(path), bytes);
    folded.set(path.toLowerCase(), path);
  }
  return (path: string) => {
    const normalized = normalizePath(path);
    const direct = exact.get(normalized) ?? exact.get(decodePath(normalized));
    if (direct) return direct;
    const real = folded.get(normalized.toLowerCase());
    return real ? (exact.get(real) ?? null) : null;
  };
}

function parseXml(source: string): XmlObject | null {
  try {
    const parsed: unknown = xmlParser.parse(source);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function packageNode(opf: XmlObject): XmlObject {
  return isObject(opf.package) ? opf.package : opf;
}

function readManifest(pkg: XmlObject): Array<ManifestItem> {
  const manifest = isObject(pkg.manifest) ? pkg.manifest : {};
  const items: Array<ManifestItem> = [];
  for (const node of nodes(manifest.item)) {
    const id = attribute(node, "id");
    const href = attribute(node, "href");
    if (!id || !href) continue;
    items.push({
      id,
      href,
      type: attribute(node, "media-type") ?? "",
      properties: attribute(node, "properties") ?? "",
    });
  }
  return items;
}

function isReadingDocument(item: ManifestItem) {
  return (
    /xhtml|html|xml/iu.test(item.type) || /\.(?:x?html?|xht)$/iu.test(item.href)
  );
}

function hasProperty(item: ManifestItem, name: string) {
  return item.properties.split(/\s+/u).includes(name);
}

function collectNavTitles(
  source: string,
  baseDir: string,
  titles: Map<string, string>,
) {
  const doc = parseXml(source);
  if (!doc) return;
  const html = isObject(doc.html) ? doc.html : doc;
  const body = isObject(html.body) ? html.body : {};
  const navs = nodes(body.nav);
  const toc =
    navs.find((nav) => attribute(nav, "type")?.split(/\s+/u).includes("toc")) ??
    navs[0];

  const walk = (value: unknown) => {
    if (!isObject(value)) return;
    for (const entry of nodes(value.li)) {
      if (!isObject(entry)) continue;
      const anchor = nodes(entry.a)[0];
      const href = attribute(anchor, "href");
      if (href) {
        const title = stripTags(textOf(anchor));
        const path = resolveHref(baseDir, href);
        if (path && title && !titles.has(path)) titles.set(path, title);
      }
      walk(entry.ol);
    }
  };

  if (isObject(toc)) walk(toc.ol);
}

function collectNcxTitles(
  source: string,
  baseDir: string,
  titles: Map<string, string>,
) {
  const doc = parseXml(source);
  if (!doc) return;
  const ncx = isObject(doc.ncx) ? doc.ncx : doc;
  const navMap = isObject(ncx.navMap) ? ncx.navMap : {};

  const walk = (value: unknown) => {
    for (const point of nodes(value)) {
      if (!isObject(point)) continue;
      const labelNode = isObject(point.navLabel)
        ? point.navLabel
        : nodes(point.navLabel)[0];
      const src = attribute(point.content, "src");
      if (src && isObject(labelNode)) {
        const title = stripTags(textOf(labelNode.text));
        const path = resolveHref(baseDir, src);
        if (path && title && !titles.has(path)) titles.set(path, title);
      }
      walk(point.navPoint);
    }
  };

  walk(navMap.navPoint);
}

/** The readable text of one XHTML document, one paragraph per blank line. */
function htmlToText(html: string) {
  let text = html
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<head[\s\S]*?<\/head>/giu, "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<hr\s*\/?>/giu, "\n\n")
    .replace(
      /<\/(?:p|div|h[1-6]|li|blockquote|section|article|aside|header|footer|nav|tr|td|th|figcaption|pre)>/giu,
      "\n\n",
    )
    .replace(/<[^>]*>/gu, "");
  text = decodeEntities(text)
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u200b-\u200d\ufeff]/gu, "")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t\f\v]+/gu, " ");
  return text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function headingTitle(source: string) {
  const heading = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/iu.exec(source);
  if (heading?.[2]) {
    const title = stripTags(heading[2]);
    if (title.length > 0 && title.length <= 120) return title;
  }
  return "";
}

function titleTag(source: string) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(source);
  if (!match?.[1]) return "";
  const title = stripTags(match[1]);
  return title.length > 0 && title.length <= 120 ? title : "";
}

/**
 * A single-document book (some converters wrap a whole novel in one XHTML)
 * becomes chapters at its own top-level headings. Per-file books are left
 * exactly as the spine states.
 */
function splitAtHeadings(source: string): Array<string> {
  const matches = [...source.matchAll(/<h[12]\b[^>]*>/giu)];
  if (matches.length < 3) return [];
  return matches.map((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? source.length;
    return source.slice(start, end);
  });
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

function findPackagePath(
  containerXml: string,
  archive: ReturnType<typeof archiveReader>,
  files: Record<string, Uint8Array>,
) {
  const container = parseXml(containerXml);
  const rootfiles = isObject(container?.container)
    ? isObject(container.container.rootfiles)
      ? container.container.rootfiles
      : {}
    : {};
  for (const rootfile of nodes(rootfiles.rootfile)) {
    const path = attribute(rootfile, "full-path");
    if (path && archive(path)) return normalizePath(path);
  }
  // Some converters write a container that no parser accepts; any OPF works.
  const fallback = Object.keys(files).find((name) => /\.opf$/iu.test(name));
  return fallback ? normalizePath(fallback) : null;
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
        /\.(?:opf|ncx|xml|xht|x?html?)$/iu.test(file.name),
    });
  } catch {
    throw new Error("The file is not a readable EPUB archive.");
  }

  const archive = archiveReader(files);
  const container = archive("META-INF/container.xml");
  const fallbackPackage = Object.keys(files).find((name) =>
    /\.opf$/iu.test(name),
  );
  const packagePath = container
    ? findPackagePath(strFromU8(container), archive, files)
    : fallbackPackage
      ? normalizePath(fallbackPackage)
      : null;
  if (!packagePath) throw new Error("The EPUB names no package document.");

  const encryption = archive("META-INF/encryption.xml");
  if (encryption && isEncrypted(strFromU8(encryption)))
    throw new Error("The EPUB is encrypted (DRM) and cannot be imported.");

  const opfBytes = archive(packagePath);
  if (!opfBytes) throw new Error("The EPUB's package document is missing.");

  const opfXml = strFromU8(opfBytes);
  const opf = parseXml(opfXml);
  if (!opf) throw new Error("The EPUB's package document is unreadable.");

  const pkg = packageNode(opf);
  const metadata = isObject(pkg.metadata) ? pkg.metadata : {};
  const title = stripTags(textOf(metadata.title));
  const author = stripTags(textOf(metadata.creator));

  const baseDir = resolveHref(
    directoryOf(packagePath),
    attribute(pkg, "base") ?? "",
  );
  const normalizedBase = baseDir.length > 0 ? `${baseDir}/` : "";

  const manifest = readManifest(pkg);
  const byId = new Map(manifest.map((item) => [item.id, item]));
  const titles = new Map<string, string>();

  const navItem = manifest.find((item) => hasProperty(item, "nav"));
  if (navItem) {
    const bytes = archive(resolveHref(normalizedBase, navItem.href));
    if (bytes) collectNavTitles(strFromU8(bytes), normalizedBase, titles);
  }

  const spineNode = isObject(pkg.spine) ? pkg.spine : {};
  const ncxItem =
    byId.get(attribute(spineNode, "toc") ?? "") ??
    manifest.find((item) => /dtbncx/iu.test(item.type));
  if (ncxItem) {
    const bytes = archive(resolveHref(normalizedBase, ncxItem.href));
    if (bytes) collectNcxTitles(strFromU8(bytes), normalizedBase, titles);
  }

  const documents: Array<{ path: string; title: string }> = [];
  const seen = new Set<string>();
  const addDocument = (item: ManifestItem) => {
    if (hasProperty(item, "nav")) return;
    const path = resolveHref(normalizedBase, item.href);
    if (!path || seen.has(path)) return;
    seen.add(path);
    documents.push({ path, title: titles.get(path) ?? "" });
  };

  for (const ref of nodes(spineNode.itemref)) {
    if (attribute(ref, "linear") === "no") continue;
    const item = byId.get(attribute(ref, "idref") ?? "");
    if (item && isReadingDocument(item)) addDocument(item);
  }
  if (documents.length === 0) {
    for (const item of manifest) if (isReadingDocument(item)) addDocument(item);
  }

  const chapters: Array<ParsedChapter> = [];
  for (const document of documents) {
    const bytes = archive(document.path);
    if (!bytes) continue;
    const source = strFromU8(bytes);
    const pieces = documents.length === 1 ? splitAtHeadings(source) : [];

    for (const piece of pieces.length > 0 ? pieces : [source]) {
      const content = htmlToText(piece);
      if (content.length === 0) continue;
      const chapterTitle =
        headingTitle(piece) || document.title || titleTag(piece);
      const previous = chapters.at(-1);
      // A document with neither heading nor enough text is usually the tail of
      // the one before it; keep it there instead of as an empty chapter.
      if (previous && content.length < 140 && chapterTitle === "") {
        previous.content = `${previous.content}\n\n${content}`.trim();
        continue;
      }
      chapters.push({ title: chapterTitle, content });
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
