import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsPage } from "@/features/analytics/components/analytics-page";
import { analyticsQuery } from "@/features/analytics/queries";
import { m } from "@/paraglide/messages";

export const Route = createFileRoute("/admin/analytics")({
  ssr: "data-only",
  component: AnalyticsPage,
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(analyticsQuery(30));
    return { title: m.admin_analytics_title() };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData?.title,
      },
    ],
  }),
});
