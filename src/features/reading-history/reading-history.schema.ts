import { z } from "zod";
import { coercedDate } from "@/lib/orpc/dates";

export const ReadingHistorySchema = z.object({
  summary: z.object({
    posts: z.number().int(),
    novels: z.number().int(),
    seconds: z.number().int(),
  }),
  posts: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      slug: z.string(),
      lastReadAt: coercedDate,
    }),
  ),
  novels: z.array(
    z.object({
      id: z.number().int(),
      title: z.string(),
      slug: z.string(),
      author: z.string(),
      chapterOrder: z.number().int(),
      chapterCount: z.number().int(),
      lastReadAt: coercedDate,
    }),
  ),
});

export type ReadingHistory = z.infer<typeof ReadingHistorySchema>;
