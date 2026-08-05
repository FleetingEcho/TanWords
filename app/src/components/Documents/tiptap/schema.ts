/**
 * The Tiptap extension set backing the document editor.
 *
 * Node names deliberately equal the stored block `type` strings wherever the
 * two models agree, so `blockAdapter` needs no mapping table. The one place
 * they cannot agree is lists: our format keeps items flat and nests through
 * `children`, ProseMirror wraps runs of items in a list node. The adapter
 * groups and ungroups; see `blocks.ts`.
 *
 * Import ONLY from lazily-loaded editor components — `codeBlockShiki` pulls in
 * shiki, which must stay out of the main chunk.
 */
import { StarterKit } from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import UniqueID from "@tiptap/extension-unique-id";
import { MEDIA_NODES } from "./nodes/mediaNodes";
import { MermaidNode, YouTubeNode } from "./nodes/customNodes";
import { CodeBlockShiki } from "./nodes/codeBlockShiki";
import { CodeBlockWithLanguage } from "./nodes/codeBlockLanguage";
import { BlockStyleAttrs } from "./nodes/blockStyleAttrs";
import { AssetPaste } from "./assetPaste";
import { SlashSuggestion, type SlashMenuSnapshot } from "./ui/slashSuggestion";

/** Block nodes that carry a stable id.
 *
 *  `DocumentOutline` scrolls to a heading by `data-id`, which BlockNote
 *  assigned for free. UniqueID is the MIT replacement. */
const ID_BEARING_NODES = [
  "paragraph",
  "heading",
  "listItem",
  "taskItem",
  "blockquote",
  "codeBlock",
  "table",
  "image",
  "video",
  "audio",
  "file",
  "mermaid",
  "youtube",
];

const ALIGNABLE_NODES = ["paragraph", "heading", "image"];

export interface EditorExtensionOptions {
  /** Stores a pasted/dropped file, resolving to `tanwords-asset://<id>`.
   *  Omitted for read-only surfaces (the Reader), which never upload. */
  upload?: (file: File) => Promise<string>;
  readNativeImage?: () => Promise<File | null>;
  onError?: (message: string) => void;
  onChanged?: () => void;
  /** Publishes slash-menu state; `null` closes it. */
  onSlashMenu?: (snapshot: SlashMenuSnapshot | null) => void;
  /** Resolves an i18n key, so slash items match on their visible label. */
  label?: (key: string) => string;
}

export function buildExtensions(options: EditorExtensionOptions = {}) {
  return [
    StarterKit.configure({
      // The app owns its trailing paragraph: `trailingEditorParagraph.ts`
      // appends one as an editing affordance and strips it again before save,
      // and that round trip is part of the storage contract. Tiptap's own
      // trailingNode would append a second one that never gets stripped.
      trailingNode: false,
      // Replaced by CodeBlockWithLanguage below, which adds the picker; the
      // highlighting itself comes from CodeBlockShiki.
      codeBlock: false,
      link: { openOnClick: false, autolink: true },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TextAlign.configure({ types: ALIGNABLE_NODES }),
    UniqueID.configure({ types: ID_BEARING_NODES, attributeName: "id" }),
    ...MEDIA_NODES,
    MermaidNode,
    YouTubeNode,
    CodeBlockWithLanguage,
    CodeBlockShiki,
    BlockStyleAttrs,
    AssetPaste.configure({
      upload: options.upload ?? null,
      readNativeImage: options.readNativeImage ?? null,
      onError: options.onError ?? null,
      onChanged: options.onChanged ?? null,
    }),
    SlashSuggestion.configure({
      onChange: options.onSlashMenu ?? null,
      label: options.label ?? null,
    }),
  ];
}
