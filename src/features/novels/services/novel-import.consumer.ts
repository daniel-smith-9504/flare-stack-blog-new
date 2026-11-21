import {
  countWords,
  deleteChapters,
  findNovelById,
  insertChapters,
  setNovelStatus,
} from "@/features/novels/data/novels.data";
import {
  deleteImportFile,
  deleteNovelChapters,
  getImportFile,
  putChapterText,
} from "@/features/novels/data/novels.storage";
import { NOVEL_MAX_CHAPTERS } from "@/features/novels/novels.constants";
import { parseEpub } from "@/features/novels/parse/epub.parser";
import { parseTxt } from "@/features/novels/parse/txt.parser";
import { getDb } from "@/lib/db";
import type { NovelImportMessage } from "@/lib/queue/queue.schema";

/**
 * Turns an uploaded file into a book: writes each chapter's text to R2,
 * records the chapter rows in D1, then marks the book ready. A failed parse
 * leaves the book on the Admin's list with the reason.
 */
export async function handleNovelImportMessage(
  context: { env: Env },
  data: NovelImportMessage["data"],
) {
  const { env } = context;
  const db = getDb(env);
  const novel = await findNovelById(db, data.novelId);
  if (!novel) return;

  await setNovelStatus(db, data.novelId, "parsing", { error: null });

  try {
    const file = await getImportFile(env, data.fileKey);
    if (!file) throw new Error("The uploaded file is no longer in storage.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const parsed =
      data.format === "epub"
        ? parseEpub(bytes)
        : parseTxt(new TextDecoder("utf-8").decode(bytes));

    const chapters = parsed.chapters
      .map((chapter) => ({
        title: chapter.title.slice(0, 300),
        content: chapter.content,
        wordCount: countWords(chapter.content),
      }))
      .filter((chapter) => chapter.content.length > 0);

    if (chapters.length === 0)
      throw new Error("The file holds no readable chapter.");
    if (chapters.length > NOVEL_MAX_CHAPTERS)
      throw new Error(`The book has more than ${NOVEL_MAX_CHAPTERS} chapters.`);

    // A retried import starts from a clean shelf: no chapter rows, no text.
    await deleteChapters(db, data.novelId);
    await deleteNovelChapters(env, data.novelId);

    for (let i = 0; i < chapters.length; i += 20) {
      await Promise.all(
        chapters
          .slice(i, i + 20)
          .map((chapter, offset) =>
            putChapterText(env, data.novelId, i + offset + 1, chapter.content),
          ),
      );
    }

    await insertChapters(db, data.novelId, chapters);
    await setNovelStatus(db, data.novelId, "ready", {
      chapterCount: chapters.length,
      wordCount: chapters.reduce(
        (total, chapter) => total + chapter.wordCount,
        0,
      ),
      title: parsed.title ?? novel.title,
      ...(parsed.author ? { author: parsed.author } : {}),
    });

    await deleteImportFile(env, data.fileKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        message: "novel import failed",
        novelId: data.novelId,
        error: message,
      }),
    );
    await setNovelStatus(db, data.novelId, "failed", {
      error: message.slice(0, 500),
    });
  }
}
