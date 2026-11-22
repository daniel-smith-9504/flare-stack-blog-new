import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import type { NovelSummary, NovelTag } from "@/features/novels/novels.schema";
import { NovelCover } from "@/features/novels/components/novel-cover";
import { EmptyState } from "@/components/ui/empty-state";
import { m } from "@/paraglide/messages";

export function NovelsPage({
  items,
  page,
  totalPages,
  tags,
  activeTag,
}: {
  items: Array<NovelSummary>;
  page: number;
  totalPages: number;
  tags: Array<NovelTag>;
  activeTag?: string;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">
          {m.novels_title()}
        </h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">
          {m.novels_description()}
        </p>
      </header>

      {tags.length > 0 ? (
        <div className="mb-5 flex flex-wrap gap-2">
          <Link
            to="/novels"
            search={{ page: undefined, tag: undefined }}
            className={`rounded-full px-3 py-1 text-xs ${
              activeTag
                ? "bg-black/5 dark:bg-white/10"
                : "bg-(--primary) text-white"
            }`}
          >
            {m.novels_all_tags()}
          </Link>
          {tags.map((tag) => (
            <Link
              key={tag.id}
              to="/novels"
              search={{ page: undefined, tag: tag.slug }}
              className={`rounded-full px-3 py-1 text-xs ${
                activeTag === tag.slug
                  ? "bg-(--primary) text-white"
                  : "bg-black/5 dark:bg-white/10"
              }`}
            >
              {tag.name}
              <span className="ml-1 opacity-60">{tag.novelCount}</span>
            </Link>
          ))}
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={m.novels_empty()}
          description={m.novels_empty_hint()}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((novel) => (
            <Link
              key={novel.id}
              to="/novels/$id"
              params={{ id: String(novel.id) }}
              className="fuwari-card-base group flex gap-3 p-3 transition-transform hover:-translate-y-0.5"
            >
              <div className="h-36 w-24 shrink-0 overflow-hidden rounded-lg">
                <NovelCover title={novel.title} coverUrl={novel.coverUrl} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <h2 className="line-clamp-2 font-semibold leading-snug group-hover:text-(--primary)">
                  {novel.title}
                </h2>
                {novel.author ? (
                  <p className="mt-1 truncate text-xs text-black/50 dark:text-white/50">
                    {novel.author}
                  </p>
                ) : null}
                <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-black/60 dark:text-white/60">
                  {novel.description || m.novels_no_description()}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-black/45 dark:text-white/45">
                  <span>
                    {m.novels_chapters_count({ count: novel.chapterCount })}
                  </span>
                  <span>
                    {m.novels_words_count({ count: novel.wordCount })}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
          {page > 1 ? (
            <Link
              to="/novels"
              search={{ page: page - 1, tag: activeTag }}
              className="fuwari-card-base px-3 py-1.5 hover:text-(--primary)"
            >
              {m.novels_page_prev()}
            </Link>
          ) : null}
          <span className="text-black/50 dark:text-white/50">
            {m.novels_page_of({ page, totalPages })}
          </span>
          {page < totalPages ? (
            <Link
              to="/novels"
              search={{ page: page + 1, tag: activeTag }}
              className="fuwari-card-base px-3 py-1.5 hover:text-(--primary)"
            >
              {m.novels_page_next()}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
