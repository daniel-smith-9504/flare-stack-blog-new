import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { NOVELS_QUERY_KEY, adminNotesQuery } from "@/features/novels/queries";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

/** 批注审核: reports, community votes and removal of shared highlights. */
export function NovelNotesPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"visible" | "removed" | undefined>(
    "visible",
  );
  const { data: notes = [], isPending } = useQuery(adminNotesQuery(status));

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "admin", "notes"],
    });
  };

  const remove = useMutation({
    mutationFn: (id: number) => {
      const reason = window.prompt(m.admin_novel_notes_reason()) ?? "";
      return orpcClient.novels.admin.removeNote({ id, reason });
    },
    onSuccess: () => {
      toast.success(m.admin_novel_notes_removed());
      refresh();
    },
    onError: () => toast.error(m.admin_novel_notes_failed()),
  });

  const restore = useMutation({
    mutationFn: (id: number) => orpcClient.novels.admin.restoreNote({ id }),
    onSuccess: () => {
      toast.success(m.admin_novel_notes_restored());
      refresh();
    },
    onError: () => toast.error(m.admin_novel_notes_failed()),
  });

  return (
    <AdminPage
      title={m.admin_novel_notes_title()}
      count={notes.length}
      description={m.admin_novel_notes_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-4">
        <div className="flex gap-2">
          <Button
            variant={status === "visible" ? "primary" : "plain"}
            size="sm"
            onClick={() => setStatus("visible")}
          >
            {m.admin_novel_notes_status_visible()}
          </Button>
          <Button
            variant={status === "removed" ? "primary" : "plain"}
            size="sm"
            onClick={() => setStatus("removed")}
          >
            {m.admin_novel_notes_status_removed()}
          </Button>
          <Button
            variant={status === undefined ? "primary" : "plain"}
            size="sm"
            onClick={() => setStatus(undefined)}
          >
            {m.admin_novel_notes_status_all()}
          </Button>
        </div>

        {isPending ? null : notes.length === 0 ? (
          <p className="fuwari-card-base p-4 text-sm text-black/50 dark:text-white/50">
            {m.admin_novel_notes_empty()}
          </p>
        ) : (
          <ul className="space-y-2">
            {notes.map((note) => (
              <li key={note.id} className="fuwari-card-base space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-black/50 dark:text-white/50">
                  <span className="font-medium text-black/70 dark:text-white/70">
                    {note.userName}
                  </span>
                  <span>
                    {note.novelTitle} · {note.chapterOrder}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Flag size={12} />
                      {note.reportCount}
                    </span>
                    <span>
                      {m.admin_novel_notes_likes({ count: note.likes })}
                    </span>
                    <span>
                      {m.admin_novel_notes_votes({
                        remove: note.removeVotes,
                        keep: note.keepVotes,
                      })}
                    </span>
                  </span>
                </div>
                <p className="border-l-2 border-sky-400 pl-2 text-sm text-black/70 dark:text-white/70">
                  {note.quote}
                </p>
                {note.note ? (
                  <p className="whitespace-pre-wrap text-sm">{note.note}</p>
                ) : null}
                {note.removeReason ? (
                  <p className="text-xs text-red-500">
                    {m.admin_novel_notes_remove_reason({
                      reason: note.removeReason,
                    })}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  {note.status === "removed" ? (
                    <Button
                      variant="plain"
                      size="sm"
                      icon={<RotateCcw size={14} />}
                      loading={restore.isPending}
                      onClick={() => restore.mutate(note.id)}
                    >
                      {m.admin_novel_notes_restore()}
                    </Button>
                  ) : (
                    <Button
                      variant="plain"
                      tone="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      loading={remove.isPending}
                      onClick={() => remove.mutate(note.id)}
                    >
                      {m.admin_novel_notes_remove()}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminPage>
  );
}
