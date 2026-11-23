import { env } from "cloudflare:workers";
import {
  createAuthTestContext,
  createMockSession,
  seedUser,
} from "tests/test-utils";
import { describe, expect, it } from "vitest";
import * as NovelRepo from "@/features/novels/data/novels.data";
import { putImportFile } from "@/features/novels/data/novels.storage";
import { handleNovelImportMessage } from "@/features/novels/services/novel-import.consumer";
import * as NovelService from "@/features/novels/services/novels.service";
import { getDb } from "@/lib/db";
import { unwrap } from "@/lib/errors";

/** The book: two chapters, so the reader has neighbours to move between. */
const BOOK = [
  "第一章 开始",
  "这是第一章的正文，足够长以便选择其中的一段文字。",
  "",
  "第二章 继续",
  "这是第二章的正文。",
].join("\n");

async function importBook(title: string) {
  const db = getDb(env);
  const fileKey = `novels/imports/${crypto.randomUUID()}.txt`;
  await putImportFile(
    env,
    fileKey,
    new TextEncoder().encode(BOOK).buffer as ArrayBuffer,
    "text/plain",
  );
  const id = await NovelRepo.insertNovel(db, {
    title,
    fileKey,
    fileFormat: "txt",
  });
  await handleNovelImportMessage(
    { env },
    { novelId: id, fileKey, format: "txt" },
  );
  return { id, fileKey, db };
}

function reader(id: string) {
  return createAuthTestContext({
    session: createMockSession({
      user: { id, name: `Reader ${id}`, email: `${id}@example.com` },
    }),
  });
}

