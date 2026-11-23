import { queryOptions } from "@tanstack/react-query";
import { orpcClient } from "@/lib/orpc";

export const readingHistoryQuery = queryOptions({
  queryKey: ["reading-history"],
  queryFn: ({ signal }) =>
    orpcClient.readingHistory.reading(undefined, { signal }),
});
