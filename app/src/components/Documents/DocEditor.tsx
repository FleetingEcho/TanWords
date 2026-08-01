import React, { useRef, useState } from "react";
import { toast } from "sonner";
import {
  FormattingToolbarController,
} from "@blocknote/react";
import { offset, shift } from "@floating-ui/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";

import { DocumentDetail } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { parseDbTimestamp } from "@/lib/dbTime";
import { PinIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Check, Link2, Maximize2, Minimize2, Search } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import type { SaveStatus } from "./useDocumentEditor";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { selectRichEditorContents } from "./editorSelection";
import { useSettingsStore } from "@/store/settingsStore";
import { DocumentPasswordDialog } from "./DocumentPasswordDialog";
import { DocumentPreviewScrollArea } from "./DocumentPreviewScrollArea";
import { DocumentContentSearch } from "./DocumentContentSearch";
import { useDocEditorContent } from "./hooks/useDocEditorContent";
import { useDocEditorLinks } from "./hooks/useDocEditorLinks";
import { useDocEditorAttachments } from "./hooks/useDocEditorAttachments";
import { BlockTemplatesMenu } from "./BlockTemplatesMenu";
import { DocumentOutline } from "./DocumentOutline";
import { exportEditorHtml, exportEditorPdf } from "@/lib/documentExport";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import type { DocumentRevision } from "@/lib/documentRevisions";
import { DocumentToolbarActions } from "./DocumentToolbarActions";
import { contentToBlocksOffThread } from "@/lib/documentWorkerClient";
import { withTrailingEditorParagraph } from "./trailingEditorParagraph";
import { liftMermaid } from "./mermaidTransforms";

interface Props {
  doc: DocumentDetail;
  onSave: (content: string, contentText: string, wordCount: number) => Promise<void>;
  onDirty: () => void;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string) => void;
  onPinToggle: () => void;
  saveStatus: SaveStatus;
  zenMode: boolean;
  onZenModeChange: (enabled: boolean) => void;
}

