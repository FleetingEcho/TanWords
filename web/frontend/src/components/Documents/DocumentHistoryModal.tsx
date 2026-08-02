import { useMemo } from "react";
import { History, RotateCcw } from "lucide-react";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CloseIcon } from "@/components/ui/icons";
import { useT } from "@/hooks/useT";
import { listDocumentRevisions, type DocumentRevision } from "@/lib/documentRevisions";

interface Props {
  open: boolean;
  documentId?: number;
  revisions?: DocumentRevision[];
  onClose: () => void;
  onRestore: (revision: DocumentRevision) => void;
}

export function DocumentHistoryModal({ open, documentId, revisions, onClose, onRestore }: Props) {
  const t = useT();
  const revisionList = useMemo(
    () => revisions ?? (documentId !== undefined ? listDocumentRevisions(documentId) : []),
    [documentId, revisions],
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="max-w-lg">
      <div className="relative border-b border-border px-5 py-4">
        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
          <History className="h-4 w-4 text-muted-foreground" />
          {t("doc.historyTitle")}
        </DialogTitle>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="absolute right-3 top-3 h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
      </div>
      <div className="max-h-80 overflow-y-auto p-3">
        {revisionList.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">{t("doc.historyEmpty")}</p>
        ) : (
          <div className="space-y-1">
            {revisionList.map((revision) => (
              <div key={revision.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-muted">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{revision.title || t("doc.untitled")}</p>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {new Date(revision.createdAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  onClick={() => { onRestore(revision); onClose(); }}
                  className="h-7 gap-1.5 rounded-md px-2 text-xs"
                >
                  <RotateCcw className="h-3 w-3" />
                  {t("doc.historyRestore")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
