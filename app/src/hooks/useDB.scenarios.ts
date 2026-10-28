import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";

/** A scenario — one communicative situation (ordering coffee, airport
 *  check-in) with its registry row and per-scene stats. The stable external
 *  id is `scenario_key` ("dining.cafe"); the integer `id` is internal only. */
export interface ScenarioSummary {
  id: number;
  scenario_key: string;
  name_en: string;
  name_zh: string;
  domain: string;
  icon: string;
  description: string;
  origin: string;
  archived: boolean;
  sort_order: number;
  word_count: number;
  unmastered_count: number;
  line_count: number;
}

export interface ScenarioList {
  scenarios: ScenarioSummary[];
  untagged_words: number;
}

export interface ScenarioLineItem {
  id: number;
  intent_key: string;
  role: "them" | "me";
  text_en: string;
  text_zh: string;
  note: string;
  importance: number;
  sentence_id: number | null;
  sort_order: number;
}

export interface ScenarioWordItem {
  word_id: number;
  word: string;
  status: string;
  starred: boolean;
  source: string;
  confidence: number;
  scenario_key: string;
  scenario_id: number;
}

export interface ScenarioDetail {
  id: number;
  scenario_key: string;
  name_en: string;
  name_zh: string;
  domain: string;
  icon: string;
  description: string;
  origin: string;
  lines: ScenarioLineItem[];
  words: ScenarioWordItem[];
}

export interface ScenarioLineInput {
  intent_key: string;
  role: "them" | "me";
  text_en: string;
  text_zh: string;
  note: string;
  importance: number;
  sort_order: number;
}

export interface SaveScenarioPackInput {
  scenario_key: string;
  name_en: string;
  name_zh: string;
  domain: string;
  icon: string;
  description: string;
  generation_key?: string | null;
  replace_lines: boolean;
  lines: ScenarioLineInput[];
  suggested_words: string[];
}

export interface SaveScenarioPackResult {
  scenario_id: number;
  lines_saved: number;
  words_linked: number;
  duplicate: boolean;
}

export interface ReviewQueueItem {
  word_id: number;
  word: string;
  scenario_key: string;
  scenario_name_en: string;
  source: string;
  confidence: number;
}

/** Scenario commands — the Scenes page, the Words filter's scene axis, and
 *  the word detail panel's chips row. Mirrors db/scenarios.rs one-to-one. */
export function useDBScenarios() {
  const listScenarios = useCallback(async (): Promise<ScenarioList | null> => {
    try { return await invoke<ScenarioList>("db_list_scenarios", {}); }
    catch (e) { logError("listScenarios", e); return null; }
  }, []);

  const getScenarioDetail = useCallback(async (scenarioKey: string): Promise<ScenarioDetail | null> => {
    try { return await invoke<ScenarioDetail | null>("db_get_scenario_detail", { scenarioKey }); }
    catch (e) { logError("getScenarioDetail", e); return null; }
  }, []);

  const saveScenarioPack = useCallback(async (input: SaveScenarioPackInput): Promise<SaveScenarioPackResult | null> => {
    try { return await invoke<SaveScenarioPackResult>("db_save_scenario_pack", { input }); }
    catch (e) { reportWriteError("saveScenarioPack", e, "保存场景包失败"); return null; }
  }, []);

  const setWordScenarios = useCallback(async (wordId: number, scenarioKeys: string[]): Promise<boolean> => {
    try { await invoke("db_set_word_scenarios", { wordId, scenarioKeys }); return true; }
    catch (e) { reportWriteError("setWordScenarios", e, "保存场景关联失败"); return false; }
  }, []);

  const getWordScenarios = useCallback(async (wordId: number): Promise<ScenarioWordItem[]> => {
    try { return await invoke<ScenarioWordItem[]>("db_get_word_scenarios", { wordId }); }
    catch (e) { logError("getWordScenarios", e); return []; }
  }, []);

  const promoteScenarioLine = useCallback(async (lineId: number): Promise<number | null> => {
    try { return await invoke<number>("db_promote_scenario_line", { lineId }); }
    catch (e) { reportWriteError("promoteScenarioLine", e, "收藏句子失败"); return null; }
  }, []);

  const proposeScenario = useCallback(async (
    scenarioKey: string, nameEn: string, nameZh: string, domain: string, accept?: boolean
  ): Promise<number | null> => {
    try { return await invoke<number>("db_propose_scenario", { scenarioKey, nameEn, nameZh, domain, accept: accept ?? null }); }
    catch (e) { reportWriteError("proposeScenario", e, "创建场景失败"); return null; }
  }, []);

  const listScenarioReviewQueue = useCallback(async (limit: number): Promise<ReviewQueueItem[]> => {
    try { return await invoke<ReviewQueueItem[]>("db_list_scenario_review_queue", { limit }); }
    catch (e) { logError("listScenarioReviewQueue", e); return []; }
  }, []);

  const rejectWordScenario = useCallback(async (wordId: number, scenarioId: number): Promise<boolean> => {
    try { await invoke("db_reject_word_scenario", { wordId, scenarioId }); return true; }
    catch (e) { reportWriteError("rejectWordScenario", e, "移除场景关联失败"); return false; }
  }, []);

  const linkWordsToScenario = useCallback(async (scenarioKey: string, wordIds: number[]): Promise<number | null> => {
    try { return await invoke<number>("db_link_words_to_scenario", { scenarioKey, wordIds }); }
    catch (e) { reportWriteError("linkWordsToScenario", e, "关联场景失败"); return null; }
  }, []);

  const listWordScenarioCounts = useCallback(async (): Promise<ScenarioSummary[]> => {
    try { return await invoke<ScenarioSummary[]>("db_list_word_scenario_counts", {}); }
    catch (e) { logError("listWordScenarioCounts", e); return []; }
  }, []);

  return useMemo(() => ({
    listScenarios, getScenarioDetail, saveScenarioPack, setWordScenarios, getWordScenarios,
    promoteScenarioLine, proposeScenario, listScenarioReviewQueue, rejectWordScenario,
    listWordScenarioCounts, linkWordsToScenario,
  }), [
    listScenarios, getScenarioDetail, saveScenarioPack, setWordScenarios, getWordScenarios,
    promoteScenarioLine, proposeScenario, listScenarioReviewQueue, rejectWordScenario,
    listWordScenarioCounts, linkWordsToScenario,
  ]);
}
