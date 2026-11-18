import { analyticsSince, utcDayStart } from "@/features/analytics/analytics";
import {
  AnalyticsReportSchema,
  type AnalyticsInput,
  type AnalyticsReport,
} from "@/features/analytics/analytics.schema";
import { readAnalyticsReport } from "@/features/analytics/data/analytics.data";

const DAY_MS = 24 * 60 * 60 * 1000;

/** One point per UTC day of the window, the days without views at 0. */
function fillDays(
  daily: Array<{ day: number; views: number }>,
  since: number,
  until: number,
) {
  const viewsByDay = new Map(daily.map((point) => [point.day, point.views]));
  const points: Array<{ day: number; views: number }> = [];
  for (let day = utcDayStart(since); day <= utcDayStart(until); day += DAY_MS) {
    points.push({ day, views: viewsByDay.get(day) ?? 0 });
  }
  return points;
}

export async function getAnalyticsReport(
  context: DbContext,
  input: AnalyticsInput,
): Promise<AnalyticsReport> {
  const now = Date.now();
  const since = analyticsSince(input.days, now).getTime();
  // Rows are stamped to the second, so the window's exclusive end is the next
  // second: a view recorded during the current one still belongs to it.
  const until = Math.floor(now / 1000) * 1000 + 1000;
  const report = await readAnalyticsReport(
    context.db,
    { since: new Date(since), until: new Date(until) },
    input.days,
    now,
  );

  return AnalyticsReportSchema.parse({
    ...report,
    daily: fillDays(report.daily, since, until),
  });
}
