import { createFileRoute } from "@tanstack/react-router";
import { NovelNotesPage } from "@/features/novels/components/admin/novel-notes-page";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/novels/notes")({
  ssr: false,
  component: NovelNotesPage,
  loader: () => ({ title: m.admin_novel_notes_title() }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
  }),
});
