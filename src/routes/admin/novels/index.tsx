import { createFileRoute } from "@tanstack/react-router";
import { NovelAdminPage } from "@/features/novels/components/admin/novel-admin-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/")({
  ssr: false,
  component: NovelAdminPage,
  loader: () => ({ title: m.admin_novels_title() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
});
