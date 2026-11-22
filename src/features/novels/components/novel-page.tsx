import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, Play } from "lucide-react";
import { NovelCover } from "@/features/novels/components/novel-cover";
import type { NovelDetail } from "@/features/novels/novels.schema";
import { novelProgressQuery, bookmarksQuery } from "@/features/novels/queries";
import { useSession } from "@/features/auth/hooks/use-session";
import { buttonClass } from "@/components/ui/button";
import { m } from "@/paraglide/messages";

export function NovelPage({ novel }: { novel: NovelDetail }) {
  const { data: session } = useSession();
  const { data: progress } = useQuery(
    novelProgressQuery(novel.id, Boolean(session)),
  );
  const { data: bookmarks = [] } = useQuery(
    bookmarksQuery(novel.id, Boolean(session)),
  );

  const firstOrder = novel.chapters[0]?.order ?? 1;
  const inRange =
    progress !== null &&
    progress !== undefined &&
    progress.chapterOrder >= firstOrder &&
    progress.chapterOrder <= novel.chapterCount;
  const startOrder = inRange ? progress.chapterOrder : firstOrder;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        to="/novels"
        className="inline-flex items-center gap-1.5 text-sm text-black/60 hover:text-(--primary) dark:text-white/60"
      >
        <ArrowLeft size={15} />
        {m.novels_back_to_shelf()}
      </Link>

      <section className="fuwari-card-base mt-4 flex flex-col gap-6 p-5 sm:flex-row">
        <div className="mx-auto h-60 w-40 shrink-0 overflow-hidden rounded-xl sm:mx-0">
          <NovelCover title={novel.title} coverUrl={novel.coverUrl} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-snug sm:text-3xl">
            {novel.title}
          </h1>
          {novel.author ? (
            <p className="mt-2 text-sm text-black/55 dark:text-white/55">
              {m.novels_by_author({ author: novel.author })}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/50 dark:text-white/50">
            {novel.category ? (
              <span className="rounded-full bg-black/5 px-2.5 py-0.5 dark:bg-white/10">
                {novel.category}
              </span>
            ) : null}
            {novel.tags.map((tag) => (
              <Link
                key={tag.id}
                to="/novels"
                search={{ tag: tag.slug }}
                className="rounded-full bg-(--primary)/10 px-2.5 py-0.5 text-(--primary)"
              >
                {tag.name}
              </Link>
            ))}
            <span>
              {m.novels_chapters_count({ count: novel.chapterCount })}
            </span>
            <span>{m.novels_words_count({ count: novel.wordCount })}</span>
          </div>

          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-black/70 dark:text-white/70">
            {novel.description || m.novels_no_description()}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              to="/novels/$id/read"
              params={{ id: String(novel.id) }}
              search={{ chapter: startOrder }}
              className={buttonClass({ variant: "primary" })}
            >
              <Play size={15} />
              {inRange ? m.novels_continue_reading() : m.novels_start_reading()}
            </Link>
            {inRange ? (
              <span className="text-xs text-black/50 dark:text-white/50">
                {m.novels_resume_at({ chapter: progress.chapterOrder })}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <BookOpen size={17} />
          {m.novels_chapter_list()}
        </h2>
        {bookmarks.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs font-medium text-black/50 dark:text-white/50">
              {m.novels_bookmarks()}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {bookmarks.map((bookmark) => (
                <Link
                  key={bookmark.id}
                  to="/novels/$id/read"
                  params={{ id: String(novel.id) }}
                  search={{ chapter: bookmark.chapterOrder }}
                  className="rounded-full bg-black/5 px-3 py-1 text-xs hover:text-(--primary) dark:bg-white/10"
                >
                  {bookmark.chapterOrder}.{" "}
                  {bookmark.chapterTitle ||
                    m.novels_chapter_number({ order: bookmark.chapterOrder })}
                </Link>
              ))}
            </div>
          </div>
        ) : null}
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {novel.chapters.map((chapter) => (
            <li key={chapter.order}>
              <Link
                to="/novels/$id/read"
                params={{ id: String(novel.id) }}
                search={{ chapter: chapter.order }}
                className="fuwari-card-base flex items-baseline gap-2 px-3 py-2 text-sm transition-colors hover:text-(--primary)"
              >
                <span className="w-8 shrink-0 text-xs tabular-nums text-black/40 dark:text-white/40">
                  {chapter.order}
                </span>
                <span className="line-clamp-1 flex-1">
                  {chapter.title ||
                    m.novels_chapter_number({ order: chapter.order })}
                </span>
                <span className="shrink-0 text-[11px] text-black/35 dark:text-white/35">
                  {m.novels_chapter_words({ count: chapter.wordCount })}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
