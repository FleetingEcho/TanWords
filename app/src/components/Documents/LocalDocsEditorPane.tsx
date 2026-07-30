import React from "react";
import { useT } from "@/hooks/useT";
import { LazyLocalDocEditor } from "./LazyLocalDocEditor";
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
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
          <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.2" className="w-14 h-14 opacity-20">
            <path d="M6 12a3 3 0 013-3h8l4 4h18a3 3 0 013 3v20a3 3 0 01-3 3H9a3 3 0 01-3-3V12z" strokeLinejoin="round" />
            <path d="M18 24h12M18 30h8" strokeLinecap="round" />
          </svg>
          <p className="text-sm">{t("doc.noFileSelected")}</p>
          <p className="text-xs opacity-60">{t("doc.noFileHint")}</p>
        </div>
      )}
    </div>
  );
});
