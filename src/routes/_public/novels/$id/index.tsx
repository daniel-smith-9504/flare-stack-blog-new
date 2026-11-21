import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelPage } from "@/features/novels/components/novel-page";
import { novelQuery } from "@/features/novels/queries";
import { CACHE_CONTROL } from "@/lib/constants";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/$id/")({
  loader: async ({ context, params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound();
    const [novel, domain] = await Promise.all([
      context.queryClient.ensureQueryData(novelQuery(id)),
      context.queryClient.ensureQueryData(siteDomainQuery),
    ]);
    if (!novel) throw notFound();
    return {
      title: `${novel.title} · ${m.novels_title()}`,
      description: novel.description || m.novels_description(),
      canonicalHref: buildCanonicalUrl(domain, `/novels/${id}`),
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
  const { data } = useSuspenseQuery(novelQuery(Number(id)));
  if (!data) return null;
  return <NovelPage novel={data} />;
}
