/**
 * The Tiptap document editor surface.
 *
 * Deliberately shaped like the BlockNote one it replaces: it takes a document
 * in storage format, reports changes, and exposes a `DocEditorApi` — so
 * `DocEditor` and `LocalDocEditor` can branch on a flag at one line rather
 * than fork (plan.md §3, Phase 6).
 *
 * Import lazily: this pulls in the schema, which pulls in shiki.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useT } from "@/hooks/useT";
import { refreshCodeBlockTheme } from "../codeBlockTheme";
import { buildExtensions } from "./schema";
import { createDocEditorApi } from "./createDocEditorApi";
import { blocksToPmDoc } from "./blockAdapter";
import type { Block } from "./blocks";
import type { DocEditorApi } from "./DocEditorApi";
import { BubbleToolbar } from "./ui/BubbleToolbar";
import { SlashMenu } from "./ui/SlashMenu";
import { SideMenu } from "./ui/SideMenu";
import { TiptapToolbarExtras } from "./ui/ToolbarExtras";
import type { SlashMenuSnapshot } from "./ui/slashSuggestion";
import { useSettingsStore } from "@/store/settingsStore";

export interface TiptapDocumentEditorProps {
  /** Initial content. Later changes are ignored — the editor owns the document
   *  from mount, exactly as the BlockNote one does. Remount via `key` to load
   *  a different document. */
  initialBlocks: Block[];
  isDark: boolean;
  editable?: boolean;
  /** Stores a pasted or dropped file, resolving to `tanwords-asset://<id>`. */
  onUploadFile?: (file: File) => Promise<string>;
  readNativeImage?: () => Promise<File | null>;
  onChange?: () => void;
  onError?: (message: string) => void;
  /** Handed the API once the editor exists, so callers can drive it. */
  onReady?: (api: DocEditorApi) => void;
  /** Replaces the default extras (image options + ask AI) if supplied — the
   *  protected-document toolbar swaps in password-gated file actions. A render
   *  prop because the extras need the live editor. */
  toolbarExtras?: (editor: TiptapEditor) => React.ReactNode;
  className?: string;
}

export function TiptapDocumentEditor({
  initialBlocks,
  isDark,
  editable = true,
  onUploadFile,
  readNativeImage,
  onChange,
  onError,
  onReady,
  toolbarExtras,
  className,
}: TiptapDocumentEditorProps) {
  const t = useT();
  const appTheme = useSettingsStore((state) => state.theme);
  const [slash, setSlash] = useState<SlashMenuSnapshot | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Built once: extensions define the schema, and swapping it under a live
  // editor rebuilds the document. Callbacks are read through refs instead.
  const extensions = useMemo(
    () => buildExtensions({
      upload: onUploadFile,
      readNativeImage,
      onError,
      onChanged: () => onChangeRef.current?.(),
      onSlashMenu: setSlash,
      label: t,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above; the
    // upload target is stable for a mounted document.
    [],
  );

  // Block → ProseMirror conversion is linear in the whole document. Keep it
  // out of incidental React re-renders (theme, slash menu, toolbar state).
  const initialContent = useMemo(() => blocksToPmDoc(initialBlocks), [initialBlocks]);

  const editor = useEditor({
    extensions,
    editable,
    content: initialContent as never,
    // React 19 + StrictMode double-invokes effects; without this the editor
    // renders its DOM immediately and the second pass finds it already there.
    immediatelyRender: false,
    onUpdate: () => onChangeRef.current?.(),
  });

  const api = useMemo(() => (editor ? createDocEditorApi(editor) : null), [editor]);

  useEffect(() => {
    if (api) onReady?.(api);
  }, [api, onReady]);

  useEffect(() => {
    if (editor) refreshCodeBlockTheme(editor);
  }, [editor, isDark, appTheme]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    // Ctrl/Cmd+A inside the editor should select the document, not the page.
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") return;
    if (!editor || !(event.target as Element).closest(".tanwords-tiptap")) return;
    event.preventDefault();
    event.stopPropagation();
    editor.commands.selectAll();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className={`tanwords-tiptap relative ${className ?? ""}`} onKeyDownCapture={handleKeyDown}>
      {editable && (
        <>
          <BubbleToolbar editor={editor}>
            {toolbarExtras ? toolbarExtras(editor) : <TiptapToolbarExtras editor={editor} />}
          </BubbleToolbar>
          <SlashMenu editor={editor} snapshot={slash} />
          <SideMenu editor={editor} />
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
