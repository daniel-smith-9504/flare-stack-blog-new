import { createFileRoute } from "@tanstack/react-router";
import { NovelTagsPage } from "@/features/novels/components/admin/novel-tags-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/tags")({
  ssr: false,
  component: NovelTagsPage,
  loader: () => ({ title: m.admin_novel_tags_title() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
});
