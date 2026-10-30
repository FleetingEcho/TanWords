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
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { useT } from "@/hooks/useT";
import {
  Bold, ChevronDown, ClipboardPaste, Code, Italic, List, ListOrdered, ListTodo,
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

/** Block-level paint for code blocks (marks are schema-disabled inside them —
 *  shiki owns per-token colours — so highlight/textColour buttons silently
 *  no-op there; these two palettes are the code block's own surface/paint.
 *  Stored as codeBlock node attrs, see codeBlockLanguage.ts). Empty hex = the
 *  theme default. */
const CODE_BACKGROUNDS: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "default", hex: "" },
  { id: "paper", hex: "#f6f5f1" },
  { id: "blue", hex: "#dbeafe" },
  { id: "green", hex: "#d1fae5" },
  { id: "pink", hex: "#fce7f3" },
  { id: "purple", hex: "#ede9fe" },
  { id: "orange", hex: "#ffedd5" },
  { id: "dark", hex: "#1f2937" },
];
const CODE_TEXT: ReadonlyArray<{ id: string; hex: string }> = [
  { id: "default", hex: "" },
  { id: "ink", hex: "#1f2937" },
  { id: "red", hex: "#dc2626" },
  { id: "blue", hex: "#2563eb" },
  { id: "green", hex: "#16a34a" },
  { id: "purple", hex: "#9333ea" },
  { id: "gray", hex: "#6b7280" },
  { id: "paper", hex: "#f9fafb" },
];

