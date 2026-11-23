import { ReadingHistorySchema } from "@/features/reading-history/reading-history.schema";
import * as HistoryService from "@/features/reading-history/service/reading-history.service";
import { authProcedure } from "@/lib/orpc/procedure";

const reading = authProcedure
  .route({
    method: "GET",
    path: "/profile/reading",
    summary: "Read your reading history",
    description:
      "The articles and novels you have read, with how much time you spent reading.",
    tags: ["Profile"],
  })
  .output(ReadingHistorySchema)
  .handler(({ context }) => HistoryService.getReadingHistory(context));

export default { reading };
