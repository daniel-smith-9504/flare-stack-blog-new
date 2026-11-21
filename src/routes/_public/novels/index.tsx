import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelsPage } from "@/features/novels/components/novels-page";
import { novelsPageQuery } from "@/features/novels/queries";
import { CACHE_CONTROL } from "@/lib/constants";
import { pageSearchSchema } from "@/lib/public-search";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/")({
  validateSearch: pageSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ context, deps }) => {
    const [novels, domain] = await Promise.all([
      context.queryClient.ensureQueryData(novelsPageQuery(deps.page)),
      context.queryClient.ensureQueryData(siteDomainQuery),
    ]);
    if (novels.page !== deps.page) {
      throw redirect({
        to: "/novels",
        search: { page: novels.page === 1 ? undefined : novels.page },
        replace: true,
      });
    }
    return {
      title: m.novels_title(),
      description: m.novels_description(),
      canonicalHref: buildCanonicalUrl(domain, "/novels", {
        page: novels.page === 1 ? undefined : String(novels.page),
      }),
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
  component: NovelsRoute,
});

function NovelsRoute() {
  const { page = 1 } = Route.useSearch();
  const { data } = useSuspenseQuery(novelsPageQuery(page));
  return (
    <NovelsPage
      items={data.items}
      page={data.page}
      totalPages={data.totalPages}
    />
  );
}
