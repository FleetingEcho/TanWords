import { useEffect, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import type { DocEditorApi } from "./tiptap/DocEditorApi";

export function DocumentUndoRedoControls({ editor }: { editor: DocEditorApi | null }) {
  const t = useT();
  const [availability, setAvailability] = useState({ undo: false, redo: false });

  useEffect(() => {
    if (!editor) {
      setAvailability({ undo: false, redo: false });
      return;
    }
    const update = () => {
      setAvailability((current) => {
        const next = { undo: editor.canUndo(), redo: editor.canRedo() };
        return current.undo === next.undo && current.redo === next.redo ? current : next;
      });
    };
    update();
    return editor.onHistoryChange(update);
  }, [editor]);

  return (
    <div className="mr-1 flex items-center gap-0.5 border-r border-border/70 pr-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!availability.undo}
        onClick={() => editor?.undo()}
        title={t("doc.undo")}
        aria-label={t("doc.undo")}
        className="h-8 w-8 text-muted-foreground"
      >
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!availability.redo}
        onClick={() => editor?.redo()}
        title={t("doc.redo")}
        aria-label={t("doc.redo")}
        className="h-8 w-8 text-muted-foreground"
      >
        <Redo2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
