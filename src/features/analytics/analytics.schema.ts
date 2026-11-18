import { z } from "zod";

const count = z.number().int().nonnegative();

export const AnalyticsInputSchema = z.strictObject({
  /** The trailing window, in days. */
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
});

export const AnalyticsDeviceSchema = z.enum(["desktop", "mobile", "tablet"]);

const AnalyticsDailyViewsSchema = z.object({
  /** UTC midnight of the day, in milliseconds. */
  day: count,
  views: count,
});

const AnalyticsPageSchema = z.object({
  path: z.string(),
  views: count,
});

const AnalyticsPostSchema = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  slug: z.string(),
  views: count,
});

const AnalyticsReferrerSchema = z.object({
  host: z.string(),
  views: count,
});

const AnalyticsCountrySchema = z.object({
  /** ISO 3166-1 alpha-2, as Cloudflare reports it. */
  country: z.string(),
  views: count,
});

const AnalyticsRegionSchema = z.object({
  country: z.string(),
  region: z.string(),
  views: count,
});

const AnalyticsCitySchema = z.object({
  country: z.string(),
  region: z.string().nullable(),
  city: z.string(),
  views: count,
});

const AnalyticsDeviceCountSchema = z.object({
  device: AnalyticsDeviceSchema,
  views: count,
});

export const AnalyticsReportSchema = z.object({
  rangeDays: z.number().int().positive(),
  generatedAt: count,
  summary: z.object({
    views: count,
    /** Distinct visitors in the window: accounts and anonymous cookies. */
    visitors: count,
  }),
  /** One entry per UTC day of the window, oldest first, zero-filled. */
  daily: z.array(AnalyticsDailyViewsSchema),
  topPages: z.array(AnalyticsPageSchema),
  topPosts: z.array(AnalyticsPostSchema),
  referrers: z.array(AnalyticsReferrerSchema),
  countries: z.array(AnalyticsCountrySchema),
  regions: z.array(AnalyticsRegionSchema),
  cities: z.array(AnalyticsCitySchema),
  devices: z.array(AnalyticsDeviceCountSchema),
});

export type AnalyticsInput = z.infer<typeof AnalyticsInputSchema>;
export type AnalyticsReport = z.infer<typeof AnalyticsReportSchema>;
export type AnalyticsDevice = z.infer<typeof AnalyticsDeviceSchema>;
