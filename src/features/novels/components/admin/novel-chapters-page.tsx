import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  FilePlus2,
  Pencil,
  Save,
  Square,
  SquareCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Textarea } from "@/components/ui/input";
import {
  NOVELS_QUERY_KEY,
  adminChapterQuery,
  adminChaptersQuery,
} from "@/features/novels/queries";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

type Editing = {
  order: number | null;
  title: string;
  content: string;
  version: number;
};

const EMPTY: Editing = { order: null, title: "", content: "", version: 0 };

/** 章节管理: edits a book's chapters, their order, and their TXT exports. */
export function NovelChaptersPage({ novelId }: { novelId: number }) {
  const queryClient = useQueryClient();
  const { data: chapters = [], isPending } = useQuery(
    adminChaptersQuery(novelId),
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "admin"],
    });
  };

  const { data: loaded, isPending: loadingChapter } = useQuery({
    ...adminChapterQuery(novelId, editing?.order ?? 0),
    enabled: editing !== null && editing.order !== null,
  });
  useEffect(() => {
    if (!loaded) return;
    setEditing({
      order: loaded.order,
      title: loaded.title,
      content: loaded.content,
      version: loaded.version,
    });
  }, [loaded]);

  const save = useMutation({
    mutationFn: (draft: Editing) =>
      draft.order === null
        ? orpcClient.novels.admin.createChapter({
            novelId,
            title: draft.title,
            content: draft.content,
          })
        : orpcClient.novels.admin.updateChapter({
            novelId,
            order: draft.order,
            title: draft.title,
            content: draft.content,
            version: draft.version,
          }),
    onSuccess: () => {
      toast.success(m.admin_novel_chapters_saved());
      setEditing(null);
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "chapters", novelId],
      });
      refresh();
    },
    onError: () => toast.error(m.admin_novel_chapters_save_failed()),
  });

  const remove = useMutation({
    mutationFn: (order: number) =>
      orpcClient.novels.admin.deleteChapter({ novelId, order }),
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "chapters", novelId],
      });
      refresh();
    },
    onError: () => toast.error(m.admin_novel_chapters_save_failed()),
  });

  const removeMany = useMutation({
    mutationFn: (orders: Array<number>) =>
      orpcClient.novels.admin.batchDeleteChapters({ novelId, orders }),
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "chapters", novelId],
      });
      refresh();
    },
    onError: () => toast.error(m.admin_novel_chapters_save_failed()),
  });

  const move = useMutation({
    mutationFn: (input: { from: number; to: number }) =>
      orpcClient.novels.admin.moveChapter({ novelId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "chapters", novelId],
      });
      refresh();
    },
    onError: () => toast.error(m.admin_novel_chapters_save_failed()),
  });

  const toggle = (order: number) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });

  return (
    <AdminPage
      title={m.admin_novel_chapters_title()}
      count={chapters.length}
      description={m.admin_novel_chapters_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/admin/novels"
            className="inline-flex items-center gap-1.5 text-sm text-black/60 hover:text-(--primary) dark:text-white/60"
          >
            <ArrowLeft size={15} />
            {m.admin_novels_title()}
          </Link>
          <span className="flex-1" />
          <a
            href={`/novel-export?novelId=${novelId}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-black/5 px-3 py-1.5 text-sm dark:bg-white/10"
          >
            <Download size={15} />
            {m.admin_novel_chapters_export_book()}
          </a>
          <Button
            variant="primary"
            size="sm"
            icon={<FilePlus2 size={15} />}
            onClick={() => setEditing({ ...EMPTY })}
          >
            {m.admin_novel_chapters_add()}
          </Button>
          {selected.size > 0 ? (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={15} />}
              loading={removeMany.isPending}
              onClick={() => {
                if (
                  !window.confirm(
                    m.admin_novel_chapters_delete_many_confirm({
                      count: selected.size,
                    }),
                  )
                )
                  return;
                removeMany.mutate([...selected]);
              }}
            >
              {m.admin_novel_chapters_delete_selected({ count: selected.size })}
            </Button>
          ) : null}
        </div>

        {editing ? (
          <section className="fuwari-card-base space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {editing.order === null
                  ? m.admin_novel_chapters_add()
                  : m.admin_novel_chapters_edit({ order: editing.order })}
              </h2>
              <IconButton
                size="sm"
                label={m.admin_novel_chapters_cancel()}
                onClick={() => setEditing(null)}
              >
                <X size={16} />
              </IconButton>
            </div>
            {loadingChapter ? (
              <p className="text-sm text-black/50 dark:text-white/50">
                {m.admin_novel_chapters_loading()}
              </p>
            ) : (
              <>
                <Input
                  value={editing.title}
                  onChange={(event) =>
                    setEditing({ ...editing, title: event.target.value })
                  }
                  placeholder={m.admin_novel_chapters_title_placeholder()}
                  aria-label={m.admin_novel_chapters_title_label()}
                />
                <Textarea
                  value={editing.content}
                  onChange={(event) =>
                    setEditing({ ...editing, content: event.target.value })
                  }
                  rows={16}
                  className="font-mono text-xs"
                  placeholder={m.admin_novel_chapters_content_placeholder()}
                  aria-label={m.admin_novel_chapters_content_label()}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="plain"
                    size="sm"
                    onClick={() => setEditing(null)}
                  >
                    {m.admin_novel_chapters_cancel()}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Save size={15} />}
                    loading={save.isPending}
                    disabled={editing.content.trim().length === 0}
                    onClick={() => save.mutate(editing)}
                  >
                    {m.admin_novel_chapters_save()}
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {isPending ? null : chapters.length === 0 ? (
          <p className="fuwari-card-base p-4 text-sm text-black/50 dark:text-white/50">
            {m.admin_novel_chapters_empty()}
          </p>
        ) : (
          <ul className="space-y-2">
            {chapters.map((chapter, index) => (
              <li
                key={chapter.order}
                className="fuwari-card-base flex flex-wrap items-center gap-2 p-3"
              >
                <IconButton
                  size="sm"
                  variant="quiet"
                  label={m.admin_novel_chapters_select({
                    order: chapter.order,
                  })}
                  active={selected.has(chapter.order)}
                  onClick={() => toggle(chapter.order)}
                >
                  {selected.has(chapter.order) ? (
                    <SquareCheck size={16} />
                  ) : (
                    <Square size={16} />
                  )}
                </IconButton>
                <span className="w-8 shrink-0 text-xs tabular-nums text-black/40 dark:text-white/40">
                  {chapter.order}
                </span>
                <span className="line-clamp-1 min-w-0 flex-1 text-sm">
                  {chapter.title ||
                    m.novels_chapter_number({ order: chapter.order })}
                </span>
                <span className="text-xs text-black/40 dark:text-white/40">
                  {m.novels_chapter_words({ count: chapter.wordCount })}
                </span>
                <Button
                  variant="text"
                  size="sm"
                  icon={<ArrowUp size={14} />}
                  disabled={index === 0}
                  aria-label={m.admin_novel_chapters_move_up()}
                  onClick={() =>
                    move.mutate({
                      from: chapter.order,
                      to: chapters[index - 1]?.order ?? chapter.order,
                    })
                  }
                />
                <Button
                  variant="text"
                  size="sm"
                  icon={<ArrowDown size={14} />}
                  disabled={index === chapters.length - 1}
                  aria-label={m.admin_novel_chapters_move_down()}
                  onClick={() =>
                    move.mutate({
                      from: chapter.order,
                      to: chapters[index + 1]?.order ?? chapter.order,
                    })
                  }
                />
                <a
                  href={`/novel-export?novelId=${novelId}&chapter=${chapter.order}`}
                  className="rounded p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
                  aria-label={m.admin_novel_chapters_export()}
                >
                  <Download size={14} />
                </a>
                <Button
                  variant="text"
                  size="sm"
                  icon={<Pencil size={14} />}
                  aria-label={m.admin_novel_chapters_edit({
                    order: chapter.order,
                  })}
                  onClick={() =>
                    setEditing({
                      order: chapter.order,
                      title: chapter.title,
                      content: "",
                      version: chapter.version,
                    })
                  }
                />
                <Button
                  variant="text"
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  aria-label={m.admin_novel_chapters_delete()}
                  onClick={() => {
                    if (
                      !window.confirm(m.admin_novel_chapters_delete_confirm())
                    )
                      return;
                    remove.mutate(chapter.order);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
