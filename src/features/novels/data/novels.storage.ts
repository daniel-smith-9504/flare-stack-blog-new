import {
  novelChapterKey,
  novelChapterPrefix,
} from "@/features/novels/novels.constants";

export async function putImportFile(
  env: Env,
  key: string,
  body: ReadableStream | ArrayBuffer,
  contentType: string,
) {
  await env.R2.put(key, body, { httpMetadata: { contentType } });
}

export function getImportFile(env: Env, key: string) {
  return env.R2.get(key);
}

export async function deleteImportFile(env: Env, key: string) {
  await env.R2.delete(key);
}

export async function putChapterText(
  env: Env,
  novelId: number,
  order: number,
  text: string,
) {
  await env.R2.put(novelChapterKey(novelId, order), text, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { novelId: String(novelId), order: String(order) },
  });
}

export async function getChapterText(env: Env, novelId: number, order: number) {
  const object = await env.R2.get(novelChapterKey(novelId, order));
  return object ? object.text() : null;
}

/** Deletes every chapter object of a book, page by page. */
export async function deleteNovelChapters(env: Env, novelId: number) {
  const prefix = novelChapterPrefix(novelId);
  let cursor: string | undefined;
  do {
    const page = await env.R2.list({ prefix, cursor });
    const keys = page.objects.map((object) => object.key);
    if (keys.length > 0) await env.R2.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
