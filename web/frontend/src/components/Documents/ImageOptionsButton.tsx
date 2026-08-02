import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { useBlockNoteEditor, useEditorState } from "@blocknote/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/hooks/useT";

/** Extra image editing affordance for BlockNote: alt text, caption, width, and
 *  alignment in one small popover. The default toolbar already covers caption
 *  and alignment, but this makes the whole image-options surface explicit. */
export function ImageOptionsButton() {
  const t = useT();
  const editor = useBlockNoteEditor();
  const block = useEditorState({
    editor,
    selector: ({ editor: currentEditor }: any) => {
      const blocks = currentEditor.getSelection()?.blocks || [
        currentEditor.getTextCursorPosition().block,
      ];
      if (blocks.length !== 1) return undefined;
      const selected = blocks[0];
      return selected?.type === "image" ? selected : undefined;
    },
  });
  const [open, setOpen] = useState(false);

  if (!block) return null;

  const update = (patch: Record<string, unknown>) => {
    editor.updateBlock(block.id, { props: { ...block.props, ...patch } });
  };

  const inputClass =
    "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs outline-hidden focus:ring-1 focus:ring-primary/30";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("doc.imageOptions")}
          className="bn-button mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
        >
          <ImageIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="mb-2 text-xs font-semibold">{t("doc.imageOptions")}</p>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted-foreground">{t("doc.imageAlt")}</span>
            <input
              className={inputClass}
              value={block.props.name ?? ""}
              onChange={(event) => update({ name: event.target.value })}
              placeholder={t("doc.imageAltPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted-foreground">{t("doc.imageCaption")}</span>
            <input
              className={inputClass}
              value={block.props.caption ?? ""}
              onChange={(event) => update({ caption: event.target.value })}
              placeholder={t("doc.imageCaptionPlaceholder")}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] text-muted-foreground">{t("doc.imageWidth")}</span>
            <input
              className={inputClass}
              type="number"
              min={100}
              max={4000}
              value={block.props.previewWidth ?? ""}
              onChange={(event) => update({ previewWidth: event.target.value ? Number(event.target.value) : undefined })}
              placeholder="auto"
            />
          </label>
          <div>
            <span className="mb-1 block text-[10px] text-muted-foreground">{t("doc.imageAlign")}</span>
            <Select
              value={block.props.textAlignment ?? "left"}
              onValueChange={(value) => update({ textAlignment: value })}
            >
              <SelectTrigger className="h-8 w-full rounded-lg px-2.5 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="left">{t("doc.alignLeft")}</SelectItem>
                <SelectItem value="center">{t("doc.alignCenter")}</SelectItem>
                <SelectItem value="right">{t("doc.alignRight")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
