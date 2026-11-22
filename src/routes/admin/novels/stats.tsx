import { createFileRoute } from "@tanstack/react-router";
import { NovelStatsPage } from "@/features/novels/components/admin/novel-stats-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/stats")({
  ssr: false,
  component: NovelStatsPage,
  loader: () => ({ title: m.admin_novel_stats_title() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
});
