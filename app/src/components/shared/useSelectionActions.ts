import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useSettingsStore } from "@/store/settingsStore";
import { findBestProvider } from "@/providers/select";
import { fetchBasicInfo } from "@/lib/basicInfo";
import { canAddAsWord, cleanWord } from "./selectionAskHelpers";

/** The "keep it" half of the selection toolbar: add a word to the vocabulary,
 *  or save a sentence to the pattern library.
 *
 *  Shared because two surfaces offer these actions on the same terms — the
 *  floating toolbar over in-app text, and the Browser page's docked pane,
 *  where the text was pulled across from a native child webview. Keeping the
 *  dictionary lookup, the level tagging and the already-collected check in one
 *  place is what stops "save" from quietly meaning something different
 *  depending on which surface you were reading in.
 *
 *  `text` is the current selection (or draft); `source` is the attribution
 *  recorded on whatever gets saved. */
export function useSelectionActions(text: string, source: string) {
  const t = useT();
  const db = useDB();
  const targetLevel = useSettingsStore((s) => s.targetLevels.join("/"));
  const [collected, setCollected] = useState(false);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);

  const word = canAddAsWord(text) ? cleanWord(text) : "";

  // One local SQLite query per selection, so the toolbar can say "in vocab"
  // rather than offer to add a word that is already there.
  useEffect(() => {
    setCollected(false);
    if (!word) return;
    let cancelled = false;
    void db.getWords({ search: word }).then((rows) => {
      if (!cancelled) setCollected(rows.some((w) => w.word.toLowerCase() === word.toLowerCase()));
    });
    return () => { cancelled = true; };
  }, [word, db]);

  /** Adds the selected word with a real gloss/type/level behind it. The
   *  dictionary call happens on click rather than on every selection — one
   *  API request per word you actually keep, not per word you glance at. */
  const addWord = async () => {
    if (!word || adding || collected) return;
    setAdding(true);
    try {
      const provider = findBestProvider();
      const info = provider ? await fetchBasicInfo(provider, word, targetLevel) : {};
      const result = await db.addWord(word, info.zh ?? "", info.wordType, info.level);
      if (result.id > 0) {
        setCollected(true);
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        toast.success(t("sel.added", { word }));
      }
    } finally {
      setAdding(false);
    }
  };

  /** Resolves true once the sentence is in the library, so callers can dismiss
   *  their own UI — the floating toolbar closes, the docked pane stays open.
   *
   *  Saves the raw sentence immediately, with no AI call in the way — "save"
   *  needs to be instant while you're mid-read, not gated on a round trip you
   *  didn't ask for. The zh/note/level fields start empty; the sentence
   *  library's own "reanalyze" action (SentenceList) fills them in whenever
   *  you actually sit down to go through what you collected. */
  const savePattern = async (sentence: string): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = await db.saveSentence(sentence, "", "", "", source);
      if (saved) {
        toast.success(saved.created ? t("sel.saved") : t("sel.alreadySaved"));
        return true;
      }
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { word, collected, adding, saving, addWord, savePattern };
}
