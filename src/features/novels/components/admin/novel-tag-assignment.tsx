import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  adminNovelTagsQuery,
  NOVELS_QUERY_KEY,
} from "@/features/novels/queries";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

/** The tags on one book, chosen from the shelf's tags. */
export function NovelTagAssignment({ novelId }: { novelId: number }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    ...adminNovelTagsQuery(novelId),
    enabled: open,
  });
  const [assigned, setAssigned] = useState<Array<number> | null>(null);

  const save = useMutation({
    mutationFn: (tagIds: Array<number>) =>
      orpcClient.novels.admin.setNovelTags({ novelId, tagIds }),
    onSuccess: () => {
      toast.success(m.admin_novel_tags_saved());
      setOpen(false);
      setAssigned(null);
      void queryClient.invalidateQueries({
        queryKey: [...NOVELS_QUERY_KEY, "admin", "novel-tags", novelId],
      });
    },
    onError: () => toast.error(m.admin_novel_tags_failed()),
  });

  const chosen = assigned ?? data?.assigned ?? [];

  return (
    <div className="relative">
      <Button
        variant="text"
        size="sm"
        icon={<Tag size={14} />}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {m.admin_novel_tags_assign()}
      </Button>
      {open && data ? (
        <div className="mt-2 w-full rounded-lg border border-black/10 p-2 text-xs dark:border-white/10">
          {data.tags.length === 0 ? (
            <p className="text-black/50 dark:text-white/50">
              {m.admin_novel_tags_empty()}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.tags.map((tag) => {
                const picked = chosen.includes(tag.id);
                return (
                  <Button
                    key={tag.id}
                    variant={picked ? "ink" : "quiet"}
                    size="xs"
                    aria-pressed={picked}
                    onClick={() =>
                      setAssigned(
                        picked
                          ? chosen.filter((id) => id !== tag.id)
                          : [...chosen, tag.id],
                      )
                    }
                  >
                    {tag.name}
                  </Button>
                );
              })}
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <Button
              variant="plain"
              size="sm"
              onClick={() => {
                setOpen(false);
                setAssigned(null);
              }}
            >
              {m.admin_novel_tags_cancel()}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={save.isPending}
              onClick={() => save.mutate(chosen)}
            >
              {m.admin_novel_tags_save()}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
