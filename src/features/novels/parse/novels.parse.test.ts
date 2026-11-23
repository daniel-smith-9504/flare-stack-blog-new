import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseEpub } from "./epub.parser";
import { parseTxt } from "./txt.parser";

describe("parseTxt", () => {
  it("splits on Chinese chapter headings", () => {
    const parsed = parseTxt(
      [
        "第一章 开始",
        "这是第一章的正文。",
        "",
        "第二章 继续",
        "这是第二章的正文。",
      ].join("\n"),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 开始",
      "第二章 继续",
    ]);
    expect(parsed.chapters[0]?.content).toBe("这是第一章的正文。");
  });

  it("keeps a text without headings as one chapter", () => {
    const parsed = parseTxt("只有一段正文，没有章节标题。");
    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.title).toBe("");
    expect(parsed.chapters[0]?.content).toBe("只有一段正文，没有章节标题。");
  });

  it("refuses an empty file", () => {
    expect(() => parseTxt("   \n\t ")).toThrow();
  });
});

function epub(entries: Record<string, string>) {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([path, content]) => [
        path,
        strToU8(content),
      ]),
    ),
  );
}

describe("parseEpub", () => {
  const container =
    '<?xml version="1.0"?><container><rootfiles>' +
    '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
    "</rootfiles></container>";

  it("reads the package metadata and the spine in order", () => {
    const parsed = parseEpub(
      epub({
        "META-INF/container.xml": container,
        "OEBPS/content.opf":
          '<?xml version="1.0"?><package><metadata>' +
          "<dc:title>My Book</dc:title><dc:creator>Jane Doe</dc:creator>" +
          "</metadata><manifest>" +
          '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>' +
          '</manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
        "OEBPS/one.xhtml":
          "<html><head><title>Ignored</title></head><body><h1>Chapter One</h1><p>Hello &amp; welcome.</p></body></html>",
        "OEBPS/two.xhtml":
          "<html><body><h2>Chapter Two</h2><p>Another page with enough text to stand on its own, long enough that it is not mistaken for the tail of the chapter before it, and so keeps its own heading in the contents.</p></body></html>",
      }),
    );
    expect(parsed.title).toBe("My Book");
    expect(parsed.author).toBe("Jane Doe");
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter One",
      "Chapter Two",
    ]);
    expect(parsed.chapters[0]?.content).toContain("Hello & welcome.");
  });

  it("refuses a book whose reading documents are encrypted", () => {
    expect(() =>
      parseEpub(
        epub({
          "META-INF/container.xml": container,
          "META-INF/encryption.xml":
            '<encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/one.xhtml"/></CipherData></EncryptedData></encryption>',
          "OEBPS/content.opf":
            '<package><metadata><dc:title>Locked</dc:title></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>',
          "OEBPS/one.xhtml": "<html><body><p>Secret</p></body></html>",
        }),
      ),
    ).toThrow(/encrypted/u);
  });

  it("names chapters from an EPUB 3 navigation document", () => {
    const parsed = parseEpub(
      epub({
        "META-INF/container.xml": container,
        "OEBPS/content.opf":
          "<package><metadata><dc:title>Navigated</dc:title></metadata><manifest>" +
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
          '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>' +
          '</manifest><spine><itemref idref="one"/></spine></package>',
        "OEBPS/nav.xhtml":
          '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="one.xhtml">From the contents</a></li></ol></nav></body></html>',
        "OEBPS/one.xhtml":
          "<html><body><p>A short body without a heading of its own.</p></body></html>",
      }),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "From the contents",
    ]);
  });

  it("names chapters from an EPUB 2 NCX", () => {
    const parsed = parseEpub(
      epub({
        "META-INF/container.xml": container,
        "OEBPS/content.opf":
          "<package><metadata><dc:title>Legacy</dc:title></metadata><manifest>" +
          '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
          '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>' +
          '</manifest><spine toc="ncx"><itemref idref="one"/></spine></package>',
        "OEBPS/toc.ncx":
          '<ncx><navMap><navPoint><navLabel><text>Legacy title</text></navLabel><content src="one.xhtml"/></navPoint></navMap></ncx>',
        "OEBPS/one.xhtml": "<html><body><p>Body text.</p></body></html>",
      }),
    );
    expect(parsed.chapters[0]?.title).toBe("Legacy title");
  });

  it("falls back to the manifest when the spine is missing", () => {
    const parsed = parseEpub(
      epub({
        "META-INF/container.xml": container,
        "OEBPS/content.opf":
          "<package><metadata><dc:title>No spine</dc:title></metadata><manifest>" +
          '<item id="one" href="./one.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>' +
          "</manifest></package>",
        "OEBPS/one.xhtml":
          "<html><body><h1>One</h1><p>First.</p></body></html>",
        "OEBPS/two.xhtml":
          "<html><body><h1>Two</h1><p>Second.</p></body></html>",
      }),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "One",
      "Two",
    ]);
  });

  it("splits a single-document book at its own headings", () => {
    const body = Array.from(
      { length: 3 },
      (_, index) =>
        `<h1>Chapter ${index + 1}</h1><p>${"Long enough text. ".repeat(30)}</p>`,
    ).join("");
    const parsed = parseEpub(
      epub({
        "META-INF/container.xml": container,
        "OEBPS/content.opf":
          "<package><metadata><dc:title>Single file</dc:title></metadata><manifest>" +
          '<item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>' +
          '</manifest><spine><itemref idref="one"/></spine></package>',
        "OEBPS/one.xhtml": `<html><body>${body}</body></html>`,
      }),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      "Chapter 1",
      "Chapter 2",
      "Chapter 3",
    ]);
  });
});