export function DocEditor({ doc, onSave, onDirty, onTitleChange, onTagsChange, onPinToggle, saveStatus, zenMode, onZenModeChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const documentFontSize = useSettingsStore((state) => state.documentFontSize);
  const setDocumentFontSize = useSettingsStore((state) => state.setDocumentFontSize);
  const [title, setTitle] = useState(doc.title);
  const [tagsInput, setTagsInput] = useState(
    (() => { try { return (JSON.parse(doc.tags) as string[]).join(", "); } catch { return ""; } })()
  );
  const titleRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const searchRootRef = useRef<HTMLDivElement>(null);
  const [toolbarPortalElement, setToolbarPortalElement] = useState<HTMLDivElement | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineTick, setOutlineTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

  const content = useDocEditorContent(doc, onSave, onDirty);
  const { editor, mode, rawMarkdown, switchingMode, richLoading, switchMode, handleChange, handleRawChange, scheduleSave } = content;

  const links = useDocEditorLinks({ documentId: doc.id, documentContent: doc.content, editor, scheduleSave });
  const attachments = useDocEditorAttachments({ doc, editor, isDark, scheduleSave });

  const handleTitleBlur = () => {
    const val = title.trim() || t("doc.untitled");
    setTitle(val);
    onTitleChange(val);
  };

  const handleTagsBlur = () => {
    const tags = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);
    onTagsChange(JSON.stringify(tags));
  };

  const tagChips = tagsInput.split(",").map((s) => s.trim()).filter(Boolean);

  return (
    <div
      ref={setToolbarPortalElement}
      className="bn-root relative flex h-full flex-col"
      data-color-scheme={isDark ? "dark" : "light"}
    >
      {/* Title + metadata */}
      <div className="px-12 pt-8 pb-2 shrink-0">
        <div className="flex items-start gap-3">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); titleRef.current?.blur(); } }}
            placeholder={t("doc.untitled")}
            className="document-editor-title flex-1 font-bold tracking-tight bg-transparent border-none outline-hidden placeholder:text-muted-foreground/30 text-foreground"
          />
          <Button
            variant="ghost"
            onClick={onPinToggle}
            title={doc.pinned ? t("doc.unpin") : t("doc.pin")}
            className={`mt-2 w-8 h-8 p-0 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
              doc.pinned
                ? "text-amber-500 bg-amber-500/10 hover:bg-amber-500/10"
                : "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
            }`}
          >
            <PinIcon filled={doc.pinned} className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onZenModeChange(!zenMode)}
            title={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
            aria-label={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
            className="mt-2 h-8 w-8 shrink-0 text-muted-foreground"
          >
            {zenMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0">
              <path d="M3.5 10.5v-6a1 1 0 011-1h6l6 6-7 7-6-6z" strokeLinejoin="round" />
              <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              onBlur={handleTagsBlur}
              placeholder={t("doc.tagsPlaceholder")}
              className="flex-1 text-xs bg-transparent border-none outline-hidden text-muted-foreground placeholder:text-muted-foreground/40"
            />
            {tagChips.length > 0 && (
              <div className="flex gap-1 shrink-0">
                {tagChips.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {mode === "rich" && <DocumentContentSearch rootRef={searchRootRef} />}
          </div>
          <DocumentToolbarActions
            mode={mode}
            switching={switchingMode}
            onMode={(nextMode) => void switchMode(nextMode)}
            onAttach={() => attachmentInputRef.current?.click()}
            onInsertLink={() => links.setLinkPickerOpen(true)}
            templatesMenu={<BlockTemplatesMenu editor={editor} />}
            outlineActive={outlineOpen}
            onToggleOutline={() => setOutlineOpen((v) => !v)}
            onHistory={() => setHistoryOpen(true)}
            onExportHtml={() => void exportEditorHtml(editor, doc.title).catch((error) => toast.error(String(error)))}
            onExportPdf={() => void exportEditorPdf(editor, doc.title).catch((error) => toast.error(String(error)))}
            documentFontSize={documentFontSize}
            onFontSizeChange={setDocumentFontSize}
          />
        </div>
        <div className="mt-3 border-b border-border/60" />
        <input ref={attachmentInputRef} type="file" className="hidden"
          onChange={(event) => { void attachments.insertAttachment(event.target.files?.[0]); event.target.value = ""; }} />
      </div>

      {mode === "rich" ? (
        <div ref={searchRootRef} className="contents">
          <div className="flex min-h-0 flex-1">
            <DocumentPreviewScrollArea onClickCapture={links.handleEditorClick}
              onKeyDownCapture={(e) => attachments.handleRichEditorKeyDown(e, selectRichEditorContents)}>
              {richLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
                  <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
              <BlockNoteView editor={editor} theme={isDark ? "dark" : "light"} onChange={() => { setOutlineTick((tick) => tick + 1); handleChange(); }}
                formattingToolbar={false} className="tanwords-editor">
                <FormattingToolbarController
                  formattingToolbar={attachments.formattingToolbar}
                  portalElement={toolbarPortalElement}
                  floatingUIOptions={{
                    useFloatingOptions: {
                      placement: "bottom-start",
                      middleware: [offset(10), shift({ padding: 8 })],
                    },
                    elementProps: { style: { zIndex: 100 } },
                  }}
                />
              </BlockNoteView>
            </DocumentPreviewScrollArea>
            {outlineOpen && <DocumentOutline editor={editor} tick={outlineTick} />}
          </div>
        </div>
      ) : (
        <RawMarkdownEditor value={rawMarkdown} onChange={handleRawChange} label={t("doc.rawMode")} />
      )}

      {(links.linkContext.outgoing.length > 0 || links.linkContext.backlinks.length > 0) && (
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-12 py-2 text-[10px]">
          {links.linkContext.outgoing.length > 0 && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Link2 className="h-3 w-3" /> {t("doc.outgoingLinks")}:
              {links.linkContext.outgoing.map((item) => (
                <button key={item.id} onClick={() => window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id: item.id } }))}
                  className="text-primary hover:underline">{item.title}</button>
              ))}
            </span>
          )}
          {links.linkContext.backlinks.length > 0 && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {t("doc.backlinks")}:
              {links.linkContext.backlinks.map((item) => (
                <button key={item.id} onClick={() => window.dispatchEvent(new CustomEvent("tanwords:open-document", { detail: { id: item.id } }))}
                  className="text-primary hover:underline">{item.title}</button>
              ))}
            </span>
          )}
        </div>
      )}

      {/* Footer: save status + word count */}
      <div className="px-12 py-2.5 border-t border-border flex items-center gap-3 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
        <span>
          {saveStatus === "saving" ? (
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground border-t-transparent rounded-full animate-spin" />
              {t("doc.saving")}
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" /> {t("doc.autoSaved")}</span>
          ) : saveStatus === "dirty" ? (
            <span>{t("doc.unsavedChanges")}</span>
          ) : null}
        </span>
        <span className="ml-auto">{t("doc.wordCount", { n: doc.word_count })}</span>
        <span>{parseDbTimestamp(doc.updated_at).toLocaleDateString()}</span>
      </div>

      <Dialog open={links.linkPickerOpen} onClose={() => links.setLinkPickerOpen(false)} maxWidth="max-w-md" className="overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold">{t("doc.insertDocumentLink")}</DialogTitle>
        </div>
        <div className="p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input autoFocus value={links.linkQuery} onChange={(event) => links.setLinkQuery(event.target.value)}
              placeholder={t("doc.searchDocumentsToLink")}
              className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-hidden focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="mt-3 max-h-80 overflow-y-auto">
            {links.linkContext.candidates
              .filter((item) => item.title.toLowerCase().includes(links.linkQuery.trim().toLowerCase()))
              .map((item) => (
                <button key={item.id} onClick={() => links.insertDocumentLink(item)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted">
                  <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{item.title}</span>
                </button>
              ))}
          </div>
        </div>
      </Dialog>

      <DocumentPasswordDialog
        request={attachments.passwordRequest}
        onCancel={() => attachments.finishPasswordRequest(null)}
        onSubmit={(password) => attachments.finishPasswordRequest(password)}
      />
      <DocumentHistoryModal
        open={historyOpen}
        documentId={doc.id}
        onClose={() => setHistoryOpen(false)}
        onRestore={(revision: DocumentRevision) => {
          void (async () => {
            const blocks = await contentToBlocksOffThread(revision.content);
            editor.replaceBlocks(
              editor.document,
              withTrailingEditorParagraph(liftMermaid(blocks)) as any,
            );
            onDirty();
            scheduleSave();
            setTitle(revision.title);
            onTitleChange(revision.title);
          })().catch((error) => toast.error(String(error)));
        }}
      />
    </div>
  );
}
