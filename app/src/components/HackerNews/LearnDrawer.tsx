import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { useDB } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { HNStory, storyDomain, hnItemUrl } from "@/hooks/useHackerNews";
import { useReadingStore } from "@/store/readingStore";
import { useNavStore } from "@/store/navStore";
import { textToBlocks } from "@/lib/docFormat";
import { Drawer, DrawerCloseButton } from "@/components/ui/Drawer";

interface Props {
  story: HNStory | null;
  /** Pre-fill from a Reader-extracted article, skipping the manual copy/paste step. */
  initialText?: string;
  onClose: () => void;
  onSaved: (storyId: number, docId: number) => void;
  onOpenArticle: (story: HNStory) => void;
}

export function LearnDrawer({ story, initialText, onClose, onSaved, onOpenArticle }: Props) {
  const db = useDB();
  const t = useT();
  const setDraft = useReadingStore((s) => s.setDraft);
  const navigate = useNavStore((s) => s.navigate);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(initialText || "");
    setSaving(false);
  }, [story?.id]);

  if (!story) return null;

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sourceUrl = story.url || hnItemUrl(story.id);

  const handleSave = async () => {
    if (saving || !text.trim()) return;
    setSaving(true);
    try {
      const body = `Source: ${sourceUrl}\n\n${text.trim()}`;
      const id = await db.createDocument();
      await db.updateDocument(
        id,
        story.title,
        JSON.stringify(textToBlocks(body)),
        body,
        JSON.stringify(["hackernews"]),
        false,
        wordCount
      );
      toast.success(t("hn.toast.saved"));
      onSaved(story.id, id);
      onClose();
    } catch {
      toast.error(t("hn.toast.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onClose={onClose} width={560} panelClassName="flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 h-14 border-b border-border shrink-0">
          <span className="text-sm font-semibold text-foreground">{t("hn.drawer.title")}</span>
          <DrawerCloseButton onClose={onClose} />
        </div>

        {/* Story context */}
        <div className="px-6 py-4 border-b border-border shrink-0 space-y-1.5">
          <p className="text-sm font-semibold text-foreground leading-snug">{story.title}</p>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-muted-foreground bg-muted rounded px-1.5 py-0.5">
              {storyDomain(story)}
            </span>
            <button
              onClick={() => onOpenArticle(story)}
              className="text-xs font-medium text-primary hover:underline"
            >
              {t("hn.drawer.openArticle")}
            </button>
          </div>
          {!initialText && <p className="text-xs text-muted-foreground pt-1">{t("hn.drawer.hint")}</p>}
        </div>

        {/* Paste area */}
        <div className="flex-1 flex flex-col min-h-0 px-6 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("hn.drawer.placeholder")}
            autoFocus
            className="flex-1 w-full p-4 rounded-xl border border-input bg-card text-sm text-foreground leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-border flex items-center gap-3">
          <span className="text-[11px] font-mono tabular-nums text-muted-foreground w-20 shrink-0">
            {t("hn.drawer.words", { n: wordCount })}
          </span>
          <button
            onClick={handleSave}
            disabled={saving || !text.trim()}
            className="h-9 px-4 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          >
            {saving ? t("hn.drawer.saving") : t("hn.drawer.save")}
          </button>
          <button
            onClick={() => {
              if (!text.trim()) return;
              setDraft({
                title: story.title,
                text: text.trim(),
                sourceUrl: sourceUrl,
                origin: "hackernews",
              });
              onClose();
              navigate("reading");
            }}
            disabled={!text.trim()}
            className="flex-1 h-9 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            ✦ {t("hn.drawer.analyze")}
          </button>
        </div>
    </Drawer>
  );
}
