import React from "react";
import { useT } from "@/hooks/useT";
import { LazyLocalDocEditor } from "./LazyLocalDocEditor";
import { EmptyCanvas } from "@/components/shared/EmptyCanvas";
import { SaveStatus } from "./useDocumentEditor";

interface Props {
  editorKey: number;
  loading: boolean;
  activePath: string | null;
  activeContent: string | null;
  activeRawContent: string | null;
  modifiedMs: number;
  saveStatus: SaveStatus;
  onSave: (markdown: string) => Promise<void>;
  onDirty: () => void;
  onUploadImage: (file: File) => Promise<string>;
  toRawMarkdown: (markdown: string) => string;
  toDisplayMarkdown: (markdown: string) => string;
  onRename: (newName: string) => void;
  zenMode: boolean;
  onZenModeChange: (zen: boolean) => void;
}

export const LocalDocsEditorPane = React.memo(function LocalDocsEditorPane({
  editorKey,
  loading,
  activePath,
  activeContent,
  activeRawContent,
  modifiedMs,
  saveStatus,
  onSave,
  onDirty,
  onUploadImage,
  toRawMarkdown,
  toDisplayMarkdown,
  onRename,
  zenMode,
  onZenModeChange,
}: Props) {
  const t = useT();

  return (
    <div className="flex-1 overflow-hidden">
      {activePath !== null && activeContent !== null && activeRawContent !== null ? (
        <LazyLocalDocEditor
          key={editorKey}
          relPath={activePath}
          initialMarkdown={activeContent}
          initialRawMarkdown={activeRawContent}
          modifiedMs={modifiedMs}
          saveStatus={saveStatus}
          onSave={onSave}
          onDirty={onDirty}
          onUploadImage={onUploadImage}
          toRawMarkdown={toRawMarkdown}
          toDisplayMarkdown={toDisplayMarkdown}
          onRename={onRename}
          zenMode={zenMode}
          onZenModeChange={onZenModeChange}
        />
      ) : loading ? (
        <div className="flex items-center justify-center h-full">
          <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : (
        // Same surface, same condition as the library tab's empty editor pane
        // (see DocumentsPage) — so the same backdrop, rather than the tinted
        // folder icon this half used to carry on its own.
        <EmptyCanvas title={t("doc.noFileSelected")} body={t("doc.noFileHint")} />
      )}
    </div>
  );
});
