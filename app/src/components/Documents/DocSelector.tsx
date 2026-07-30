import React, { useEffect, useState } from "react";
import { useT } from "@/hooks/useT";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Button } from "@/components/ui/button";
import { LIST_PANEL_WIDTH } from "@/components/shared/listPanel";
import { ExportMarkdownDialog } from "./ExportMarkdownDialog";
import { DocumentImageManager } from "./DocumentImageManager";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { DocumentPasswordDialog } from "./DocumentPasswordDialog";
import { DocSelectorHeader } from "./DocSelectorHeader";
import { DocShelfList } from "./DocShelfList";
import { useDocList } from "./hooks/useDocList";
import { useDocActions } from "./hooks/useDocActions";
import { useDocImportExport } from "./hooks/useDocImportExport";

interface Props {
  activeId: number | null;
  onSelect: (id: number) => void;
  onNewDoc: () => void;
  refreshKey: number;
  onCollapse?: () => void;
}

export function DocSelector({ activeId, onSelect, onNewDoc, refreshKey, onCollapse }: Props) {
  const t = useT();
  const list = useDocList(refreshKey);
  const { db, page, load, total, totalPages } = list;

  const [imagesOpen, setImagesOpen] = useState(false);
  const [normalOpen, setNormalOpen] = useState(() => localStorage.getItem("tanwords_docs_normal_open") !== "0");
  const [privateOpen, setPrivateOpen] = useState(() => localStorage.getItem("tanwords_docs_private_open") !== "0");
  const [shelfMenu, setShelfMenu] = useState<{ x: number; y: number; private: boolean } | null>(null);

  useEffect(() => {
    if (!shelfMenu) return;
    const dismiss = () => setShelfMenu(null);
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [shelfMenu]);

  const actions = useDocActions({ db, activeId, onSelect, load, page, setPrivateOpen });
  const importExport = useDocImportExport({ db, onSelect, load, requestPassword: actions.requestPassword });

  const createInShelf = (privateShelf: boolean) => {
    setShelfMenu(null);
    if (privateShelf) void actions.handleNewPrivateDoc();
    else onNewDoc();
  };

  return (
    <div className={`flex flex-col h-full border-r border-border ${LIST_PANEL_WIDTH} shrink-0 bg-transparent`}>
      <DocSelectorHeader
        list={list}
        onCollapse={onCollapse}
        onNewDoc={onNewDoc}
        onOpenImages={() => setImagesOpen(true)}
        onImport={() => void importExport.handleImport()}
        onExportAll={() => void importExport.handleExportAll()}
      />

      <DocShelfList
        list={list}
        actions={actions}
        activeId={activeId}
        onSelect={onSelect}
        onExport={(id) => void importExport.exportDocuments([id])}
        normalOpen={normalOpen}
        setNormalOpen={setNormalOpen}
        privateOpen={privateOpen}
        setPrivateOpen={setPrivateOpen}
        shelfMenu={shelfMenu}
        setShelfMenu={setShelfMenu}
        createInShelf={createInShelf}
      />

      <DocumentPasswordDialog
        request={actions.passwordRequest}
        onCancel={() => actions.finishPasswordRequest(null)}
        onSubmit={(password) => actions.finishPasswordRequest(password)}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-3 py-2.5 border-t border-border flex items-center justify-between shrink-0">
          <Button
            variant="ghost"
            disabled={page === 0}
            onClick={() => list.setPage((p) => Math.max(0, p - 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            ←
          </Button>
          <span className="text-[10px] text-muted-foreground">
            {t("doc.page", { n: page + 1 })} / {totalPages}
            <span className="ml-1 opacity-60">({t("doc.total", { n: total })})</span>
          </span>
          <Button
            variant="ghost"
            disabled={page >= totalPages - 1}
            onClick={() => list.setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-auto text-xs px-2 py-1 rounded border border-border disabled:opacity-30 hover:bg-muted transition-colors"
          >
            →
          </Button>
        </div>
      )}

      <Dialog
        open={imagesOpen}
        onClose={() => setImagesOpen(false)}
        maxWidth="max-w-[min(94vw,1280px)]"
        className="top-[4vh] h-[88vh] overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("doc.manageDatabaseImages")}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setImagesOpen(false)}
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur"
          title={t("common.close")}
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
        <DocumentImageManager writable />
      </Dialog>

      <ConfirmModal
        open={actions.pendingDeleteId !== null}
        title={t("doc.deleteDocTitle")}
        message={t("doc.deleteConfirm")}
        confirmLabel={t("doc.delete")}
        onCancel={() => actions.setPendingDeleteId(null)}
        onConfirm={actions.confirmDelete}
      />
      <ExportMarkdownDialog
        open={importExport.exportChoices !== null}
        items={importExport.exportChoices ?? []}
        onClose={() => importExport.setExportChoices(null)}
        onExport={(ids) => {
          importExport.setExportChoices(null);
          void importExport.exportDocuments(ids.map(Number));
        }}
      />
    </div>
  );
}
