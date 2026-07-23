import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB, SavedSentence } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { TrashIcon } from "@heroicons/react/24/outline";
import { Button } from "@/components/ui/button";

/** Manual "keep this sentence" box for the lesson sidebar: paste/type any
 * sentence worth keeping — from the article or the AI notes — plus an
 * optional translation/note, and save it. Also lists what's already been
 * saved from this article, since there's no per-item extraction to browse
 * anymore. Lives inside a popover (see LessonView) so it doesn't take
 * permanent space away from the AI notes panel. */
export function SaveSentenceBox({ articleId, articleTitle }: { articleId: number; articleTitle: string }) {
  const db = useDB();
  const t = useT();

  const [text, setText] = useState("");
  const [zh, setZh] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedSentence[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const all = await db.getSavedSentences();
    setSaved(all.filter((s) => s.article_id === articleId));
  }, [db, articleId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    const trimmed = text.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await db.addSavedSentence(trimmed, zh.trim(), note.trim(), articleId, articleTitle);
      toast.success(t("reading.saveSentence.saved"));
      setText("");
      setZh("");
      setNote("");
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    setConfirmDeleteId(null);
    await db.deleteSavedSentence(id);
    toast.success(t("reading.savedSentences.deleted"));
    load();
  };

  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold">{t("reading.saveSentence.title")}</span>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("reading.saveSentence.textPlaceholder")}
        rows={2}
        className="w-full p-2 text-xs rounded-lg border border-input bg-background leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
      />
      <input
        value={zh}
        onChange={(e) => setZh(e.target.value)}
        placeholder={t("reading.saveSentence.zhPlaceholder")}
        className="w-full h-8 px-2.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("reading.saveSentence.notePlaceholder")}
        className="w-full h-8 px-2.5 rounded-lg border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground"
      />
      <Button
        onClick={handleSave}
        disabled={saving || !text.trim()}
        className="h-8 px-3 w-full rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {saving ? t("reading.saveSentence.saving") : t("reading.saveSentence.save")}
      </Button>

      {saved.length > 0 && (
        <div className="pt-1 space-y-1.5 max-h-64 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t("reading.saveSentence.fromThisArticle")}
          </p>
          <div className="space-y-1.5">
            {saved.map((s) => (
              <div key={s.id} className="group/saved rounded-lg bg-muted/40 px-2.5 py-2 space-y-0.5">
                <div className="flex items-start gap-1">
                  <p className="flex-1 text-[13px] font-serif italic leading-relaxed">“{s.text}”</p>
                  <SpeakButton text={s.text} className="w-3 h-3 mt-1 shrink-0" />
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmDeleteId(s.id)}
                    className="h-auto p-0.5 shrink-0 text-muted-foreground/50 opacity-0 group-hover/saved:opacity-100 hover:text-destructive transition-all"
                  >
                    <TrashIcon className="w-3 h-3" />
                  </Button>
                </div>
                {s.zh && <p className="text-xs text-muted-foreground">{s.zh}</p>}
                {s.note && <p className="text-xs text-muted-foreground/80">{s.note}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

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
