/** Starter templates for new stickies (tanNotes `templates.ts` parity).
 *
 *  tanNotes shipped markdown templates through its own manager; here they're
 *  plain Block[] literals in the storage format — no worker round trip, no
 *  markdown parse step at creation time, and the content that lands in
 *  `documents.content` is byte-identical to what the editor would save.
 */
import type { Block } from "@/components/Documents/tiptap/blocks";

export interface StickyTemplate {
  id: string;
  labelKey: string;
  blocks: Block[];
}

export const STICKY_TEMPLATES: ReadonlyArray<StickyTemplate> = [
  {
    id: "blank",
    labelKey: "sticky.templates.blank",
    blocks: [{ type: "paragraph", props: {}, content: "" }],
  },
  {
    id: "todo",
    labelKey: "sticky.templates.todo",
    blocks: [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "To-do", styles: {} }] },
      { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "First task", styles: {} }] },
      { type: "checkListItem", props: { checked: false }, content: [{ type: "text", text: "Second task", styles: {} }] },
    ],
  },
  {
    id: "meeting",
    labelKey: "sticky.templates.meeting",
    blocks: [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Meeting notes", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "Attendees: ", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "Decisions:", styles: { bold: true } }] },
      { type: "bulletListItem", props: {}, content: "" },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "Follow-ups:", styles: { bold: true } }] },
      { type: "checkListItem", props: { checked: false }, content: "" },
    ],
  },
  {
    id: "journal",
    labelKey: "sticky.templates.journal",
    blocks: [
      { type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Today", styles: {} }] },
      { type: "paragraph", props: {}, content: [{ type: "text", text: "Three good things:", styles: {} }] },
      { type: "numberedListItem", props: {}, content: "" },
      { type: "numberedListItem", props: {}, content: "" },
      { type: "numberedListItem", props: {}, content: "" },
    ],
  },
];
