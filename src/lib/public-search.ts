import { z } from "zod/mini";
import { MAX_PAGE_NUMBER } from "@/lib/constants";

// Search schemas are validated with `zod/mini`, so the classic API stays out
// of the first load of every page (`CODING_STANDARDS.md`).

/** `?page=` of the Home and Moments lists; one that names no page is no filter. */
export const pageSearchSchema = z.object({
  page: z.catch(
    z.optional(
      z.coerce
        .number()
        .check(z.int(), z.minimum(1), z.maximum(MAX_PAGE_NUMBER)),
    ),
    undefined,
  ),
});

/** `?comment=` of a Post or Moment page: the Comment to scroll to. */
export const commentSearchSchema = z.object({
  comment: z.optional(z.coerce.number()),
});

/** `?page=` and `?tag=` of the shelf; a tag that names nothing is no filter. */
export const novelsSearchSchema = z.object({
  page: z.catch(
    z.optional(
      z.coerce
        .number()
        .check(z.int(), z.minimum(1), z.maximum(MAX_PAGE_NUMBER)),
    ),
    undefined,
  ),
  tag: z.catch(z.optional(z.string().check(z.maxLength(80))), undefined),
});
