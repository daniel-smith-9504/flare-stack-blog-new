import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelReader } from "@/features/novels/components/novel-reader";
import { novelChapterQuery, novelQuery } from "@/features/novels/queries";
import { novelReaderSearchSchema } from "@/features/novels/novels-search";
import { CACHE_CONTROL } from "@/lib/constants";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/$id/read")({
  validateSearch: novelReaderSearchSchema,
  loaderDeps: ({ search }) => ({ chapter: search.chapter }),
  loader: async ({ context, params, deps }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound();
    const novel = await context.queryClient.ensureQueryData(novelQuery(id));
    if (!novel) throw notFound();

    const order = deps.chapter ?? novel.chapters[0]?.order ?? 1;
    const [chapter, domain] = await Promise.all([
      context.queryClient.ensureQueryData(novelChapterQuery(id, order)),
      context.queryClient.ensureQueryData(siteDomainQuery),
    ]);
    if (!chapter) throw notFound();

    return {
      order,
      title: `${
        chapter.title || m.novels_chapter_number({ order })
      } · ${novel.title}`,
      canonicalHref: buildCanonicalUrl(domain, `/novels/${id}/read`, {
        chapter: String(order),
      }),
    };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData?.title }],
    links: [canonicalLink(loaderData?.canonicalHref ?? "/novels")],
  }),
  headers: () => CACHE_CONTROL.html,
  component: NovelReadRoute,
});

function NovelReadRoute() {
  const { id } = Route.useParams();
  const { order } = Route.useLoaderData();
  const { data: novel } = useSuspenseQuery(novelQuery(Number(id)));
  const { data: chapter } = useSuspenseQuery(
    novelChapterQuery(Number(id), order),
  );
  if (!novel || !chapter) return null;
  return <NovelReader novel={novel} chapter={chapter} />;
}
