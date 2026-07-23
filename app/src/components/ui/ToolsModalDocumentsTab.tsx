import { useT } from "@/hooks/useT";
import { DocSelector } from "@/components/Documents/DocSelector";
import { LazyDocEditor } from "@/components/Documents/LazyDocEditor";
import { useDocumentEditor } from "@/components/Documents/useDocumentEditor";

interface ToolsModalDocumentsTabProps {
  active: boolean;
  docEditor: ReturnType<typeof useDocumentEditor>;
}

/** Documents tab body: DocSelector sidebar + BlockNote editor area. */
export function ToolsModalDocumentsTab({ active, docEditor }: ToolsModalDocumentsTabProps) {
  const t = useT();

  return (
    <div style={{ display: active ? "flex" : "none", height: "100%" }} className="overflow-hidden">
      {/* DocSelector sidebar */}
      <div className="shrink-0 h-full border-r border-border">
        <DocSelector
          activeId={docEditor.activeId}
          onSelect={docEditor.loadDoc}
          onNewDoc={docEditor.handleNewDoc}
          refreshKey={docEditor.refreshKey}
        />
      </div>
      {/* Editor area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {docEditor.doc ? (
          <LazyDocEditor
            key={docEditor.doc.id}
            doc={docEditor.doc}
            onSave={docEditor.handleSave}
            onTitleChange={docEditor.handleTitleChange}
            onTagsChange={docEditor.handleTagsChange}
            onPinToggle={docEditor.handlePinToggle}
            saveStatus={docEditor.saveStatus}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <p className="text-sm">{t("doc.noDocSelected")}</p>
            <p className="text-xs opacity-60">{t("doc.noDocHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
