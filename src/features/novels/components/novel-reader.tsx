import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Flag,
  Highlighter,
  Maximize2,
  Minimize2,
  Settings2,
  ThumbsUp,
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
  NOVEL_NOTE_COLLAPSE_LENGTH,
  NOVEL_NOTE_CONTEXT_LENGTH,
  NOVEL_PAGE_WIDTH_MAX,
  NOVEL_PAGE_WIDTH_MIN,
  NOVEL_READING_HEARTBEAT_SECONDS,
  NOVEL_REPORT_VOTE_THRESHOLD,
} from "@/features/novels/novels.constants";
import {
  NOVELS_QUERY_KEY,
  bookmarksQuery,
  myMuteQuery,
  novelChapterQuery,
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
import { formatDate } from "@/lib/utils";
import { m } from "@/paraglide/messages";

const THEMES = {
  light: { background: "#ffffff", color: "#1f2937" },
  sepia: { background: "#f5ecd9", color: "#5b4636" },
  dark: { background: "#1f2937", color: "#e5e7eb" },
  green: { background: "#e3efd8", color: "#2f4a2c" },
  blue: { background: "#e4eef8", color: "#24384d" },
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
  const { data: mute } = useQuery(myMuteQuery(signedIn));
  const muted = mute?.muted ?? false;

  const { data: progress } = useQuery(novelProgressQuery(novel.id, signedIn));
  const { data: savedSettings } = useQuery(novelSettingsQuery(signedIn));
  const { data: ownNotes = [] } = useQuery(
    ownNotesQuery(novel.id, chapter.order, signedIn),
  );
  const [sort, setSort] = useState<"newest" | "hottest">("newest");
  const { data: publicNotes = [] } = useQuery(
    publicNotesQuery(novel.id, chapter.order, sort),
  );
  const { data: bookmarks = [] } = useQuery(bookmarksQuery(novel.id, signedIn));

  const [settings, setSettings] = useState<NovelSettings>(
    DEFAULT_NOVEL_SETTINGS,
  );
  useEffect(() => {
    if (savedSettings) setSettings(savedSettings);
  }, [savedSettings]);

  const [showSettings, setShowSettings] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [expandedNotes, setExpandedNotes] = useState<Record<number, boolean>>(
    {},
  );
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftNote, setDraftNote] = useState("");
  const [draftPublic, setDraftPublic] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [pageStep, setPageStep] = useState(
    DEFAULT_NOVEL_SETTINGS.pageWidth + 40,
  );
  const [viewportHeight, setViewportHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef(0);
  const bookmarked = bookmarks.some(
    (bookmark) => bookmark.chapterOrder === chapter.order,
  );

  // Where the reader stopped, once the chapter has been laid out.
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (settings.readingMode === "paged") return;
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
  }, [progress, chapter.order, settings.readingMode]);

  // Keep the place while reading and when the page is left.
  useEffect(() => {
    if (!signedIn) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      const ratio =
        settings.readingMode === "paged" && pageCount > 1
          ? pageIndex / (pageCount - 1)
          : (() => {
              const max =
                document.documentElement.scrollHeight - window.innerHeight;
              return max > 0
                ? Math.min(1, Math.max(0, window.scrollY / max))
                : 0;
            })();
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
  }, [
    signedIn,
    novel.id,
    chapter.order,
    settings.readingMode,
    pageIndex,
    pageCount,
  ]);

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

  const likeNote = useMutation({
    mutationFn: (id: number) => orpcClient.novels.likeNote({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...NOVELS_QUERY_KEY,
          "public-notes",
          novel.id,
          chapter.order,
        ],
      });
    },
    onError: () => toast.error(m.novels_note_failed()),
  });

  const reportNote = useMutation({
    mutationFn: (id: number) =>
      orpcClient.novels.reportNote({ id, reason: "" }),
    onSuccess: () => toast.success(m.novels_note_reported()),
    onError: () => toast.error(m.novels_note_report_failed()),
  });

  const voteNote = useMutation({
    mutationFn: (input: { id: number; choice: "remove" | "keep" }) =>
      orpcClient.novels.voteNote(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [
          ...NOVELS_QUERY_KEY,
          "public-notes",
          novel.id,
          chapter.order,
        ],
      });
      toast.success(m.novels_note_voted());
    },
    onError: () => toast.error(m.novels_note_vote_failed()),
  });

  const toggleBookmark = useMutation({
    mutationFn: () =>
      orpcClient.novels.setBookmark({
        novelId: novel.id,
        chapterOrder: chapter.order,
        bookmarked: !bookmarked,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "bookmarks", novel.id],
      });
      toast.success(
        bookmarked ? m.novels_bookmark_removed() : m.novels_bookmark_added(),
      );
    },
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
    green: m.novels_reader_theme_green,
    blue: m.novels_reader_theme_blue,
  };
  const content = useMemo(
    () => highlightedText(chapter.content, ownNotes),
    [chapter.content, ownNotes],
  );

  const goToChapter = (order: number) =>
    void navigate({
      to: "/novels/$id/read",
      params: { id: novel.slug },
      search: { chapter: order },
    });

  const nextPage = () => {
    if (pageIndex < pageCount - 1) setPageIndex((index) => index + 1);
    else if (chapter.nextOrder !== null) goToChapter(chapter.nextOrder);
  };
  const prevPage = () => {
    if (pageIndex > 0) setPageIndex((index) => index - 1);
    else if (chapter.prevOrder !== null) goToChapter(chapter.prevOrder);
  };
  const cycleTheme = () => {
    const themes = Object.keys(THEMES) as Array<keyof typeof THEMES>;
    const next = themes[(themes.indexOf(settings.theme) + 1) % themes.length];
    updateSettings({ theme: next });
  };

  // Lay the chapter out in columns and count the pages when paging.
  useEffect(() => {
    if (settings.readingMode !== "paged") return;
    const measure = () => {
      const columns = columnsRef.current;
      if (!columns) return;
      // On a phone the sheet is narrower than the chosen page width, and the
      // columns follow the sheet, so measure the step rather than assume it.
      const step = columns.clientWidth + 40;
      setPageStep(step);
      setPageCount(Math.max(1, Math.ceil((columns.scrollWidth + 1) / step)));
      setViewportHeight(
        Math.max(320, window.innerHeight - (immersive ? 190 : 330)),
      );
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  }, [
    settings.readingMode,
    settings.pageWidth,
    settings.fontSize,
    settings.lineHeight,
    settings.fontFamily,
    chapter.content,
    ownNotes,
    immersive,
  ]);

  // A paged chapter reopens on the page the reader stopped at.
  const restoredPage = useRef<string | null>(null);
  useEffect(() => {
    setPageIndex(0);
    restoredPage.current = null;
  }, [chapter.order]);
  useEffect(() => {
    if (settings.readingMode !== "paged" || pageCount <= 1) return;
    if (!progress || progress.chapterOrder !== chapter.order) return;
    const key = `${chapter.order}:${progress.updatedAt.getTime()}:${pageCount}`;
    if (restoredPage.current === key) return;
    restoredPage.current = key;
    setPageIndex(
      Math.min(
        pageCount - 1,
        Math.max(0, Math.round(progress.progressRatio * (pageCount - 1))),
      ),
    );
  }, [settings.readingMode, progress, chapter.order, pageCount]);

  // Reading time: a heartbeat adds the seconds and the words just read.
  useEffect(() => {
    if (!signedIn) return;
    const ratio = () =>
      settings.readingMode === "paged" && pageCount > 1
        ? pageIndex / (pageCount - 1)
        : (() => {
            const max =
              document.documentElement.scrollHeight - window.innerHeight;
            return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
          })();
    let last = ratio();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const current = ratio();
      const words = Math.round(
        Math.abs(current - last) * chapter.content.length,
      );
      last = current;
      void orpcClient.novels
        .reading({
          novelId: novel.id,
          chapterOrder: chapter.order,
          seconds: NOVEL_READING_HEARTBEAT_SECONDS,
          words: Math.min(200_000, words),
        })
        .catch(() => undefined);
    }, NOVEL_READING_HEARTBEAT_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [
    signedIn,
    novel.id,
    chapter.order,
    chapter.content.length,
    settings.readingMode,
    pageIndex,
    pageCount,
  ]);

  // Preload the next chapter so "next" opens without a wait.
  useEffect(() => {
    if (chapter.nextOrder === null) return;
    const timer = setTimeout(() => {
      void queryClient.prefetchQuery(
        novelChapterQuery(novel.id, chapter.nextOrder as number),
      );
    }, 1200);
    return () => clearTimeout(timer);
  }, [novel.id, chapter.nextOrder, queryClient]);

  // Arrow keys turn pages, or chapters once a page boundary is reached.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const paged = settings.readingMode === "paged";
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        if (paged) nextPage();
        else if (chapter.nextOrder !== null) goToChapter(chapter.nextOrder);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        if (paged) prevPage();
        else if (chapter.prevOrder !== null) goToChapter(chapter.prevOrder);
      } else if (event.key.toLowerCase() === "t") {
        cycleTheme();
      } else if (event.key.toLowerCase() === "f") {
        setImmersive((value) => !value);
      } else if (event.key.toLowerCase() === "s" && signedIn) {
        setShowSettings((value) => !value);
      } else if (event.key.toLowerCase() === "b" && signedIn) {
        toggleBookmark.mutate();
      } else if (event.key === "Escape") {
        setImmersive(false);
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    pageIndex,
    pageCount,
    signedIn,
    bookmarked,
    novel.id,
    chapter.nextOrder,
    chapter.prevOrder,
    settings.readingMode,
    settings.theme,
  ]);

  return (
    <div
      className={
        immersive
          ? "fixed inset-0 z-40 overflow-auto px-4 py-4"
          : "mx-auto w-full max-w-3xl px-4 py-6"
      }
      style={
        immersive
          ? { background: theme.background, color: theme.color }
          : undefined
      }
    >
      {immersive ? (
        <div
          className="mx-auto flex max-w-3xl items-center gap-2 text-sm"
          style={{ color: theme.color }}
        >
          <span className="line-clamp-1 min-w-0 flex-1 font-medium">
            {novel.title} ·{" "}
            {chapter.title || m.novels_chapter_number({ order: chapter.order })}
          </span>
          {signedIn ? (
            <Button
              variant="plain"
              size="sm"
              icon={
                bookmarked ? (
                  <BookmarkCheck size={15} />
                ) : (
                  <Bookmark size={15} />
                )
              }
              onClick={() => toggleBookmark.mutate()}
            >
              {bookmarked ? m.novels_bookmarked() : m.novels_bookmark()}
            </Button>
          ) : null}
          <Button
            variant="plain"
            size="sm"
            icon={<Minimize2 size={15} />}
            onClick={() => setImmersive(false)}
          >
            {m.novels_reader_exit_immersive()}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/novels/$id"
              params={{ id: novel.slug }}
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
              params={{ id: novel.slug }}
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
                icon={
                  bookmarked ? (
                    <BookmarkCheck size={15} />
                  ) : (
                    <Bookmark size={15} />
                  )
                }
                onClick={() => toggleBookmark.mutate()}
                aria-pressed={bookmarked}
              >
                {bookmarked ? m.novels_bookmarked() : m.novels_bookmark()}
              </Button>
            ) : null}
            <Button
              variant="plain"
              size="sm"
              icon={<Maximize2 size={15} />}
              onClick={() => setImmersive(true)}
            >
              {m.novels_reader_immersive()}
            </Button>
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
        </>
      )}

      {signedIn && showSettings ? (
        <div className="fuwari-card-base mt-3 space-y-4 p-4 text-sm">
          <div>
            <p className="mb-1.5 text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_theme()}
            </p>
            <div className="flex flex-wrap gap-2">
              {(["light", "sepia", "dark", "green", "blue"] as const).map(
                (value) => (
                  <Button
                    key={value}
                    variant={settings.theme === value ? "primary" : "plain"}
                    size="sm"
                    onClick={() => updateSettings({ theme: value })}
                  >
                    {themeLabels[value]()}
                  </Button>
                ),
              )}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_mode()}
            </p>
            <div className="flex gap-2">
              <Button
                variant={
                  settings.readingMode === "scroll" ? "primary" : "plain"
                }
                size="sm"
                onClick={() => updateSettings({ readingMode: "scroll" })}
              >
                {m.novels_reader_mode_scroll()}
              </Button>
              <Button
                variant={settings.readingMode === "paged" ? "primary" : "plain"}
                size="sm"
                onClick={() => updateSettings({ readingMode: "paged" })}
              >
                {m.novels_reader_mode_paged()}
              </Button>
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
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-black/60 dark:text-white/60">
              {m.novels_reader_page_width()}
            </span>
            <Slider
              min={NOVEL_PAGE_WIDTH_MIN}
              max={NOVEL_PAGE_WIDTH_MAX}
              step={20}
              value={settings.pageWidth}
              onChange={(event) =>
                updateSettings({ pageWidth: Number(event.target.value) })
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
        {immersive ? null : (
          <header className="border-b border-black/10 px-5 py-4">
            <h1 className="text-lg font-semibold">
              {chapter.title ||
                m.novels_chapter_number({ order: chapter.order })}
            </h1>
          </header>
        )}
        <div className="p-4 sm:p-6">
          {signedIn && !draft ? (
            <p className="mb-4 select-none text-xs opacity-50">
              {m.novels_reader_select_hint()}
            </p>
          ) : null}
          <div className="mx-auto" style={{ maxWidth: settings.pageWidth }}>
            {settings.readingMode === "paged" ? (
              <>
                <div
                  ref={viewportRef}
                  className="relative overflow-hidden"
                  style={{ height: viewportHeight || 360 }}
                  onTouchStart={(event) => {
                    touchStart.current = event.touches[0]?.clientX ?? 0;
                  }}
                  onTouchEnd={(event) => {
                    const end = event.changedTouches[0]?.clientX ?? 0;
                    const delta = end - touchStart.current;
                    if (Math.abs(delta) < 40) return;
                    if (delta < 0) nextPage();
                    else prevPage();
                  }}
                >
                  <div
                    ref={(node) => {
                      contentRef.current = node;
                      columnsRef.current = node;
                    }}
                    onMouseUp={() => {
                      if (!signedIn) return;
                      const offsets = selectionOffsets(contentRef.current);
                      if (offsets) setDraft(offsets);
                    }}
                    className="whitespace-pre-wrap break-words"
                    style={{
                      height: "100%",
                      columnWidth: `${settings.pageWidth}px`,
                      columnGap: "40px",
                      columnFill: "auto",
                      fontSize: `${settings.fontSize}px`,
                      lineHeight: settings.lineHeight,
                      fontFamily: FONT_FAMILIES[settings.fontFamily],
                      transform: `translateX(-${pageIndex * pageStep}px)`,
                      transition: "transform 180ms ease-out",
                    }}
                  >
                    {content}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs opacity-70">
                  <Button
                    variant="text"
                    size="sm"
                    icon={<ChevronLeft size={15} />}
                    onClick={prevPage}
                  >
                    {m.novels_reader_page_prev()}
                  </Button>
                  <span>
                    {pageIndex + 1} / {pageCount}
                  </span>
                  <Button
                    variant="text"
                    size="sm"
                    icon={<ChevronRight size={15} />}
                    onClick={nextPage}
                  >
                    {m.novels_reader_page_next()}
                  </Button>
                </div>
              </>
            ) : (
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
            )}
          </div>
        </div>
      </article>

      <nav
        className={
          immersive ? "hidden" : "mt-4 flex items-center justify-between gap-3"
        }
      >
        {chapter.prevOrder !== null ? (
          <Link
            to="/novels/$id/read"
            params={{ id: novel.slug }}
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
            params={{ id: novel.slug }}
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
        <section className={immersive ? "hidden" : "mt-8"}>
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

      <section className={immersive ? "hidden" : "mt-8"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {m.novels_reader_public_notes()}
          </h2>
          <div className="flex gap-2">
            <Button
              variant={sort === "newest" ? "primary" : "plain"}
              size="sm"
              onClick={() => setSort("newest")}
            >
              {m.novels_notes_sort_newest()}
            </Button>
            <Button
              variant={sort === "hottest" ? "primary" : "plain"}
              size="sm"
              onClick={() => setSort("hottest")}
            >
              {m.novels_notes_sort_hottest()}
            </Button>
          </div>
        </div>
        {publicNotes.length === 0 ? (
          <p className="mt-2 text-sm text-black/45 dark:text-white/45">
            {m.novels_reader_no_public_notes()}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {publicNotes.map((note) => {
              const long = note.note.length > NOVEL_NOTE_COLLAPSE_LENGTH;
              const expanded = expandedNotes[note.id] ?? false;
              return (
                <li key={note.id} className="fuwari-card-base p-3 text-sm">
                  <p className="border-l-2 border-sky-400 pl-2 text-black/70 dark:text-white/70">
                    {note.quote}
                  </p>
                  {note.note ? (
                    <p
                      className={`mt-1.5 whitespace-pre-wrap ${
                        long && !expanded ? "line-clamp-4" : ""
                      }`}
                    >
                      {note.note}
                    </p>
                  ) : null}
                  {long ? (
                    <Button
                      variant="text"
                      size="xs"
                      className="mt-1"
                      onClick={() =>
                        setExpandedNotes((previous) => ({
                          ...previous,
                          [note.id]: !expanded,
                        }))
                      }
                    >
                      {expanded
                        ? m.novels_note_collapse()
                        : m.novels_note_expand()}
                    </Button>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-black/45 dark:text-white/45">
                    <span>{note.userName}</span>
                    <Button
                      variant="text"
                      size="sm"
                      icon={<ThumbsUp size={14} />}
                      aria-pressed={note.likedByMe}
                      onClick={() => {
                        if (!signedIn)
                          return toast.error(m.novels_note_login_required());
                        likeNote.mutate(note.id);
                      }}
                    >
                      {note.likeCount}
                    </Button>
                    <Button
                      variant="text"
                      size="sm"
                      icon={<Flag size={14} />}
                      onClick={() => reportNote.mutate(note.id)}
                    >
                      {m.novels_note_report()}
                    </Button>
                    {note.reportCount >= NOVEL_REPORT_VOTE_THRESHOLD ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span>{m.novels_note_vote_prompt()}</span>
                        <Button
                          variant="text"
                          tone="danger"
                          size="sm"
                          onClick={() => {
                            if (!signedIn)
                              return toast.error(
                                m.novels_note_login_required(),
                              );
                            voteNote.mutate({ id: note.id, choice: "remove" });
                          }}
                        >
                          {m.novels_note_remove()}
                        </Button>
                        <Button
                          variant="text"
                          size="sm"
                          onClick={() => {
                            if (!signedIn)
                              return toast.error(
                                m.novels_note_login_required(),
                              );
                            voteNote.mutate({ id: note.id, choice: "keep" });
                          }}
                        >
                          {m.novels_note_keep()}
                        </Button>
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
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
          {muted ? (
            <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              {mute?.permanent
                ? m.novels_muted_permanent()
                : m.novels_muted_until({
                    until: formatDate(mute?.until, { includeTime: true }),
                  })}
            </p>
          ) : null}
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
                disabled={muted}
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
