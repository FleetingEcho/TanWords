import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB, SavedSentence } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

/** Global browse view for every sentence saved from any lesson — the
 * counterpart to the Vocabulary page, but for hand-picked sentences instead
 * of words. */
export function SavedSentencesView() {
  const db = useDB();
  const t = useT();
  const [sentences, setSentences] = useState<SavedSentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    db.getSavedSentences().then(setSentences).finally(() => setLoading(false));
  }, [db]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (id: number) => {
    setConfirmDeleteId(null);
    await db.deleteSavedSentence(id);
    toast.success(t("reading.savedSentences.deleted"));
    load();
  };

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <span className="text-xs text-muted-foreground animate-pulse">…</span>
      </div>
    );
  }

  if (sentences.length === 0) {
    return (
      <div className="bg-card border border-border rounded-2xl py-12 text-center text-xs text-muted-foreground px-8 leading-relaxed">
        {t("reading.savedSentences.empty")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sentences.map((s) => (
        <div key={s.id} className="group/saved bg-card border border-border rounded-2xl p-4 space-y-1.5">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm font-serif italic leading-relaxed">“{s.text}”</p>
            <SpeakButton text={s.text} className="w-3.5 h-3.5 mt-1 shrink-0" />
            <Button
              variant="ghost"
              onClick={() => setConfirmDeleteId(s.id)}
              className="h-auto p-1 shrink-0 text-muted-foreground/50 opacity-0 group-hover/saved:opacity-100 hover:text-destructive transition-all"
            >
              <TrashIcon className="w-3.5 h-3.5" />
            </Button>
          </div>
          {s.zh && <p className="text-xs text-muted-foreground">{s.zh}</p>}
          {s.note && <p className="text-xs text-muted-foreground/80">{s.note}</p>}
          <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground/60">
            {s.article_title && <span className="truncate">{s.article_title}</span>}
            <span className="ml-auto shrink-0 font-mono">{s.created_at.slice(0, 10)}</span>
          </div>
        </div>
      ))}

      <ConfirmModal
        open={confirmDeleteId !== null}
        title={t("reading.savedSentences.deleteConfirmTitle")}
        message={t("reading.savedSentences.deleteConfirmMessage")}
        confirmLabel={t("reading.savedSentences.delete")}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => confirmDeleteId !== null && handleDelete(confirmDeleteId)}
      />
    </div>
  );
}
