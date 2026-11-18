import { orpc } from "@/lib/orpc";

export type AnalyticsDays = 7 | 30 | 90;

export const analyticsQuery = (days: AnalyticsDays) =>
  orpc.analytics.report.queryOptions({ input: { days } });