function ToolButton({
  active, title, onClick, children,
}: {
  active?: boolean; title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`flex size-6 items-center justify-center rounded-md transition-colors hover:bg-black/10 ${active ? "bg-black/15" : ""}`}
      onMouseDown={(e) => e.preventDefault()} // keep the text selection alive
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Portaled, fixed-position dropdown anchored to its trigger.
 *
 *  NOT an in-flow `absolute` child: the toolbar strip scrolls horizontally
 *  (`overflow-x-auto`), which clips absolutely-positioned children — an
 *  invisible palette that looks like "the colour buttons do nothing" and
 *  whose swatch clicks are then eaten by outside-click dismissal. The portal
 *  drops out of the strip's clip context entirely; dismissal is handled here
 *  as pointer-down outside popover AND outside the trigger. */
function PopoverPortal({
  anchorRef,
  onClose,
  children,
  className,
  width,
  height,
}: {
  anchorRef: { current: HTMLElement | null };
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** px width used to keep the panel inside the window when the trigger sits
   *  near the right edge (default 170 ≈ swatch row). */
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, [anchorRef, onClose]);

  const r = anchorRef.current?.getBoundingClientRect();
  const style: CSSProperties = r
    ? {
        position: "fixed",
        top: height ? Math.max(8, Math.min(r.bottom + 4, window.innerHeight - height - 8)) : r.bottom + 4,
        left: Math.max(8, Math.min(r.left, window.innerWidth - (width ?? 170) - 8)),
        zIndex: 60,
      }
    : {};
  return createPortal(
    <div ref={ref} className={`rounded-lg border border-black/10 bg-white/95 p-1.5 shadow-lg ${className ?? ""}`} style={style}>
      {children}
    </div>,
    document.body
  );
}

function SwatchPopover({
  open, swatches, current, onPick, anchorRef, onClose,
}: {
  open: boolean;
  swatches: ReadonlyArray<{ id: string; hex: string }>;
  current: string | undefined;
  onPick: (hex: string) => void;
  anchorRef: { current: HTMLElement | null };
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <PopoverPortal anchorRef={anchorRef} onClose={onClose} className="flex gap-1">
      {swatches.map((s) => (
        <button
          key={s.id}
          type="button"
          title={s.id}
          className={`size-5 shrink-0 rounded-full border ${current && s.hex && current === s.hex ? "border-neutral-800 ring-1 ring-neutral-500" : "border-black/15"}`}
          style={{ backgroundColor: s.hex || "transparent", backgroundImage: s.hex ? undefined : "linear-gradient(135deg, transparent 45%, #dc2626 45%, #dc2626 55%, transparent 55%)" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(s.hex)}
        />
      ))}
    </PopoverPortal>
  );
}

export function StickyToolbar({
  editor,
  noteFontSize,
  onNoteFontSize,
  onPasteMarkdown,
}: {
  editor: Editor | null;
  /** The note-wide font size (sticky_windows/font_size on the DB row) — the
   *  sticky applies it on the editor container, so list markers, spacing and
   *  every block scale together. Optional: surfaces without a per-note size
   *  (the web editor drawer) omit the control by not passing handlers. */
  noteFontSize?: number | null;
  onNoteFontSize?: (size: number | null) => void;
  /** Converts Markdown from the paste field into rendered editor blocks. */
  onPasteMarkdown?: (markdown: string) => Promise<boolean>;
}) {
  const t = useT();
  // Bumped on editor transactions so active states stay honest.
  const [, setTick] = useState(0);
  const [palette, setPalette] = useState<"highlight" | "color" | "size" | "codeBg" | "codeText" | null>(null);
  const [markdownOpen, setMarkdownOpen] = useState(false);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [markdownBusy, setMarkdownBusy] = useState(false);
  const [markdownError, setMarkdownError] = useState(false);
  // One anchor ref per palette trigger; PopoverPortal measures off these and
  // swallows outside-click dismissal itself (trigger clicks stay toggles).
  const hlAnchorRef = useRef<HTMLDivElement | null>(null);
  const colorAnchorRef = useRef<HTMLDivElement | null>(null);
  const sizeAnchorRef = useRef<HTMLDivElement | null>(null);
  const codeBgAnchorRef = useRef<HTMLDivElement | null>(null);
  const codeTextAnchorRef = useRef<HTMLDivElement | null>(null);
  const markdownAnchorRef = useRef<HTMLDivElement | null>(null);

  const submitMarkdown = async () => {
    if (!onPasteMarkdown || !markdownDraft.trim() || markdownBusy) return;
    setMarkdownBusy(true);
    setMarkdownError(false);
    try {
      if (!await onPasteMarkdown(markdownDraft)) {
        setMarkdownError(true);
        return;
      }
      setMarkdownDraft("");
      setMarkdownOpen(false);
    } catch {
      setMarkdownError(true);
    } finally {
      setMarkdownBusy(false);
    }
  };

  useEffect(() => {
    if (!editor) return;
    const bump = () => setTick((v) => v + 1);
    editor.on("transaction", bump);
    return () => {
      editor.off("transaction", bump);
    };
  }, [editor]);

  if (!editor) return <div className="h-[30px] shrink-0 bg-black/[0.05] backdrop-blur" />;

  const run = (fn: () => void) => {
    fn();
    setTick((v) => v + 1);
  };

  const currentHighlight = (editor.getAttributes("highlight").color as string | undefined) ?? undefined;
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) ?? undefined;
  const currentSize = noteFontSize ? `${noteFontSize}px` : "";
  const inCodeBlock = editor.isActive("codeBlock");
  const currentCodeBg = (editor.getAttributes("codeBlock").backgroundColor as string | null | undefined) ?? null;
  const currentCodeText = (editor.getAttributes("codeBlock").textColor as string | null | undefined) ?? null;

  return (
    <div className="relative flex h-[30px] shrink-0 items-center gap-0.5 overflow-x-auto bg-black/[0.05] px-1.5 backdrop-blur [scrollbar-width:none]">
      <ToolButton title={t("sticky.tb.bold")} active={editor.isActive("bold")} onClick={() => run(() => editor.chain().focus().toggleBold().run())}>
        <Bold className="size-3.5" />
      </ToolButton>
      <ToolButton title={t("sticky.tb.italic")} active={editor.isActive("italic")} onClick={() => run(() => editor.chain().focus().toggleItalic().run())}>
        <Italic className="size-3.5" />
      </ToolButton>
      <ToolButton title={t("sticky.tb.underline")} active={editor.isActive("underline")} onClick={() => run(() => editor.chain().focus().toggleUnderline().run())}>
        <UnderlineIcon className="size-3.5" />
      </ToolButton>
      <ToolButton title={t("sticky.tb.strikethrough")} active={editor.isActive("strike")} onClick={() => run(() => editor.chain().focus().toggleStrike().run())}>
        <Strikethrough className="size-3.5" />
      </ToolButton>
      <ToolButton title={t("sticky.tb.code")} active={editor.isActive("code")} onClick={() => run(() => editor.chain().focus().toggleCode().run())}>
        <Code className="size-3.5" />
      </ToolButton>

      <span className="mx-0.5 h-4 w-px bg-black/15" />

      <div ref={hlAnchorRef}>
        <ToolButton
          title={t("sticky.tb.highlight")}
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
          anchorRef={hlAnchorRef}
          onClose={() => setPalette(null)}
          onPick={(hex) => run(() => {
            if (hex) editor.chain().focus().setHighlight({ color: hex }).run();
            else editor.chain().focus().unsetHighlight().run();
            setPalette(null);
          })}
        />
      </div>
      <div ref={colorAnchorRef}>
        <ToolButton
          title={t("sticky.tb.textColor")}
          active={!!currentColor}
          onClick={() => setPalette((p) => (p === "color" ? null : "color"))}
        >
          <span className="block size-3.5 rounded-sm border border-black/20" style={{ backgroundColor: currentColor ?? "#1f2937" }} />
        </ToolButton>
        <SwatchPopover
          open={palette === "color"}
          swatches={TEXT_COLORS}
          current={currentColor}
          anchorRef={colorAnchorRef}
          onClose={() => setPalette(null)}
          onPick={(hex) => run(() => {
            if (hex) editor.chain().focus().setColor(hex).run();
            else editor.chain().focus().unsetColor().run();
            setPalette(null);
          })}
        />
      </div>

      {onNoteFontSize && (
      <div ref={sizeAnchorRef}>
        <button
          type="button"
          title={t("sticky.tb.fontSize")}
          className="flex h-6 items-center gap-0.5 rounded-md px-1.5 text-[11px] transition-colors hover:bg-black/10"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPalette((p) => (p === "size" ? null : "size"))}
        >
          {currentSize || "Aa"}
          <ChevronDown className="size-3" />
        </button>
        {palette === "size" && (
          <PopoverPortal anchorRef={sizeAnchorRef} onClose={() => setPalette(null)} className="w-20" width={90}>
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
          </PopoverPortal>
        )}
      </div>
      )}

      <span className="mx-0.5 h-4 w-px bg-black/15" />

      <ToolButton title={t("sticky.tb.bulletList")} active={editor.isActive("bulletList")} onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}>
        <List className="size-3.5" />
      </ToolButton>
      <ToolButton title={t("sticky.tb.numberedList")} active={editor.isActive("orderedList")} onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}>
        <ListOrdered className="size-3.5" />
      </ToolButton>
      {/* Code-block paint: only when the caret sits inside one. (Highlight/
          textColor swatches silently no-op inside code — marks are off there
          — so the code section is the code block's own styling affordance.) */}
      {inCodeBlock && (
        <>
          <span className="mx-0.5 h-4 w-px bg-black/15" />
          <div ref={codeBgAnchorRef}>
            <ToolButton
              title={t("sticky.tb.codeBg")}
              active={!!currentCodeBg}
              onClick={() => setPalette((p) => (p === "codeBg" ? null : "codeBg"))}
            >
              <span
                className="block size-3.5 rounded-sm border border-black/25"
                style={{
                  backgroundColor: currentCodeBg ?? "#f3f4f6",
                  backgroundImage: "linear-gradient(135deg, #f3f4f6 0%, #f3f4f6 40%, #9ca3af 40%, #9ca3af 60%, #f3f4f6 60%)",
                }}
              />
            </ToolButton>
            <SwatchPopover
              open={palette === "codeBg"}
              swatches={CODE_BACKGROUNDS}
              current={currentCodeBg ?? undefined}
              anchorRef={codeBgAnchorRef}
              onClose={() => setPalette(null)}
              onPick={(hex) => run(() => {
                editor.chain().focus().updateAttributes("codeBlock", { backgroundColor: hex || null }).run();
                setPalette(null);
              })}
            />
          </div>
          <div ref={codeTextAnchorRef}>
            <ToolButton
              title={t("sticky.tb.codeText")}
              active={!!currentCodeText}
              onClick={() => setPalette((p) => (p === "codeText" ? null : "codeText"))}
            >
              <span
                className="flex size-3.5 items-center justify-center rounded-sm border border-black/20 text-[9px] font-bold leading-none"
                style={{ color: currentCodeText ?? "#1f2937", backgroundColor: currentCodeBg ?? undefined }}
              >
                A
              </span>
            </ToolButton>
            <SwatchPopover
              open={palette === "codeText"}
              swatches={CODE_TEXT}
              current={currentCodeText ?? undefined}
              anchorRef={codeTextAnchorRef}
              onClose={() => setPalette(null)}
              onPick={(hex) => run(() => {
                editor.chain().focus().updateAttributes("codeBlock", { textColor: hex || null }).run();
                setPalette(null);
              })}
            />
          </div>
        </>
      )}

      <ToolButton title={t("sticky.tb.taskList")} active={editor.isActive("taskList")} onClick={() => run(() => editor.chain().focus().toggleTaskList().run())}>
        <ListTodo className="size-3.5" />
      </ToolButton>
      {onPasteMarkdown && (
        <>
          <span className="mx-0.5 h-4 w-px bg-black/15" />
          <div ref={markdownAnchorRef}>
            <ToolButton title={t("sticky.pasteMarkdown")} active={markdownOpen} onClick={() => setMarkdownOpen((open) => !open)}>
              <ClipboardPaste className="size-3.5" />
            </ToolButton>
            {markdownOpen && (
              <PopoverPortal
                anchorRef={markdownAnchorRef}
                onClose={() => setMarkdownOpen(false)}
                width={320}
                height={220}
                className="max-h-[calc(100vh-16px)] w-[min(320px,calc(100vw-16px))] overflow-y-auto text-neutral-800"
              >
                <label className="block px-1 pb-1 text-xs font-semibold">{t("sticky.pasteMarkdown")}</label>
                <textarea
                  autoFocus
                  value={markdownDraft}
                  onChange={(event) => { setMarkdownDraft(event.target.value); setMarkdownError(false); }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setMarkdownOpen(false);
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void submitMarkdown();
                    }
                  }}
                  placeholder={t("sticky.markdownPlaceholder")}
                  className="min-h-24 max-h-[40vh] w-full resize-y rounded-md border border-black/15 bg-white p-2 font-mono text-xs outline-none focus:border-black/40"
                />
                {markdownError && <p role="alert" className="px-1 text-xs text-red-700">{t("sticky.markdownInsertFailed")}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" className="rounded-md px-2 py-1 text-xs hover:bg-black/5" onClick={() => setMarkdownOpen(false)}>
                    {t("sticky.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={!markdownDraft.trim() || markdownBusy}
                    className="rounded-md bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50"
                    onClick={() => void submitMarkdown()}
                  >
                    {markdownBusy ? t("sticky.saving") : t("sticky.insertMarkdown")}
                  </button>
                </div>
              </PopoverPortal>
            )}
          </div>
        </>
      )}
    </div>
  );
}
