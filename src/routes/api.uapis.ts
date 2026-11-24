import { createFileRoute } from "@tanstack/react-router";

const BASE = "https://uapis.cn/api/v1";

/**
 * The paths the toolbox calls. Keeping the list closed stops this route from
 * acting as a general-purpose proxy for any address on the internet.
 */
const ALLOWED_PATHS = [
  "github/repo",
  "github/user",
  "history/programmer/today",
  "misc/hotboard",
  "misc/movie-box-office",
  "misc/phoneinfo",
  "misc/tracking/query",
  "misc/worldtime",
  "search/aggregate",
];

function targetOf(request: Request): URL | null {
  const source = new URL(request.url);
  const path = source.searchParams.get("path");
  if (!path || !ALLOWED_PATHS.includes(path)) return null;
  const params = new URLSearchParams(source.searchParams);
  params.delete("path");
  const query = params.toString();
  return new URL(`${BASE}/${path}${query ? `?${query}` : ""}`);
}

async function proxy(request: Request) {
  const target = targetOf(request);
  if (!target) {
    return Response.json(
      { message: "Missing or unsupported 'path' parameter." },
      { status: 400 },
    );
  }
  try {
    const body = request.method === "POST" ? await request.text() : undefined;
    const upstream = await fetch(target, {
      method: request.method,
      headers:
        request.method === "POST"
          ? { "Content-Type": "application/json" }
          : undefined,
      body,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json({ message: "请求外部 API 失败" }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/uapis")({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
    },
  },
});
