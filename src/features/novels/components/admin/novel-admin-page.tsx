import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, Globe2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { NovelCover } from "@/features/novels/components/novel-cover";
import type { GutenbergBook } from "@/features/novels/novels.schema";
import { NOVELS_QUERY_KEY, adminNovelsQuery } from "@/features/novels/queries";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

const STATUS_LABELS = {
  pending: m.admin_novels_status_pending,
  parsing: m.admin_novels_status_parsing,
  ready: m.admin_novels_status_ready,
  failed: m.admin_novels_status_failed,
};

/**
 * 小说管理: uploads an EPUB or TXT file, or imports a free Gutenberg book.
 * The parse runs on the Queue, so the list refreshes while a book is pending.
 */
export function NovelAdminPage() {
  const queryClient = useQueryClient();
  const { data: novels = [], isPending } = useQuery(adminNovelsQuery);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Array<GutenbergBook> | null>(null);
  const [importingId, setImportingId] = useState<number | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "admin"],
    });
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      let body: Blob = file;
      if (/\.txt$/iu.test(file.name)) {
        const bytes = await file.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          // A Chinese TXT is often GBK; the browser converts it so the
          // server only ever stores UTF-8.
          text = new TextDecoder("gbk").decode(bytes);
        }
        body = new Blob([text], { type: "text/plain;charset=utf-8" });
      }
      const format = /\.epub$/iu.test(file.name) ? "epub" : "txt";
      const response = await fetch(
        `/novel-files?filename=${encodeURIComponent(file.name)}&format=${format}`,
        { method: "POST", body },
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? m.admin_novels_upload_failed());
      }
      toast.success(m.admin_novels_uploaded());
      refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : m.admin_novels_upload_failed(),
      );
    } finally {
      setUploading(false);
    }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length === 0) return;
    setSearching(true);
    try {
      setResults(
        await orpcClient.novels.admin.gutenbergSearch({
          query: query.trim(),
        }),
      );
    } catch {
      toast.error(m.admin_novels_search_failed());
    } finally {
      setSearching(false);
    }
  };

  const importBook = async (id: number) => {
    setImportingId(id);
    try {
      await orpcClient.novels.admin.gutenbergImport({ id });
      toast.success(m.admin_novels_imported());
      refresh();
    } catch {
      toast.error(m.admin_novels_import_failed());
    } finally {
      setImportingId(null);
    }
  };

  const retry = async (id: number) => {
    try {
      await orpcClient.novels.admin.retry({ id });
      toast.success(m.admin_novels_uploaded());
      refresh();
    } catch {
      toast.error(m.admin_novels_upload_failed());
    }
  };

  const remove = async (id: number) => {
    if (!window.confirm(m.admin_novels_delete_confirm())) return;
    try {
      await orpcClient.novels.admin.remove({ id });
      refresh();
    } catch {
      toast.error(m.admin_novels_upload_failed());
    }
  };

  return (
    <AdminPage
      title={m.admin_novels_title()}
      count={novels.length}
      description={m.admin_novels_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-6">
        <section className="fuwari-card-base p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Upload size={16} />
            {m.admin_novels_upload()}
          </h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            {m.admin_novels_upload_hint()}
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2">
            <span className={buttonClass({ variant: "primary" })}>
              {uploading ? m.admin_novels_uploading() : m.admin_novels_choose()}
            </span>
            <Input
              type="file"
              accept=".epub,.txt,application/epub+zip,text/plain"
              disabled={uploading}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </label>
        </section>

        <section className="fuwari-card-base p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Globe2 size={16} />
            {m.admin_novels_gutenberg()}
          </h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            {m.admin_novels_gutenberg_hint()}
          </p>
          <form className="mt-3 flex gap-2" onSubmit={search}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={m.admin_novels_search_placeholder()}
              aria-label={m.admin_novels_search()}
              className="max-w-xs"
            />
            <Button type="submit" variant="plain" loading={searching}>
              {m.admin_novels_search()}
            </Button>
          </form>
          {results === null ? null : results.length === 0 ? (
            <p className="mt-3 text-sm text-black/50 dark:text-white/50">
              {m.admin_novels_no_results()}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {results.map((book) => (
                <li
                  key={book.id}
                  className="flex items-center gap-3 rounded-lg border border-black/5 p-2 dark:border-white/10"
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded">
                    <NovelCover title={book.title} coverUrl={book.coverUrl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium">
                      {book.title}
                    </p>
                    <p className="truncate text-xs text-black/45 dark:text-white/45">
                      {book.author || m.novels_unknown_author()}
                    </p>
                  </div>
                  <Button
                    variant="plain"
                    size="sm"
                    loading={importingId === book.id}
                    onClick={() => void importBook(book.id)}
                  >
                    {m.admin_novels_import()}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          {isPending ? null : novels.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={m.admin_novels_empty()}
              description={m.admin_novels_upload_hint()}
            />
          ) : (
            <ul className="space-y-2">
              {novels.map((novel) => (
                <li
                  key={novel.id}
                  className="fuwari-card-base flex items-center gap-3 p-3"
                >
                  <div className="h-16 w-11 shrink-0 overflow-hidden rounded">
                    <NovelCover title={novel.title} coverUrl={novel.coverUrl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {novel.title}
                    </p>
                    <p className="truncate text-xs text-black/45 dark:text-white/45">
                      {novel.author || m.novels_unknown_author()}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-black/45 dark:text-white/45">
                      <span>{STATUS_LABELS[novel.status]()}</span>
                      <span>
                        {m.novels_chapters_count({
                          count: novel.chapterCount,
                        })}
                      </span>
                      <span className="uppercase">{novel.source}</span>
                    </p>
                    {novel.error ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-red-500">
                        {novel.error}
                      </p>
                    ) : null}
                  </div>
                  {novel.status === "ready" ? (
                    <Link
                      to="/novels/$id"
                      params={{ id: String(novel.id) }}
                      className="text-xs text-black/55 hover:text-(--primary) dark:text-white/55"
                    >
                      {m.admin_novels_view()}
                    </Link>
                  ) : null}
                  {novel.status === "failed" ? (
                    <Button
                      variant="plain"
                      size="sm"
                      icon={<RefreshCw size={14} />}
                      onClick={() => void retry(novel.id)}
                    >
                      {m.admin_novels_retry()}
                    </Button>
                  ) : null}
                  <Button
                    variant="text"
                    tone="danger"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    onClick={() => void remove(novel.id)}
                  >
                    {m.admin_novels_delete()}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminPage>
  );
}
