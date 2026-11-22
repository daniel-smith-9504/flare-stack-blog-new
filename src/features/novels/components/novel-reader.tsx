import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Highlighter,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NovelCover } from "@/features/novels/components/novel-cover";
import type {
  NovelChapterContent,
  NovelDetail,
  NovelSettings,
  OwnNote,
} from "@/features/novels/novels.schema";
import {
  DEFAULT_NOVEL_SETTINGS,
  NOVEL_NOTE_CONTEXT_LENGTH,
} from "@/features/novels/novels.constants";
import {
  NOVELS_QUERY_KEY,
  novelProgressQuery,
  novelSettingsQuery,
  ownNotesQuery,
  publicNotesQuery,
} from "@/features/novels/queries";
import { useSession } from "@/features/auth/hooks/use-session";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/toast";
import { orpcClient } from "@/lib/orpc";
import { m } from "@/paraglide/messages";

const THEMES = {
  light: { background: "#ffffff", color: "#1f2937" },
  sepia: { background: "#f5ecd9", color: "#5b4636" },
  dark: { background: "#1f2937", color: "#e5e7eb" },
} as const;

const FONT_FAMILIES = {
  serif: "Georgia, 'Songti SC', 'Noto Serif SC', serif",
  sans: "system-ui, -apple-system, 'PingFang SC', sans-serif",
} as const;

type Draft = { start: number; end: number; quote: string };

/** The character offsets of a selection inside the chapter's text. */
function selectionOffsets(container: HTMLElement | null): Draft | null {
  if (!container) return null;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const quote = range.toString();
  if (quote.trim().length === 0) return null;
  return { start, end: start + quote.length, quote };
}

