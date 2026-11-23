import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelReader } from "@/features/novels/components/novel-reader";
import type { NovelDetail } from "@/features/novels/novels.schema";
import { novelChapterQuery, novelQuery } from "@/features/novels/queries";
import { novelReaderSearchSchema } from "@/features/novels/novels-search";
import { CACHE_CONTROL } from "@/lib/constants";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/$id/read")({
  validateSearch: novelReaderSearchSchema,
  loaderDeps: ({ search }) => ({ chapter: search.chapter }),
  loader: async ({ context, params, deps }) => {
    const novel = await context.queryClient.ensureQueryData(
      novelQuery(params.id),
    );
    if (!novel) throw notFound();
    if (/^\d+$/u.test(params.id) && params.id !== novel.slug) {
      throw redirect({
        to: "/novels/$id/read",
        params: { id: novel.slug },
        search: deps.chapter ? { chapter: deps.chapter } : {},
        replace: true,
      });
    }

    const order = deps.chapter ?? novel.chapters[0]?.order ?? 1;
    const [chapter, domain] = await Promise.all([
      context.queryClient.ensureQueryData(novelChapterQuery(novel.id, order)),
      context.queryClient.ensureQueryData(siteDomainQuery),
    ]);
    if (!chapter) throw notFound();

    return {
      order,
      title: `${
        chapter.title || m.novels_chapter_number({ order })
      } · ${novel.title}`,
      canonicalHref: buildCanonicalUrl(domain, `/novels/${novel.slug}/read`, {
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
  const { data: novel } = useSuspenseQuery(novelQuery(id));
  if (!novel) return null;
  return <NovelReadLoaded novel={novel} order={order} />;
}

function NovelReadLoaded({
  novel,
  order,
}: {
  novel: NovelDetail;
  order: number;
}) {
  const { data: chapter } = useSuspenseQuery(
    novelChapterQuery(novel.id, order),
  );
  if (!chapter) return null;
  return <NovelReader novel={novel} chapter={chapter} />;
}
