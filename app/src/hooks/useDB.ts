/**
 * Database operations hook.
 *
 * Implementation is split across useDB.core.ts (vocabulary/translations/
 * settings/documents) and useDB.extra.ts (chat/reading/dashboard/SRS/search
 * history/data management) to stay under the per-file line-count ceiling —
 * this file just composes them into the single `useDB()` API every caller
 * already uses, so no call site needs to change.
 */

import { useMemo } from "react";
import { useDBCore } from "./useDB.core";
import { useDBExtra } from "./useDB.extra";
import { useDBSceneLab } from "./useDB.sceneLab";
import { useDBKnowledgeMap } from "./useDB.knowledgeMap";

export * from "./useDB.types";

export function useDB() {
  const core = useDBCore();
  const extra = useDBExtra();
  const sceneLab = useDBSceneLab();
  const knowledgeMap = useDBKnowledgeMap();

  return useMemo(() => ({ ...core, ...extra, ...sceneLab, ...knowledgeMap }), [core, extra, sceneLab, knowledgeMap]);
}
