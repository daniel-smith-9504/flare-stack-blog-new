import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelPage } from "@/features/novels/components/novel-page";
import { novelQuery } from "@/features/novels/queries";
import { CACHE_CONTROL } from "@/lib/constants";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/$id/")({
  loader: async ({ context, params }) => {
    const novel = await context.queryClient.ensureQueryData(
      novelQuery(params.id),
    );
    if (!novel) throw notFound();
    // An old numeric link still works, but settles on the readable URL.
    if (/^\d+$/u.test(params.id) && params.id !== novel.slug) {
      throw redirect({
        to: "/novels/$id",
        params: { id: novel.slug },
        replace: true,
      });
    }
    const domain = await context.queryClient.ensureQueryData(siteDomainQuery);
    return {
      title: `${novel.title} · ${m.novels_title()}`,
      description: novel.description || m.novels_description(),
      canonicalHref: buildCanonicalUrl(domain, `/novels/${novel.slug}`),
    };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.title },
      { name: "description", content: loaderData?.description },
    ],
    links: [canonicalLink(loaderData?.canonicalHref ?? "/novels")],
  }),
  headers: () => CACHE_CONTROL.html,
  component: NovelDetailRoute,
});

function NovelDetailRoute() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(novelQuery(id));
  if (!data) return null;
  return <NovelPage novel={data} />;
}
