import {
  AnalyticsInputSchema,
  AnalyticsReportSchema,
} from "@/features/analytics/analytics.schema";
import { getAnalyticsReport } from "@/features/analytics/service/analytics.service";
import { adminProcedure } from "@/lib/orpc/procedure";

const report = adminProcedure
  .route({
    method: "GET",
    path: "/admin/analytics",
    summary: "Get the site's own page views",
    description:
      "Page views recorded by this Worker: totals, a daily series, and the top pages, Posts, referrers, places and devices of the window.",
    tags: ["Admin Analytics"],
  })
  .input(AnalyticsInputSchema)
  .output(AnalyticsReportSchema)
  .handler(({ context, input }) => getAnalyticsReport(context, input));

export default { report };
