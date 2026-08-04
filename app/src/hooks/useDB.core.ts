/** Vocabulary, translations, settings, and documents — see useDB.ts for the
 *  composed public hook, useDB.extra.ts for chat/reading/SRS/data-management. */

import { useCallback, useMemo } from "react";
import { invoke } from "@/ipc/backend";
import { logError, reportWriteError } from "./useDB.errors";
import {
  WordListItem, WordDetail, TranslationItem, EnrichmentInput,
  DocumentDetail, DocumentListResult, DocumentFolder,
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
      /** Which timestamp the date range filters on — defaults to "created". */
      dateField?: "created" | "updated";
      dateFrom?: string;
      dateTo?: string;
    }): Promise<WordListItem[]> => {
      try {
        return await invoke<WordListItem[]>("db_get_words", {
          search: opts?.search || null,
          levelFilter: opts?.levelFilter || null,
          sortBy: opts?.sortBy || null,
          dateField: opts?.dateField || null,
          dateFrom: opts?.dateFrom || null,
          dateTo: opts?.dateTo || null,
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

  const deleteWordsBatch = useCallback(async (wordIds: number[]): Promise<boolean> => {
    try {
      await invoke("db_delete_words_batch", { wordIds });
      return true;
    } catch (e) {
      reportWriteError("deleteWordsBatch", e, "删除单词失败");
      return false;
    }
  }, []);

  const setWordStarred = useCallback(async (wordId: number, starred: boolean): Promise<boolean> => {
    try {
      await invoke("db_set_word_starred", { wordId, starred });
      return true;
    } catch (e) {
      reportWriteError("setWordStarred", e, "更新星标失败");
      return false;
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

  /** A setting whose value is a folder on *this* machine — see
   *  db/device_paths.rs. Kept apart from getSetting/setSetting because those
   *  rows sync, and a synced path points nowhere on the other two machines. */
  const getDevicePath = useCallback(async (key: string): Promise<string | null> => {
    try {
      return await invoke<string | null>("db_get_device_path", { key });
    } catch (e) {
      logError("getDevicePath", e);
      return null;
    }
  }, []);

  const setDevicePath = useCallback(async (key: string, value: string) => {
    try {
      await invoke("db_set_device_path", { key, value });
    } catch (e) {
      reportWriteError("setDevicePath", e, "保存路径失败");
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
      if (String(e).includes("DOCUMENT_LOCKED")) throw e;
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
  ): Promise<boolean> => {
    try {
      await invoke("db_update_document", { id, title, content, contentText, tags, pinned, wordCount });
      return true;
    } catch (e) {
      reportWriteError("updateDocument", e, "保存文档失败");
      return false;
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

  // ── Library folders ───────────────────────────────────────────────────────
  // Mirrors the local vault's directory tree; "" is the library root. See
  // db/documents/folders.rs for the path shape and why empty folders are
  // tracked in their own table.

  const createDocumentWithContent = useCallback(async (
    title: string,
    content: string,
    contentText: string,
    tags: string,
    wordCount: number,
    folder = "",
  ): Promise<number> =>
    invoke<number>("db_create_document_with_content", {
      title, content, contentText, tags, wordCount, folder,
    }), []);

  const listDocumentFolders = useCallback(async (): Promise<DocumentFolder[]> => {
    try {
      return await invoke<DocumentFolder[]>("db_list_document_folders");
    } catch (e) {
      logError("listDocumentFolders", e);
      return [];
    }
  }, []);

  /** Locks or unlocks a folder — see document_privacy/folder_lock.rs. Locking
   *  encrypts everything already in it and everything filed there later. */
  const setFolderLocked = useCallback((path: string, locked: boolean, password?: string): Promise<void> =>
    invoke("db_set_folder_locked", { path, locked, password: password ?? null }), []);

  const createDocumentFolder = useCallback((path: string): Promise<string> =>
    invoke<string>("db_create_document_folder", { path }), []);

  const renameDocumentFolder = useCallback((path: string, newPath: string): Promise<string> =>
    invoke<string>("db_rename_document_folder", { path, newPath }), []);

  const deleteDocumentFolder = useCallback((path: string): Promise<void> =>
    invoke("db_delete_document_folder", { path }), []);

  const setDocumentsFolder = useCallback((ids: number[], folder: string): Promise<void> =>
    invoke("db_set_documents_folder", { ids, folder }), []);

  const getAllTags = useCallback(async (): Promise<string[]> => {
    try {
      return await invoke<string[]>("db_get_all_tags");
    } catch (e) {
      logError("getAllTags", e);
      return [];
    }
  }, []);

  const protectDocument = useCallback((id: number, password?: string): Promise<void> =>
    invoke("db_protect_document", { id, password: password || null }), []);
  const unlockDocument = useCallback((id: number, password: string): Promise<void> =>
    invoke("db_unlock_document", { id, password }), []);
  const lockDocument = useCallback((id: number): Promise<void> =>
    invoke("db_lock_document", { id }), []);
  const removeDocumentProtection = useCallback((id: number, password: string): Promise<void> =>
    invoke("db_remove_document_protection", { id, password }), []);
  const changeDocumentPassword = useCallback((
    currentPassword: string, newPassword: string,
  ): Promise<void> => invoke("db_change_document_password", {
    currentPassword, newPassword,
  }), []);

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
    addWord, deleteWord, deleteWordsBatch, setWordStarred,
    saveTranslation, getTranslations,
    addWordEnriched, getWordExtras,
    saveWordNotes, saveWordChat,
    getSetting, setSetting, getDevicePath, setDevicePath,
    createDocument, createDocumentWithContent, getDocuments, getDocument,
    updateDocument, deleteDocument, duplicateDocument,
    listDocumentFolders, createDocumentFolder, renameDocumentFolder,
    deleteDocumentFolder, setDocumentsFolder, setFolderLocked,
    protectDocument, unlockDocument, lockDocument, removeDocumentProtection, changeDocumentPassword,
    getAllTags, addWordsBatch,
  }), [
    getWordCount, getTranslationCount, getReviewCount,
    getWords, getWordDetail, getWordDetailByWord,
    addWord, deleteWord, deleteWordsBatch, setWordStarred,
    saveTranslation, getTranslations,
    addWordEnriched, getWordExtras,
    saveWordNotes, saveWordChat,
    getSetting, setSetting, getDevicePath, setDevicePath,
    createDocument, createDocumentWithContent, getDocuments, getDocument,
    updateDocument, deleteDocument, duplicateDocument,
    listDocumentFolders, createDocumentFolder, renameDocumentFolder,
    deleteDocumentFolder, setDocumentsFolder, setFolderLocked,
    protectDocument, unlockDocument, lockDocument, removeDocumentProtection, changeDocumentPassword,
    getAllTags, addWordsBatch,
  ]);
}