/** Splits the text into runs, wrapping the reader's own highlights. */
function highlightedText(
  text: string,
  notes: Array<OwnNote>,
): Array<ReactNode> {
  const sorted = notes
    .filter(
      (note) =>
        note.startOffset >= 0 &&
        note.endOffset <= text.length &&
        note.startOffset < note.endOffset,
    )
    .sort((left, right) => left.startOffset - right.startOffset);
  const parts: Array<ReactNode> = [];
  let cursor = 0;
  for (const note of sorted) {
    if (note.startOffset < cursor) continue;
    if (note.startOffset > cursor)
      parts.push(text.slice(cursor, note.startOffset));
    parts.push(
      <mark
        key={note.id}
        title={note.note || note.quote}
        className={
          note.isPublic
            ? "rounded-sm bg-amber-300/70 text-inherit dark:bg-amber-400/40"
            : "rounded-sm bg-sky-300/60 text-inherit dark:bg-sky-400/40"
        }
      >
        {text.slice(note.startOffset, note.endOffset)}
      </mark>,
    );
    cursor = note.endOffset;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function NovelReader({
  novel,
  chapter,
}: {
  novel: NovelDetail;
  chapter: NovelChapterContent;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const signedIn = Boolean(session);

  const { data: progress } = useQuery(novelProgressQuery(novel.id, signedIn));
  const { data: savedSettings } = useQuery(novelSettingsQuery(signedIn));
  const { data: ownNotes = [] } = useQuery(
    ownNotesQuery(novel.id, chapter.order, signedIn),
  );
  const { data: publicNotes = [] } = useQuery(
    publicNotesQuery(novel.id, chapter.order),
  );

  const [settings, setSettings] = useState<NovelSettings>(
    DEFAULT_NOVEL_SETTINGS,
  );
  useEffect(() => {
    if (savedSettings) setSettings(savedSettings);
  }, [savedSettings]);

  const [showSettings, setShowSettings] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [draftPublic, setDraftPublic] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Where the reader stopped, once the chapter has been laid out.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (!progress || progress.chapterOrder !== chapter.order) return;
    const key = `${chapter.order}:${progress.updatedAt.getTime()}`;
    if (restored.current === key) return;
    restored.current = key;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0) window.scrollTo({ top: max * progress.progressRatio });
      });
    });
  }, [progress, chapter.order]);

  // Keep the place while reading and when the page is left.
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio =
        max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      void orpcClient.novels
        .saveProgress({
          novelId: novel.id,
          chapterOrder: chapter.order,
          progressRatio: ratio,
        })
        .catch(() => undefined);
    };
    const onScroll = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(save, 1200);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", save);
    };
  }, [signedIn, novel.id, chapter.order]);

  // A touch selection updates the Selection without a mouseup, so follow
  // selectionchange too; the timer lets the reader settle the handles first.
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const offsets = selectionOffsets(contentRef.current);
        if (offsets) setDraft(offsets);
      }, 300);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [signedIn]);

  const invalidateNotes = () => {
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "my-notes", novel.id, chapter.order],
    });
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "public-notes", novel.id, chapter.order],
    });
  };

  const createNote = useMutation({
    mutationFn: (note: { note: string; isPublic: boolean }) => {
      if (!draft) throw new Error("No selection");
      const start = Math.max(0, draft.start - NOVEL_NOTE_CONTEXT_LENGTH);
      const end = Math.min(
        chapter.content.length,
        draft.end + NOVEL_NOTE_CONTEXT_LENGTH,
      );
      return orpcClient.novels.createNote({
        novelId: novel.id,
        chapterOrder: chapter.order,
        startOffset: draft.start,
        endOffset: draft.end,
        quote: draft.quote,
        contextBefore: chapter.content.slice(start, draft.start),
        contextAfter: chapter.content.slice(draft.end, end),
        note: note.note,
        isPublic: note.isPublic,
      });
    },
    onSuccess: () => {
      invalidateNotes();
      setDraft(null);
      setDraftNote("");
      setDraftPublic(false);
      window.getSelection()?.removeAllRanges();
      toast.success(m.novels_note_saved());
    },
    onError: () => toast.error(m.novels_note_failed()),
  });

  const updateNote = useMutation({
    mutationFn: (input: { id: number; isPublic: boolean }) =>
      orpcClient.novels.updateNote(input),
    onSuccess: invalidateNotes,
    onError: () => toast.error(m.novels_note_failed()),
  });

  const deleteNote = useMutation({
    mutationFn: (id: number) => orpcClient.novels.deleteNote({ id }),
    onSuccess: invalidateNotes,
    onError: () => toast.error(m.novels_note_failed()),
  });

  const updateSettings = (patch: Partial<NovelSettings>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
    if (signedIn)
      void orpcClient.novels.saveSettings(patch).catch(() => undefined);
  };

  const theme = THEMES[settings.theme];
  const themeLabels = {
    light: m.novels_reader_theme_light,
    sepia: m.novels_reader_theme_sepia,
    dark: m.novels_reader_theme_dark,
  };
  const content = useMemo(
    () => highlightedText(chapter.content, ownNotes),
    [chapter.content, ownNotes],
  );

  const goToChapter = (order: number) =>
    void navigate({
      to: "/novels/$id/read",
      params: { id: String(novel.id) },
      search: { chapter: order },
    });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to="/novels/$id"
          params={{ id: String(novel.id) }}
          className="inline-flex items-center gap-1.5 text-sm text-black/60 hover:text-(--primary) dark:text-white/60"
        >
          <ArrowLeft size={15} />
          {m.novels_reader_back()}
        </Link>
        <span className="text-black/25 dark:text-white/25">/</span>
        <span className="line-clamp-1 min-w-0 flex-1 text-sm font-medium">
          {novel.title}
        </span>
        <Link
          to="/novels/$id"
          params={{ id: String(novel.id) }}
          className="hidden h-12 w-8 shrink-0 overflow-hidden rounded sm:block"
        >
          <NovelCover title={novel.title} coverUrl={novel.coverUrl} />
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select
          value={String(chapter.order)}
          options={novel.chapters.map((item) => ({
            value: String(item.order),
            label: `${item.order}. ${
              item.title || m.novels_chapter_number({ order: item.order })
            }`,
          }))}
          onChange={(value) => goToChapter(Number(value))}
          aria-label={m.novels_reader_toc()}
          className="min-w-0 flex-1"
        />
        <span className="text-xs text-black/50 dark:text-white/50">
          {m.novels_reader_chapter_of({
            order: chapter.order,
            count: chapter.chapterCount,
          })}
        </span>
        {signedIn ? (
          <Button
            variant="plain"
            size="sm"
            icon={<Settings2 size={15} />}
            onClick={() => setShowSettings((open) => !open)}
            aria-expanded={showSettings}
          >
            {m.novels_reader_settings()}
          </Button>
        ) : null}
      </div>

      {signedIn && showSettings ? (
        <div className="fuwari-card-base mt-3 space-y-4 p-4 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_theme()}
            </p>
            <div className="flex flex-wrap gap-2">
              {(["light", "sepia", "dark"] as const).map((value) => (
                <Button
                  key={value}
                  variant={settings.theme === value ? "primary" : "plain"}
                  size="sm"
                  onClick={() => updateSettings({ theme: value })}
                >
                  {themeLabels[value]()}
                </Button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_font_size()}
            </span>
            <Slider
              min={14}
              max={32}
              value={settings.fontSize}
              onChange={(event) =>
                updateSettings({ fontSize: Number(event.target.value) })
              }
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_line_height()}
            </span>
            <Slider
              min={1.4}
              max={2.4}
              step={0.1}
              value={settings.lineHeight}
              onChange={(event) =>
                updateSettings({ lineHeight: Number(event.target.value) })
              }
            />
          </label>
          <div>
            <p className="mb-1.5 text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_font()}
            </p>
            <div className="flex gap-2">
              <Button
                variant={settings.fontFamily === "serif" ? "primary" : "plain"}
                size="sm"
                onClick={() => updateSettings({ fontFamily: "serif" })}
              >
                {m.novels_reader_font_serif()}
              </Button>
              <Button
                variant={settings.fontFamily === "sans" ? "primary" : "plain"}
                size="sm"
                onClick={() => updateSettings({ fontFamily: "sans" })}
              >
                {m.novels_reader_font_sans()}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <article
        className="mt-4 rounded-2xl border border-black/5 shadow-sm"
        style={{
          background: theme.background,
          color: theme.color,
          borderColor: theme.background,
        }}
      >
        <header className="border-b border-black/10 px-5 py-4">
          <h1 className="text-lg font-semibold">
            {chapter.title || m.novels_chapter_number({ order: chapter.order })}
          </h1>
        </header>
        <div className="p-5 sm:p-7">
          {signedIn && !draft ? (
            <p className="mb-4 select-none text-xs text-black/40 dark:text-white/40">
              {m.novels_reader_select_hint()}
            </p>
          ) : null}
          <div
            ref={contentRef}
            onMouseUp={() => {
              if (!signedIn) return;
              const offsets = selectionOffsets(contentRef.current);
              if (offsets) setDraft(offsets);
            }}
            className="whitespace-pre-wrap break-words"
            style={{
              fontSize: `${settings.fontSize}px`,
              lineHeight: settings.lineHeight,
              fontFamily: FONT_FAMILIES[settings.fontFamily],
            }}
          >
            {content}
          </div>
        </div>
      </article>

      <nav className="mt-4 flex items-center justify-between gap-3">
        {chapter.prevOrder !== null ? (
          <Link
            to="/novels/$id/read"
            params={{ id: String(novel.id) }}
            search={{ chapter: chapter.prevOrder }}
            className="fuwari-card-base inline-flex items-center gap-1.5 px-3 py-2 text-sm hover:text-(--primary)"
          >
            <ChevronLeft size={16} />
            {m.novels_reader_prev()}
          </Link>
        ) : (
          <span />
        )}
        {chapter.nextOrder !== null ? (
          <Link
            to="/novels/$id/read"
            params={{ id: String(novel.id) }}
            search={{ chapter: chapter.nextOrder }}
            className="fuwari-card-base inline-flex items-center gap-1.5 px-3 py-2 text-sm hover:text-(--primary)"
          >
            {m.novels_reader_next()}
            <ChevronRight size={16} />
          </Link>
        ) : (
          <span />
        )}
      </nav>

      {signedIn ? (
        <section className="mt-8">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Highlighter size={16} />
            {m.novels_reader_my_notes()}
          </h2>
          {ownNotes.length === 0 ? (
            <p className="mt-2 text-sm text-black/45 dark:text-white/45">
              {m.novels_reader_no_notes()}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {ownNotes.map((note) => (
                <li
                  key={note.id}
                  className="fuwari-card-base flex flex-col gap-2 p-3 text-sm"
                >
                  <p className="border-l-2 border-amber-400 pl-2 text-black/70 dark:text-white/70">
                    {note.quote}
                  </p>
                  {note.note ? <p>{note.note}</p> : null}
                  <div className="flex items-center justify-between gap-2">
                    <Switch
                      checked={note.isPublic}
                      loading={
                        updateNote.isPending &&
                        updateNote.variables?.id === note.id
                      }
                      onCheckedChange={(isPublic) =>
                        updateNote.mutate({ id: note.id, isPublic })
                      }
                      label={
                        note.isPublic ? m.novels_public() : m.novels_private()
                      }
                    />
                    <Button
                      variant="text"
                      tone="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => {
                        if (window.confirm(m.novels_note_delete_confirm()))
                          deleteNote.mutate(note.id);
                      }}
                    >
                      {m.novels_reader_delete()}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="text-base font-semibold">
          {m.novels_reader_public_notes()}
        </h2>
        {publicNotes.length === 0 ? (
          <p className="mt-2 text-sm text-black/45 dark:text-white/45">
            {m.novels_reader_no_public_notes()}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {publicNotes.map((note) => (
              <li key={note.id} className="fuwari-card-base p-3 text-sm">
                <p className="border-l-2 border-sky-400 pl-2 text-black/70 dark:text-white/70">
                  {note.quote}
                </p>
                {note.note ? <p className="mt-1.5">{note.note}</p> : null}
                <p className="mt-1.5 text-xs text-black/40 dark:text-white/40">
                  {note.userName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {signedIn && draft ? (
        <div className="fuwari-card-base fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <p className="line-clamp-2 flex-1 border-l-2 border-amber-400 pl-2 text-sm italic text-black/70 dark:text-white/70">
              {draft.quote}
            </p>
            <IconButton
              label={m.novels_reader_cancel()}
              size="xs"
              onClick={() => setDraft(null)}
            >
              <X size={16} />
            </IconButton>
          </div>
          <Textarea
            value={draftNote}
            onChange={(event) => setDraftNote(event.target.value)}
            placeholder={m.novels_reader_note_placeholder()}
            rows={3}
            maxLength={2000}
            className="mt-3 resize-none"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Switch
              checked={draftPublic}
              onCheckedChange={setDraftPublic}
              label={m.novels_share_public()}
            />
            <div className="flex gap-2">
              <Button variant="plain" size="sm" onClick={() => setDraft(null)}>
                {m.novels_reader_cancel()}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={createNote.isPending}
                onClick={() =>
                  createNote.mutate({
                    note: draftNote,
                    isPublic: draftPublic,
                  })
                }
              >
                {m.novels_reader_save_note()}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
