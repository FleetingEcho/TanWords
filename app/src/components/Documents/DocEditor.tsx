import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { DocumentDetail, DocStatus } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { useIsDark } from "@/hooks/useIsDark";
import { parseDbTimestamp } from "@/lib/dbTime";
import { PinIcon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Check, Link2, Maximize2, Minimize2, Search } from "lucide-react";
import { RawMarkdownEditor } from "./RawMarkdownEditor";
import type { SaveStatus } from "./useDocumentEditor";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useSettingsStore } from "@/store/settingsStore";
import { DocumentPasswordDialog } from "./DocumentPasswordDialog";
import { DocumentPreviewScrollArea } from "./DocumentPreviewScrollArea";
import { DocumentContentSearch } from "./DocumentContentSearch";
import { useDocEditorContent } from "./hooks/useDocEditorContent";
import { useDocEditorLinks } from "./hooks/useDocEditorLinks";
import { useDocEditorAttachments } from "./hooks/useDocEditorAttachments";
import { BlockTemplatesMenu } from "./BlockTemplatesMenu";
import { DocumentScrollOutline } from "./DocumentOutline";
import { exportEditorHtml, exportEditorPdf } from "@/lib/documentExport";
import { DocumentHistoryModal } from "./DocumentHistoryModal";
import type { DocumentRevision } from "@/lib/documentRevisions";
import { DocumentToolbarActions } from "./DocumentToolbarActions";
import { DocumentChromeToggle } from "./DocumentChromeToggle";
import { DocumentTagBar } from "./DocumentTagBar";
import { DocumentStatusBar } from "./DocumentStatusBar";
import { DocumentUndoRedoControls } from "./DocumentUndoRedoControls";
import { contentToBlocksOffThread } from "@/lib/documentWorkerClient";
import { withTrailingEditorParagraph } from "./trailingEditorParagraph";
import { LazyTiptapDocumentEditor } from "./tiptap/LazyTiptapDocumentEditor";
import type { Block } from "./tiptap/blocks";
import { liftMermaid } from "./mermaidTransforms";

interface Props {
  doc: DocumentDetail;
  onSave: (content: string, contentText: string, wordCount: number) => Promise<void>;
  onDirty: () => void;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string[]) => void;
  onStatusChange: (status: DocStatus) => void;
  onPinToggle: () => void;
  saveStatus: SaveStatus;
  zenMode: boolean;
  onZenModeChange: (enabled: boolean) => void;
}

