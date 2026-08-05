/**
 * Tiptap counterparts of `EditorAiButton` and `ImageOptionsButton`.
 *
 * The originals read their editor from BlockNote's `useBlockNoteEditor()`
 * context. Tiptap has no equivalent ambient context here, so the editor is
 * passed in — which also makes them testable without mounting a provider.
 * The Radix popover/select bodies are unchanged in spirit.
 */
import { useState } from "react";
import type { Editor } from "@tiptap/core";
import { ImageIcon, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { usePendingChatSelectionStore } from "@/store/pendingChatSelectionStore";

/** Sends the selection to AI Chat, prefilling it if Chat is already open. */
export function TiptapAiButton({ editor }: { editor: Editor }) {
  const t = useT();
  const { from, to } = editor.state.selection;
  const selectedText = from === to ? "" : editor.state.doc.textBetween(from, to, "\n");
  if (!selectedText.trim()) return null;

  const openInChat = () => {
    const text = selectedText.trim();
    usePendingChatSelectionStore.getState().setText(text);
    if (useNavStore.getState().currentPage() === "chat") {
      window.dispatchEvent(new CustomEvent("tanwords:ask-selection", { detail: { text } }));
    } else {
      useNavStore.getState().navigate("chat");
    }
  };

  return (
    <button
      type="button"
      title={t("doc.askAiSelection")}
      aria-label={t("doc.askAiSelection")}
      onMouseDown={(event) => { event.preventDefault(); openInChat(); }}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Sparkles className="h-3.5 w-3.5" />
    </button>
  );
}

const ALIGNMENTS = ["left", "center", "right"] as const;

/** Alt text, caption, width and alignment for the selected image. */
export function TiptapImageOptionsButton({ editor }: { editor: Editor }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!editor.isActive("image")) return null;

  const attrs = editor.getAttributes("image");
  const update = (patch: Record<string, unknown>) =>
    editor.chain().focus().updateAttributes("image", patch).run();

  const inputClass =
    "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-hidden focus:ring-1 focus:ring-primary/30";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("doc.imageOptions")}
          aria-label={t("doc.imageOptions")}
          onMouseDown={(event) => event.preventDefault()}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ImageIcon className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-60 space-y-2 p-3">
        <label className="block text-[11px] font-medium text-muted-foreground">
          {t("doc.imageAlt")}
          <input
            className={`mt-1 ${inputClass}`}
            value={(attrs.name as string) ?? ""}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          {t("doc.imageCaption")}
          <input
            className={`mt-1 ${inputClass}`}
            value={(attrs.caption as string) ?? ""}
            onChange={(event) => update({ caption: event.target.value })}
          />
        </label>
        <label className="block text-[11px] font-medium text-muted-foreground">
          {t("doc.imageWidth")}
          <input
            type="number"
            min={40}
            className={`mt-1 ${inputClass}`}
            value={(attrs.previewWidth as number) ?? ""}
            onChange={(event) =>
              update({ previewWidth: event.target.value ? Number(event.target.value) : null })
            }
          />
        </label>
        <div className="text-[11px] font-medium text-muted-foreground">
          {t("doc.imageAlign")}
          <Select
            value={(attrs.textAlignment as string) ?? "left"}
            onValueChange={(value) => update({ textAlignment: value })}
          >
            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALIGNMENTS.map((alignment) => (
                <SelectItem key={alignment} value={alignment} className="text-xs">
                  {t(`doc.align${alignment[0].toUpperCase()}${alignment.slice(1)}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Both extras, in the order the BlockNote toolbar showed them. */
export function TiptapToolbarExtras({ editor }: { editor: Editor }) {
  return (
    <>
      <TiptapImageOptionsButton editor={editor} />
      <TiptapAiButton editor={editor} />
    </>
  );
}
