/** The sticky note's fixed format row (tanNotes toolbar parity): bold /
 *  italic / underline / strike / code, multicolor highlight + text color
 *  palettes, font size, and the three list types.
 *
 *  Sits above the editor (NOT in the selection bubble — a sticky is short;
 *  its formatting commands should be visible while typing). Drives the same
 *  shared editor instance the sticky renders through the `toolbarExtras`
 *  render prop capture in StickyWindowApp.
 *
 *  Active states re-render on the editor's own transaction events — cheap,
 *  and the toolbar is the only subscriber on this window.
 */
import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { useDismissOnOutsideClick } from "./stickyShared";
import {
  Bold, ChevronDown, Code, Italic, List, ListOrdered, ListTodo,
  Strikethrough, Underline as UnderlineIcon,
} from "lucide-react";

const HIGHLIGHTS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "none", hex: "" },
  { id: "yellow", hex: "#fef08a" },
  { id: "green", hex: "#bbf7d0" },
  { id: "blue", hex: "#bfdbfe" },
  { id: "pink", hex: "#fbcfe8" },
  { id: "purple", hex: "#e9d5ff" },
  { id: "orange", hex: "#fed7aa" },
];

const TEXT_COLORS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "none", hex: "" },
  { id: "ink", hex: "#1f2937" },
  { id: "red", hex: "#dc2626" },
  { id: "blue", hex: "#2563eb" },
  { id: "green", hex: "#16a34a" },
  { id: "purple", hex: "#9333ea" },
  { id: "gray", hex: "#6b7280" },
];

const FONT_SIZES = [12, 13, 14, 16, 18, 20, 24, 32] as const;

function ToolButton({
  active, title, onClick, children,
}: {
  active?: boolean; title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`rounded-md p-1.5 hover:bg-black/10 ${active ? "bg-black/15" : ""}`}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection alive
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function SwatchPopover({
  open, swatches, current, onPick,
}: {
  open: boolean;
  swatches: ReadonlyArray<{ id: string; hex: string }>;
  current: string | undefined;
  onPick: (hex: string) => void;
}) {
  if (!open) return null;
  return (
    <div className="absolute top-full left-0 z-50 mt-1 flex gap-1 rounded-lg border border-black/10 bg-white/95 p-1.5 shadow-lg">
      {swatches.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.id}
          className={`size-5 rounded-full border ${current && s.hex && current === s.hex ? "border-neutral-800 ring-1 ring-neutral-500" : "border-black/15"}`}
          style={{ backgroundColor: s.hex || "transparent", backgroundImage: s.hex ? undefined : "linear-gradient(135deg, transparent 45%, #dc2626 45%, #dc2626 55%, transparent 55%)" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(s.hex)}
        />
      ))}
    </div>
  );
}