export function DocEditor({ doc, onSave, onDirty, onTitleChange, onTagsChange, onStatusChange, onPinToggle, saveStatus, zenMode, onZenModeChange }: Props) {
  const t = useT();
  const isDark = useIsDark();
  const documentFontSize = useSettingsStore((state) => state.documentFontSize);
  const setDocumentFontSize = useSettingsStore((state) => state.setDocumentFontSize);
  const [title, setTitle] = useState(doc.title);
  const titleRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const searchRootRef = useRef<HTMLDivElement>(null);
  // Phone-only: the search/toolbar stack is ~half the readable area on
  // a narrow screen, so it starts folded away. Ignored at `lg` (see
  // DocumentChromeToggle), where the chrome always renders.
  const [chromeOpen, setChromeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const content = useDocEditorContent(doc, onSave, onDirty);
  const {
    editor, setEditor, initialBlocks, uploadFile,
    mode, rawMarkdown, switchingMode, richLoading, switchMode, handleChange, handleRawChange, scheduleSave,
  } = content;

  const links = useDocEditorLinks({ documentId: doc.id, documentContent: doc.content, editor, scheduleSave });
  const attachments = useDocEditorAttachments({ doc, editor, scheduleSave });

  const handleTitleBlur = () => {
    const val = title.trim() || t("doc.untitled");
    setTitle(val);
    onTitleChange(val);
  };

  return (
    <div
      className="tanwords-editor-chrome relative flex h-full flex-col"
    >
      {/* Compact two-row document header. On phones the title gets its own
        * line and controls move below it instead of squeezing it to a sliver. */}
      <div className="shrink-0 border-b border-border/60 bg-background/85 px-3 py-3 backdrop-blur-xl lg:px-8 lg:py-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2">
          <input
            ref={titleRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); titleRef.current?.blur(); } }}
            placeholder={t("doc.untitled")}
            className="document-editor-title min-w-0 bg-transparent font-bold tracking-tight text-foreground outline-hidden placeholder:text-muted-foreground/30"
          />
          <DocumentChromeToggle open={chromeOpen} onToggle={() => setChromeOpen((v) => !v)} />
          <div className="col-span-2 ml-auto flex h-9 items-center rounded-xl border border-border/60 bg-muted/25 p-0.5 shadow-xs lg:col-span-1 lg:col-start-2 lg:row-start-1">
            {mode === "rich" && <DocumentUndoRedoControls editor={editor} />}
            <Button
              variant="ghost"
              onClick={onPinToggle}
              title={doc.pinned ? t("doc.unpin") : t("doc.pin")}
              aria-label={doc.pinned ? t("doc.unpin") : t("doc.pin")}
              className={`h-8 w-8 shrink-0 rounded-lg p-0 ${
                doc.pinned ? "bg-amber-500/10 text-amber-500 hover:bg-amber-500/10" : "text-muted-foreground"
              }`}
            >
              <PinIcon filled={doc.pinned} className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onZenModeChange(!zenMode)}
              title={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
              aria-label={zenMode ? t("doc.exitZenMode") : t("doc.zenMode")}
              className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground"
            >
              {zenMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className={`${chromeOpen ? "flex" : "hidden"} mt-3 min-w-0 items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-1.5 py-1 lg:flex`}>
          <div className="min-w-0 flex-1 overflow-hidden">
            <DocumentToolbarActions
              mode={mode}
              switching={switchingMode}
              onMode={(nextMode) => void switchMode(nextMode)}
              onAttach={() => attachmentInputRef.current?.click()}
              onInsertLink={() => links.setLinkPickerOpen(true)}
              templatesMenu={editor ? <BlockTemplatesMenu editor={editor} /> : null}
              onHistory={() => setHistoryOpen(true)}
              onExportHtml={() => editor && void exportEditorHtml(editor, doc.title).catch((error) => toast.error(String(error)))}
              onExportPdf={() => editor && void exportEditorPdf(editor, doc.title).catch((error) => toast.error(String(error)))}
              documentFontSize={documentFontSize}
              onFontSizeChange={setDocumentFontSize}
            />
          </div>
          {mode === "rich" && (
            <DocumentContentSearch
              rootRef={searchRootRef}
              className="h-8 w-36 min-w-0 shrink-0 rounded-lg bg-background/75 shadow-none ring-1 ring-border/50 sm:w-56 lg:w-72"
            />
          )}
        </div>
        {/* Metadata strip: status then tags, on their own row under the
          * toolbar. It sat beside the title first, where it had no width to
          * live in — the status control and the tag chips fought each other
          * for the same sliver. Down here the row is the header's full width,
          * so chips wrap instead of pushing the add box off the edge.
          * Reaching the editor at all means the document is unlocked
          * (LockedDocumentPanel stands in otherwise), so both are editable. */}
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <DocumentStatusBar status={doc.status} onChange={onStatusChange} />
          <DocumentTagBar tags={doc.tags} onChange={onTagsChange} />
        </div>
        <input ref={attachmentInputRef} type="file" className="hidden"
          onChange={(event) => { void attachments.insertAttachment(event.target.files?.[0]); event.target.value = ""; }} />
      </div>

      {mode === "rich" ? (
        <div ref={searchRootRef} className="contents">
          <div className="flex min-h-0 flex-1">
            <DocumentPreviewScrollArea
              onClickCapture={links.handleEditorClick}
              renderOverlay={(viewportRef) => editor
                ? <DocumentScrollOutline editor={editor} viewportRef={viewportRef} />
                : null}
            >
              {richLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 z-10">
                  <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                </div>
              )}
              {initialBlocks && (
                <LazyTiptapDocumentEditor
                  key={`${doc.id}-${mode}`}
                  initialBlocks={initialBlocks as Block[]}
                  isDark={isDark}
                  onUploadFile={uploadFile}
                  onReady={setEditor}
                  onError={(message) => toast.error(message)}
                  onChange={handleChange}
                  toolbarExtras={attachments.renderToolbarExtras}
                  className="tanwords-editor"
                />
              )}
            </DocumentPreviewScrollArea>
          </div>
        </div>
      ) : richLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : (
        <RawMarkdownEditor
          value={rawMarkdown}
          onChange={handleRawChange}
          label={t("doc.rawMode")}
          placeholderText={t("doc.rawPlaceholder")}
          onUploadFile={attachments.uploadFile}
        />
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
      <div className="px-4 lg:px-12 py-2.5 border-t border-border flex flex-wrap items-center gap-3 text-[10px] font-mono tabular-nums text-muted-foreground shrink-0">
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
            if (!editor) return;
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
