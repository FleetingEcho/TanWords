/** Vocabulary, translations, settings, and documents — see useDB.ts for the
 *  composed public hook, useDB.extra.ts for chat/reading/SRS/data-management. */

import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";
import {
  WordListItem, WordDetail, TranslationItem, EnrichmentInput,
  DocumentDetail, DocumentListResult,
} from "./useDB.types";

export function useDBCore() {
  const getWordCount = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_get_word_count");
    } catch (e) {
      logError("getWordCount", e);
      return 0;
    }
  }, []);

  const getTranslationCount = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_get_translation_count");
    } catch (e) {
      logError("getTranslationCount", e);
      return 0;
    }
  }, []);

  const getReviewCount = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_get_review_count");
    } catch (e) {
      logError("getReviewCount", e);
      return 0;
    }
  }, []);

  const getWords = useCallback(
    async (opts?: {
      search?: string;
      levelFilter?: string;
      sortBy?: string;
    }): Promise<WordListItem[]> => {
      try {
        return await invoke<WordListItem[]>("db_get_words", {
          search: opts?.search || null,
          levelFilter: opts?.levelFilter || null,
          sortBy: opts?.sortBy || null,
        });
      } catch (e) {
        logError("getWords", e);
        return [];
      }
    },
    []
  );

  const getWordDetail = useCallback(
    async (wordId: number): Promise<WordDetail | null> => {
      try {
        return await invoke<WordDetail>("db_get_word_detail", {
          wordId,
        });
      } catch (e) {
        logError("getWordDetail", e);
        return null;
      }
    },
    []
  );

  const getWordDetailByWord = useCallback(
    async (word: string): Promise<WordDetail | null> => {
      // Find word by name, then get full detail
      const words = await getWords({ search: word });
      const match = words.find((w) => w.word.toLowerCase() === word.toLowerCase());
      if (match) {
        return getWordDetail(match.id);
      }
      return null;
    },
    []
  );

  const addWord = useCallback(
    async (
      word: string,
      zh: string,
      wordType?: string,
      level?: string
    ): Promise<{ id: number; isNew: boolean }> => {
      try {
        return await invoke<{ id: number; isNew: boolean }>("db_add_word", {
          word,
          zh,
          wordType: wordType || null,
          level: level || null,
        });
      } catch (e) {
        reportWriteError("addWord", e, `保存单词 "${word}" 失败`);
        return { id: 0, isNew: false };
      }
    },
    []
  );

  const deleteWord = useCallback(async (wordId: number): Promise<void> => {
    try {
      await invoke("db_delete_word", { wordId });
    } catch (e) {
      reportWriteError("deleteWord", e, "删除单词失败");
    }
  }, []);

  const saveTranslation = useCallback(
    async (opts: {
      sourceText: string;
      resultText: string;
      sourceLang?: string;
      targetLang: string;
      provider: string;
      mode: string;
    }): Promise<number> => {
      try {
        return await invoke<number>("db_save_translation", {
          sourceText: opts.sourceText,
          resultText: opts.resultText,
          sourceLang: opts.sourceLang || "auto",
          targetLang: opts.targetLang,
          provider: opts.provider,
          mode: opts.mode,
        });
      } catch (e) {
        reportWriteError("saveTranslation", e, "保存翻译记录失败");
        return 0;
      }
    },
    []
  );

  const getTranslations = useCallback(
    async (opts?: {
      search?: string;
      cluster?: string;
    }): Promise<TranslationItem[]> => {
      try {
        return await invoke<TranslationItem[]>("db_get_translations", {
          search: opts?.search || null,
          cluster: opts?.cluster || null,
        });
      } catch (e) {
        logError("getTranslations", e);
        return [];
      }
    },
    []
  );

  const addWordEnriched = useCallback(
    async (word: string, zh: string, wordType: string | null, enrichment: EnrichmentInput): Promise<{ id: number; isNew: boolean }> => {
      try {
        return await invoke<{ id: number; isNew: boolean }>("db_add_word_enriched", { word, zh, wordType, enrichment });
      } catch (e) {
        reportWriteError("addWordEnriched", e, `保存单词 "${word}" 失败`);
        return { id: 0, isNew: false };
      }
    },
    []
  );

  const getWordExtras = useCallback(
    async (wordId: number): Promise<{ notes: string; messages: string }> => {
      try {
        return await invoke<{ notes: string; messages: string }>("db_get_word_extras", { wordId });
      } catch (e) {
        logError("getWordExtras", e);
        return { notes: "", messages: "[]" };
      }
    },
    []
  );

  const saveWordNotes = useCallback(
    async (wordId: number, notes: string): Promise<void> => {
      try {
        await invoke("db_save_word_notes", { wordId, notes });
      } catch (e) {
        reportWriteError("saveWordNotes", e, "保存笔记失败");
      }
    },
    []
  );

  const saveWordChat = useCallback(
    async (wordId: number, messages: string): Promise<void> => {
      try {
        await invoke("db_save_word_chat", { wordId, messages });
      } catch (e) {
        logError("saveWordChat", e);
      }
    },
    []
  );

  const getSetting = useCallback(
    async (key: string): Promise<string | null> => {
      try {
        return await invoke<string | null>("db_get_setting", { key });
      } catch (e) {
        logError("getSetting", e);
        return null;
      }
    },
    []
  );

  const setSetting = useCallback(async (key: string, value: string) => {
    try {
      await invoke("db_set_setting", { key, value });
    } catch (e) {
      reportWriteError("setSetting", e, "保存设置失败");
    }
  }, []);

  const createDocument = useCallback(async (): Promise<number> => {
    try {
      return await invoke<number>("db_create_document");
    } catch (e) {
      reportWriteError("createDocument", e, "创建文档失败");
      return 0;
    }
  }, []);

  const getDocuments = useCallback(async (opts?: {
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    tag?: string;
    sort?: string;
    page?: number;
  }): Promise<DocumentListResult> => {
    try {
      return await invoke<DocumentListResult>("db_get_documents", {
        search: opts?.search || null,
        dateFrom: opts?.dateFrom || null,
        dateTo: opts?.dateTo || null,
        tag: opts?.tag || null,
        sort: opts?.sort || null,
        page: opts?.page ?? 0,
      });
    } catch (e) {
      logError("getDocuments", e);
      return { items: [], total: 0 };
    }
  }, []);

  const getDocument = useCallback(async (id: number): Promise<DocumentDetail | null> => {
    try {
      return await invoke<DocumentDetail>("db_get_document", { id });
    } catch (e) {
      logError("getDocument", e);
      return null;
    }
  }, []);

  const updateDocument = useCallback(async (
    id: number,
    title: string,
    content: string,
    contentText: string,
    tags: string,
    pinned: boolean,
    wordCount: number,
  ): Promise<void> => {
    try {
      await invoke("db_update_document", { id, title, content, contentText, tags, pinned, wordCount });
    } catch (e) {
      reportWriteError("updateDocument", e, "保存文档失败");
    }
  }, []);

  const deleteDocument = useCallback(async (id: number): Promise<void> => {
    try {
      await invoke("db_delete_document", { id });
    } catch (e) {
      reportWriteError("deleteDocument", e, "删除文档失败");
    }
  }, []);

  const duplicateDocument = useCallback(async (id: number): Promise<number> => {
    try {
      return await invoke<number>("db_duplicate_document", { id });
    } catch (e) {
      reportWriteError("duplicateDocument", e, "复制文档失败");
      return 0;
    }
  }, []);

  const getAllTags = useCallback(async (): Promise<string[]> => {
    try {
      return await invoke<string[]>("db_get_all_tags");
    } catch (e) {
      logError("getAllTags", e);
      return [];
    }
  }, []);

  const addWordsBatch = useCallback(
    async (
      words: { word: string; zh: string; word_type?: string; level?: string; context?: string }[],
      source = "batch",
      tag?: string
    ): Promise<{ added: number; skipped: number }> => {
      try {
        return await invoke<{ added: number; skipped: number }>("db_add_words_batch", { words, source, tag: tag ?? null });
      } catch (e) {
        reportWriteError("addWordsBatch", e, "批量保存单词失败");
        return { added: 0, skipped: 0 };
      }
    },
    []
  );

  return useMemo(() => ({
    getWordCount, getTranslationCount, getReviewCount,
    getWords, getWordDetail, getWordDetailByWord,
    addWord, deleteWord,
    saveTranslation, getTranslations,
    addWordEnriched, getWordExtras,
    saveWordNotes, saveWordChat,
    getSetting, setSetting,
    createDocument, getDocuments, getDocument,
    updateDocument, deleteDocument, duplicateDocument,
    getAllTags, addWordsBatch,
  }), [
    getWordCount, getTranslationCount, getReviewCount,
    getWords, getWordDetail, getWordDetailByWord,
    addWord, deleteWord,
    saveTranslation, getTranslations,
    addWordEnriched, getWordExtras,
    saveWordNotes, saveWordChat,
    getSetting, setSetting,
    createDocument, getDocuments, getDocument,
    updateDocument, deleteDocument, duplicateDocument,
    getAllTags, addWordsBatch,
  ]);
}
