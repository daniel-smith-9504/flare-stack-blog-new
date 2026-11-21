import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/** A book's cover, or a typographic stand-in when it has none. */
export function NovelCover({
  title,
  coverUrl,
  className,
}: {
  title: string;
  coverUrl: string | null;
  className?: string;
}) {
  if (coverUrl)
    return (
      <img
        src={coverUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={cn(
          "h-full w-full rounded-lg object-cover shadow-sm",
          className,
        )}
      />
    );
  return (
    <div
      aria-hidden="true"
      className={cn(
        "flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg bg-gradient-to-br from-sky-500/80 via-indigo-500/70 to-violet-500/80 p-2 text-center text-white shadow-sm",
        className,
      )}
    >
      <BookOpen size={20} strokeWidth={1.5} />
      <span className="line-clamp-3 text-xs font-medium leading-tight">
        {title}
      </span>
    </div>
  );
}
