import { createFileRoute } from "@tanstack/react-router";
import { NovelChaptersPage } from "@/features/novels/components/admin/novel-chapters-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/$id")({
  ssr: false,
  component: NovelChaptersRoute,
  loader: () => ({ title: m.admin_novel_chapters_title() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
});

function NovelChaptersRoute() {
  const { id } = Route.useParams();
  return <NovelChaptersPage novelId={Number(id)} />;
}
