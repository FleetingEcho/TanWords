/** AI Chat sessions, article-analysis persistence, dashboard, SRS review,
 *  search history, RSS, and data management — see useDB.ts for the composed
 *  public hook. This file composes the domain sub-hooks (useDBChat,
 *  useDBReview, useDBRss, useDBData) to stay under the per-file line-count
 *  ceiling; useDB.core.ts covers vocabulary/translations/settings/documents. */

import { useMemo } from "react";
import { useDBChat } from "./useDBChat";
import { useDBReview } from "./useDBReview";
import { useDBRss } from "./useDBRss";
import { useDBData } from "./useDBData";

export function useDBExtra() {
  const chat = useDBChat();
  const review = useDBReview();
  const rss = useDBRss();
  const data = useDBData();
  return useMemo(() => ({ ...chat, ...review, ...rss, ...data }), [chat, review, rss, data]);
}