describe("Novels", () => {
  it("turns an uploaded TXT into readable chapters and drops the upload", async () => {
    const { id, fileKey, db } = await importBook("A Book");

    const stored = await NovelRepo.findNovelById(db, id);
    expect(stored?.status).toBe("ready");
    expect(stored?.chapterCount).toBe(2);
    expect(stored?.fileKey).toBeNull();
    expect(await env.R2.get(fileKey)).toBeNull();

    const detail = await NovelService.getNovelDetail({ db, env }, id);
    expect(detail?.chapters.map((chapter) => chapter.title)).toEqual([
      "第一章 开始",
      "第二章 继续",
    ]);

    const chapter = await NovelService.getChapter({ db, env }, id, 1);
    expect(chapter?.content).toContain("这是第一章的正文");
    expect(chapter).toMatchObject({
      chapterCount: 2,
      prevOrder: null,
      nextOrder: 2,
    });
  });

  it("reads a book by its title's URL and follows a renamed title", async () => {
    const { id, db } = await importBook("斗破 苍穹");
    const stored = await NovelRepo.findNovelById(db, id);
    expect(stored?.slug).toBe("斗破-苍穹");
    expect(
      (await NovelService.getNovelDetailBySlug({ db, env }, "斗破-苍穹"))?.id,
    ).toBe(id);

    expect(await NovelRepo.updateNovel(db, id, { title: "新的书名" })).toBe(
      true,
    );
    expect((await NovelRepo.findNovelById(db, id))?.slug).toBe("新的书名");
    expect(
      await NovelService.getNovelDetailBySlug({ db, env }, "斗破-苍穹"),
    ).toBeNull();
    expect(
      (await NovelService.getNovelDetailBySlug({ db, env }, "新的书名"))?.id,
    ).toBe(id);
  });

  it("keeps a book that is still importing off the public shelf", async () => {
    const db = getDb(env);
    const id = await NovelRepo.insertNovel(db, { title: "Pending" });

    expect(await NovelService.getNovelDetail({ db, env }, id)).toBeNull();
    const page = await NovelService.getNovelsPage({ db, env }, 1);
    expect(page.items.map((novel) => novel.id)).not.toContain(id);
  });

  it("gives each reader their own progress", async () => {
    const { id, db } = await importBook("Progress");
    const one = reader("reader-one");
    const two = reader("reader-two");
    await seedUser(db, one.session.user);
    await seedUser(db, two.session.user);

    expect(
      await NovelService.saveProgress(
        { db, env, session: one.session },
        { novelId: id, chapterOrder: 2, progressRatio: 0.5 },
      ),
    ).toBe(true);

    const saved = await NovelService.getProgress(
      { db, env, session: one.session },
      id,
    );
    expect(saved).toMatchObject({ chapterOrder: 2, progressRatio: 0.5 });
    expect(
      await NovelService.getProgress({ db, env, session: two.session }, id),
    ).toBeNull();

    expect(
      await NovelService.saveProgress(
        { db, env, session: one.session },
        { novelId: id, chapterOrder: 1, progressRatio: 0.25 },
      ),
    ).toBe(true);
    expect(
      await NovelService.getProgress({ db, env, session: one.session }, id),
    ).toMatchObject({ chapterOrder: 1, progressRatio: 0.25 });
  });

  it("shows only the notes a reader chose to share", async () => {
    const { id, db } = await importBook("Notes");
    const one = reader("notes-one");
    await seedUser(db, one.session.user);
    const chapter = await NovelService.getChapter({ db, env }, id, 1);
    const quote = chapter?.content.slice(0, 6) ?? "";
    expect(quote.length).toBeGreaterThan(0);

    const shared = unwrap(
      await NovelService.createNote(
        { db, env, session: one.session },
        {
          novelId: id,
          chapterOrder: 1,
          startOffset: 0,
          endOffset: quote.length,
          quote,
          contextBefore: "",
          contextAfter: "",
          note: "A thought worth sharing.",
          isPublic: true,
        },
      ),
    );
    const privateNote = unwrap(
      await NovelService.createNote(
        { db, env, session: one.session },
        {
          novelId: id,
          chapterOrder: 1,
          startOffset: 0,
          endOffset: quote.length,
          quote,
          contextBefore: "",
          contextAfter: "",
          note: "Just for me.",
          isPublic: false,
        },
      ),
    );

    expect(
      (
        await NovelService.getPublicNotes(
          { db, env },
          { novelId: id, chapterOrder: 1, sort: "newest" },
        )
      ).map((note) => note.id),
    ).toEqual([shared.id]);
    expect(
      await NovelService.getOwnNotes({ db, env, session: one.session }, id, 1),
    ).toHaveLength(2);

    await NovelService.updateNote(
      { db, env, session: one.session },
      { id: shared.id, isPublic: false },
    );
    expect(
      await NovelService.getPublicNotes(
        { db, env },
        { novelId: id, chapterOrder: 1, sort: "newest" },
      ),
    ).toHaveLength(0);

    expect(
      await NovelService.deleteNote(
        { db, env, session: one.session },
        privateNote.id,
      ),
    ).toBe(true);
    expect(
      await NovelService.getOwnNotes({ db, env, session: one.session }, id, 1),
    ).toHaveLength(1);
  });

  it("refuses a highlight whose quote is not the chapter's text", async () => {
    const { id, db } = await importBook("Bad highlight");
    const one = reader("bad-note");
    await seedUser(db, one.session.user);

    const result = await NovelService.createNote(
      { db, env, session: one.session },
      {
        novelId: id,
        chapterOrder: 1,
        startOffset: 0,
        endOffset: 3,
        quote: "not the text",
        contextBefore: "",
        contextAfter: "",
        note: "",
        isPublic: false,
      },
    );
    expect(result.error?.reason).toBe("NOTE_OFFSET_INVALID");
  });

  it("remembers a reader's reading settings", async () => {
    const db = getDb(env);
    const one = reader("settings-one");
    await seedUser(db, one.session.user);

    expect(
      await NovelService.getSettings({ db, env, session: one.session }),
    ).toMatchObject({ theme: "light", fontSize: 18 });

    const saved = await NovelService.saveSettings(
      { db, env, session: one.session },
      { theme: "dark", fontSize: 24, lineHeight: 2.2, fontFamily: "sans" },
    );
    expect(saved).toMatchObject({
      theme: "dark",
      fontSize: 24,
      lineHeight: 2.2,
      fontFamily: "sans",
    });
  });

  it("deletes a book and the chapter text it owns", async () => {
    const { id, db } = await importBook("To remove");

    expect(await NovelService.deleteNovelAdmin({ db, env }, id)).toBe(true);
    expect(await NovelRepo.findNovelById(db, id)).toBeNull();
    expect(
      await env.R2.get(
        `novels/${id}/chapters/${String(1).padStart(5, "0")}.txt`,
      ),
    ).toBeNull();
  });
});
