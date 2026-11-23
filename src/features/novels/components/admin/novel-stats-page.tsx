import { useQuery } from "@tanstack/react-query";
import { Clock3, Eye, Users, WholeWord } from "lucide-react";
import { useState } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { adminNovelStatsQuery } from "@/features/novels/queries";
import { m } from "@/paraglide/messages";

function minutes(seconds: number) {
  return Math.round(seconds / 60);
}

/** 阅读数据: the reading report, built on the existing page-view tracking. */
export function NovelStatsPage() {
  const [days, setDays] = useState(30);
  const { data, isPending } = useQuery(adminNovelStatsQuery(days));

  const peak = Math.max(1, ...(data?.daily.map((day) => day.views) ?? [1]));

  return (
    <AdminPage
      title={m.admin_novel_stats_title()}
      description={m.admin_novel_stats_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-5">
        <div className="flex gap-2">
          {[7, 30, 90].map((value) => (
            <Button
              key={value}
              variant={days === value ? "primary" : "plain"}
              size="sm"
              onClick={() => setDays(value)}
            >
              {m.admin_novel_stats_days({ days: value })}
            </Button>
          ))}
        </div>

        {isPending || !data ? null : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat
                icon={<Eye size={16} />}
                label={m.admin_novel_stats_views()}
                value={data.summary.views}
              />
              <Stat
                icon={<Users size={16} />}
                label={m.admin_novel_stats_visitors()}
                value={data.summary.visitors}
              />
              <Stat
                icon={<Clock3 size={16} />}
                label={m.admin_novel_stats_minutes()}
                value={minutes(data.summary.seconds)}
              />
              <Stat
                icon={<WholeWord size={16} />}
                label={m.admin_novel_stats_words()}
                value={data.summary.words}
              />
            </div>

            <section className="fuwari-card-base p-4">
              <h2 className="text-sm font-semibold">
                {m.admin_novel_stats_daily()}
              </h2>
              <div className="mt-3 flex gap-2">
                <div className="flex h-32 flex-col justify-between text-right text-[10px] tabular-nums text-black/40 dark:text-white/40">
                  <span>{peak}</span>
                  <span>0</span>
                </div>
                <div className="flex h-32 flex-1 items-end gap-px sm:gap-1">
                  {data.daily.map((day) => {
                    const date = new Date(day.day).toISOString().slice(0, 10);
                    return (
                      <div
                        key={day.day}
                        title={`${date} · ${m.admin_novel_stats_views()}: ${day.views} · ${m.admin_novel_stats_minutes()}: ${minutes(day.seconds)}`}
                        className="flex-1 rounded-t bg-(--primary)/60 transition-colors hover:bg-(--primary)"
                        style={{
                          height: `${Math.max(2, (day.views / peak) * 100)}%`,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
              <div className="mt-1 flex justify-between pl-7 text-[10px] tabular-nums text-black/40 dark:text-white/40">
                <span>
                  {new Date(data.daily[0]?.day ?? 0).toISOString().slice(5, 10)}
                </span>
                <span>
                  {new Date(data.daily.at(-1)?.day ?? 0)
                    .toISOString()
                    .slice(5, 10)}
                </span>
              </div>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section className="fuwari-card-base p-4">
                <h2 className="text-sm font-semibold">
                  {m.admin_novel_stats_top_books()}
                </h2>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {data.topNovels.length === 0 ? (
                    <li className="text-black/50 dark:text-white/50">
                      {m.admin_novel_stats_empty()}
                    </li>
                  ) : (
                    data.topNovels.map((novel, index) => (
                      <li key={novel.id} className="flex items-baseline gap-2">
                        <span className="w-5 text-xs text-black/40 dark:text-white/40">
                          {index + 1}
                        </span>
                        <span className="line-clamp-1 flex-1">
                          {novel.title}
                        </span>
                        <span className="text-xs text-black/50 dark:text-white/50">
                          {novel.views}
                        </span>
                      </li>
                    ))
                  )}
                </ol>
              </section>
              <section className="fuwari-card-base p-4">
                <h2 className="text-sm font-semibold">
                  {m.admin_novel_stats_top_chapters()}
                </h2>
                <ol className="mt-2 space-y-1.5 text-sm">
                  {data.topChapters.length === 0 ? (
                    <li className="text-black/50 dark:text-white/50">
                      {m.admin_novel_stats_empty()}
                    </li>
                  ) : (
                    data.topChapters.map((chapter) => (
                      <li
                        key={`${chapter.novelId}-${chapter.chapterOrder}`}
                        className="flex items-baseline gap-2"
                      >
                        <span className="line-clamp-1 flex-1">
                          {chapter.novelTitle} · {chapter.chapterOrder}
                        </span>
                        <span className="text-xs text-black/50 dark:text-white/50">
                          {chapter.views}
                        </span>
                      </li>
                    ))
                  )}
                </ol>
              </section>
            </div>
          </>
        )}
      </div>
    </AdminPage>
  );
}

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="fuwari-card-base p-4">
      <p className="flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
