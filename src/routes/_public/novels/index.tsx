import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { siteDomainQuery } from "@/features/config/queries";
import { NovelsPage } from "@/features/novels/components/novels-page";
import { novelsPageQuery, shelfTagsQuery } from "@/features/novels/queries";
import { CACHE_CONTROL } from "@/lib/constants";
import { novelsSearchSchema } from "@/lib/public-search";
import { buildCanonicalUrl, canonicalLink } from "@/lib/seo";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/_public/novels/")({
  validateSearch: novelsSearchSchema,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, tag: search.tag }),
  loader: async ({ context, deps }) => {
    const [novels, tags, domain] = await Promise.all([
      context.queryClient.ensureQueryData(novelsPageQuery(deps.page, deps.tag)),
      context.queryClient.ensureQueryData(shelfTagsQuery),
      context.queryClient.ensureQueryData(siteDomainQuery),
    ]);
    if (novels.page !== deps.page) {
      throw redirect({
        to: "/novels",
        search: {
          page: novels.page === 1 ? undefined : novels.page,
          tag: deps.tag,
        },
        replace: true,
      });
    }
    return {
      title: m.novels_title(),
      description: m.novels_description(),
      tags,
      canonicalHref: buildCanonicalUrl(domain, "/novels", {
        page: novels.page === 1 ? undefined : String(novels.page),
        tag: deps.tag,
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
  const { page = 1, tag } = Route.useSearch();
  const { data } = useSuspenseQuery(novelsPageQuery(page, tag));
  return (
    <NovelsPage
      items={data.items}
      page={data.page}
      totalPages={data.totalPages}
      tags={Route.useLoaderData().tags}
      activeTag={tag}
    />
  );
}
