import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserX } from "lucide-react";
import { useState } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import {
  NOVELS_QUERY_KEY,
  adminNovelMutesQuery,
} from "@/features/novels/queries";
import { formatDate } from "@/lib/utils";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

/** 禁言管理: novel mutes, with the level, reason and an early release. */
export function NovelMutesPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"active" | "all">("active");
  const { data: mutes = [], isPending } = useQuery(adminNovelMutesQuery);
  const visible =
    filter === "active" ? mutes.filter((mute) => mute.active) : mutes;

  const unmute = useMutation({
    mutationFn: (id: number) => orpcClient.novels.admin.unmute({ id }),
    onSuccess: () => {
      toast.success(m.admin_novel_mutes_unmuted());
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "mutes"],
      });
    },
    onError: () => toast.error(m.admin_novel_mutes_failed()),
  });

  return (
    <AdminPage
      title={m.admin_novel_mutes_title()}
      count={visible.length}
      description={m.admin_novel_mutes_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={filter === "active" ? "primary" : "plain"}
            size="sm"
            onClick={() => setFilter("active")}
          >
            {m.admin_novel_mutes_active()}
          </Button>
          <Button
            variant={filter === "all" ? "primary" : "plain"}
            size="sm"
            onClick={() => setFilter("all")}
          >
            {m.admin_novel_mutes_all()}
          </Button>
        </div>

        {isPending ? null : visible.length === 0 ? (
          <p className="fuwari-card-base p-4 text-sm text-black/50 dark:text-white/50">
            {filter === "active"
              ? m.admin_novel_mutes_empty()
              : m.admin_novel_mutes_empty_all()}
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((mute) => (
              <li
                key={mute.id}
                className="fuwari-card-base flex flex-wrap items-center gap-3 p-3"
              >
                {mute.userImage ? (
                  <img
                    src={mute.userImage}
                    alt=""
                    className="size-8 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black/5 dark:bg-white/10">
                    <UserX size={15} />
                  </span>
                )}
                <span className="font-medium">{mute.userName}</span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {m.admin_novel_mutes_level({ level: mute.level })}
                </span>
                <span
                  className={
                    mute.active
                      ? "rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600 dark:text-red-400"
                      : "rounded-full bg-black/5 px-2 py-0.5 text-xs text-black/50 dark:bg-white/10 dark:text-white/50"
                  }
                >
                  {mute.active
                    ? mute.until === null
                      ? m.admin_novel_mutes_permanent()
                      : m.admin_novel_mutes_until({
                          until: formatDate(mute.until, { includeTime: true }),
                        })
                    : m.admin_novel_mutes_expired()}
                </span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {m.admin_novel_mutes_reason({ reason: mute.reason })}
                </span>
                <span className="ml-auto text-xs text-black/50 dark:text-white/50">
                  {formatDate(mute.createdAt, { includeTime: true })}
                </span>
                {mute.active ? (
                  <Button
                    variant="plain"
                    size="sm"
                    loading={unmute.isPending}
                    onClick={() => {
                      if (!window.confirm(m.admin_novel_mutes_unmute_confirm()))
                        return;
                      unmute.mutate(mute.id);
                    }}
                  >
                    {m.admin_novel_mutes_unmute()}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
