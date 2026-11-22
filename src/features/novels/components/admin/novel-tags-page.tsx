import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { AdminPage } from "@/components/admin/admin-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminTagsQuery, NOVELS_QUERY_KEY } from "@/features/novels/queries";
import { orpcClient } from "@/lib/orpc";
import { toast } from "@/lib/toast";
import { m } from "@/paraglide/messages";

/** 书架标签: creates, renames and deletes the shelf's tags. */
export function NovelTagsPage() {
  const queryClient = useQueryClient();
  const { data: tags = [], isPending } = useQuery(adminTagsQuery);
  const [name, setName] = useState("");

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "admin", "tags"],
    });
    void queryClient.invalidateQueries({
      queryKey: [...NOVELS_QUERY_KEY, "tags"],
    });
  };

  const create = useMutation({
    mutationFn: (value: string) =>
      orpcClient.novels.admin.createTag({ name: value }),
    onSuccess: () => {
      setName("");
      toast.success(m.admin_novel_tags_saved());
      refresh();
    },
    onError: () => toast.error(m.admin_novel_tags_failed()),
  });

  const rename = useMutation({
    mutationFn: (input: { id: number; name: string }) =>
      orpcClient.novels.admin.renameTag(input),
    onSuccess: () => {
      toast.success(m.admin_novel_tags_saved());
      refresh();
    },
    onError: () => toast.error(m.admin_novel_tags_failed()),
  });

  const remove = useMutation({
    mutationFn: (id: number) => orpcClient.novels.admin.deleteTag({ id }),
    onSuccess: () => {
      toast.success(m.admin_novel_tags_saved());
      refresh();
    },
    onError: () => toast.error(m.admin_novel_tags_failed()),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim().length === 0) return;
    create.mutate(name.trim());
  };

  return (
    <AdminPage
      title={m.admin_novel_tags_title()}
      count={tags.length}
      description={m.admin_novel_tags_description()}
      body="list"
      inset={false}
    >
      <div className="space-y-4">
        <form onSubmit={submit} className="fuwari-card-base flex gap-2 p-4">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={m.admin_novel_tags_placeholder()}
            aria-label={m.admin_novel_tags_placeholder()}
            className="max-w-xs"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            icon={<Plus size={15} />}
            loading={create.isPending}
            disabled={name.trim().length === 0}
          >
            {m.admin_novel_tags_add()}
          </Button>
        </form>

        {isPending ? null : tags.length === 0 ? (
          <p className="fuwari-card-base p-4 text-sm text-black/50 dark:text-white/50">
            {m.admin_novel_tags_empty()}
          </p>
        ) : (
          <ul className="space-y-2">
            {tags.map((tag) => (
              <li
                key={tag.id}
                className="fuwari-card-base flex items-center gap-3 p-3"
              >
                <span className="flex-1 text-sm">
                  {tag.name}
                  <span className="ml-2 text-xs text-black/40 dark:text-white/40">
                    /{tag.slug}
                  </span>
                </span>
                <span className="text-xs text-black/50 dark:text-white/50">
                  {m.admin_novel_tags_count({ count: tag.novelCount })}
                </span>
                <Button
                  variant="text"
                  size="sm"
                  icon={<Pencil size={14} />}
                  aria-label={m.admin_novel_tags_rename()}
                  onClick={() => {
                    const next = window.prompt(
                      m.admin_novel_tags_rename(),
                      tag.name,
                    );
                    if (next && next.trim() && next.trim() !== tag.name)
                      rename.mutate({ id: tag.id, name: next.trim() });
                  }}
                />
                <Button
                  variant="text"
                  tone="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  aria-label={m.admin_novel_tags_delete()}
                  onClick={() => {
                    if (!window.confirm(m.admin_novel_tags_delete_confirm()))
                      return;
                    remove.mutate(tag.id);
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
