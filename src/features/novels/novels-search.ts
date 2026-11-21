import { z } from "zod";

/** `?chapter=` of the reader: the chapter to open, from 1. */
export const novelReaderSearchSchema = z.object({
  chapter: z.catch(
    z.optional(z.coerce.number().int().min(1).max(1_000_000)),
    undefined,
  ),
});
