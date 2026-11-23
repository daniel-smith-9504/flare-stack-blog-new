import { createFileRoute } from "@tanstack/react-router";
import { NovelMutesPage } from "@/features/novels/components/admin/novel-mutes-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/mutes")({
  head: () => ({ meta: [{ title: m.admin_novel_mutes_title() }] }),
  component: NovelMutesPage,
});