export function StickyToolbar({
  editor,
  noteFontSize,
  onNoteFontSize,
}: {
  editor: Editor | null;
  /** The note-wide font size (sticky_windows/font_size on the DB row) — the
   *  sticky applies it on the editor container, so list markers, spacing and
   *  every block scale together. */
  noteFontSize: number | null;
  onNoteFontSize: (size: number | null) => void;
}) {
  // Bumped on editor transactions so active states stay honest.
  const [, setTick] = useState(0);
  const [palette, setPalette] = useState<"highlight" | "color" | "size" | null>(null);
  // Any press outside the open palette closes it; the wrapper includes the
  // trigger, so toggling via the trigger still works naturally.
  const paletteWrapRef = useRef<HTMLDivElement | null>(null);
  useDismissOnOutsideClick(paletteWrapRef, palette !== null, () => setPalette(null));

  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((v) => v + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  if (!editor) return <div className="h-8" />;

  const run = (fn: () => void) => {
    fn();
    setTick((v) => v + 1);
  };

  const currentHighlight = (editor.getAttributes("highlight").color as string | undefined) ?? undefined;
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? undefined;
  const currentSize = noteFontSize ? `${noteFontSize}px` : "";

  return (
    <div className="relative flex shrink-0 flex-wrap items-center gap-0.5 border-b border-black/10 px-1.5 py-0.5">
      <ToolButton title="Bold" active={editor.isActive("bold")} onClick={() => run(() => editor.chain().focus().toggleBold().run())}>
        <Bold className="size-3.5" />
      </ToolButton>
      <ToolButton title="Italic" active={editor.isActive("italic")} onClick={() => run(() => editor.chain().focus().toggleItalic().run())}>
        <Italic className="size-3.5" />
      </ToolButton>
      <ToolButton title="Underline" active={editor.isActive("underline")} onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}>
        <UnderlineIcon className="size-3.5" />
      </ToolButton>
      <ToolButton title="Strikethrough" active={editor.isActive("strike")} onClick={() => run(() => editor.chain().focus().toggleStrike().run())}>
        <Strikethrough className="size-3.5" />
      </ToolButton>
      <ToolButton title="Code" active={editor.isActive("code")} onClick={() => run(() => editor.chain().focus().toggleCode().run())}>
        <Code className="size-3.5" />
      </ToolButton>

      <span className="mx-0.5 h-4 w-px bg-black/15" />

      <div className="relative" ref={palette === "highlight" ? paletteWrapRef : undefined}>
        <ToolButton
          title="Highlight"
          active={!!currentHighlight}
          onClick={() => setPalette((p) => (p === "highlight" ? null : "highlight"))}
        >
          <span
            className="block size-3.5 rounded-sm border border-black/20"
            style={{ backgroundColor: currentHighlight ?? "#fef08a" }}
          />
        </ToolButton>
        <SwatchPopover
          open={palette === "highlight"}
          swatches={HIGHLIGHTS}
          current={currentHighlight}
          onPick={(hex) => run(() => {
            if (hex) editor.chain().focus().setHighlight({ color: hex }).run();
            else editor.chain().focus().unsetHighlight().run();
            setPalette(null);
          })}
        />
      </div>
      <div className="relative" ref={palette === "color" ? paletteWrapRef : undefined}>
        <ToolButton
          title="Text color"
          active={!!currentColor}
          onClick={() => setPalette((p) => (p === "color" ? null : "color"))}
        >
          <span className="block size-3.5 rounded-sm border border-black/20" style={{ backgroundColor: currentColor ?? "#1f2937" }} />
        </ToolButton>
        <SwatchPopover
          open={palette === "color"}
          swatches={TEXT_COLORS}
          current={currentColor}
          onPick={(hex) => run(() => {
            if (hex) editor.chain().focus().setColor(hex).run();
            else editor.chain().focus().unsetColor().run();
            setPalette(null);
          })}
        />
      </div>

      <div className="relative" ref={palette === "size" ? paletteWrapRef : undefined}>
        <button
          type="button"
          title="Font size"
          className="flex items-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] hover:bg-black/10"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPalette((p) => (p === "size" ? null : "size"))}
        >
          {currentSize || "Aa"}
          <ChevronDown className="size-3" />
        </button>
        {palette === "size" && (
          <div className="absolute top-full left-0 z-50 mt-1 rounded-lg border border-black/10 bg-white/95 p-1 shadow-lg">
            {FONT_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                className={`block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-neutral-100 ${currentSize === `${size}px` ? "bg-neutral-200" : ""}`}
                onClick={() => {
                  onNoteFontSize(size);
                  setPalette(null);
                }}
              >
                {size}
              </button>
            ))}
            <button
              type="button"
              className="block w-full rounded-md px-2 py-1 text-left text-xs text-neutral-500 hover:bg-neutral-100"
              onClick={() => {
                onNoteFontSize(null);
                setPalette(null);
              }}
            >
              default
            </button>
          </div>
        )}
      </div>

      <span className="mx-0.5 h-4 w-px bg-black/15" />

      <ToolButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}>
        <List className="size-3.5" />
      </ToolButton>
      <ToolButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}>
        <ListOrdered className="size-3.5" />
      </ToolButton>
      <ToolButton title="Task list" active={editor.isActive("taskList")} onClick={() => run(() => editor.chain().focus().toggleTaskList().run())}>
        <ListTodo className="size-3.5" />
      </ToolButton>
    </div>
  );
}
