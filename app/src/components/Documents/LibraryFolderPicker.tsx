import { useCallback, useEffect, useState } from "react";
import { useDB, type DocumentFolder } from "@/hooks/useDB";
import { useT } from "@/hooks/useT";
import { FolderPicker } from "./FolderPicker";

/** FolderPicker over the library's folders, loaded fresh each time it opens so
 *  a folder made in the sidebar a moment ago is already offered here. */
export function LibraryFolderPicker({ open, title, hint, confirmLabel, onClose, onPick }: {
  open: boolean;
  title: string;
  hint: string;
  confirmLabel: string;
  onClose: () => void;
  onPick: (folder: string) => void;
}) {
  const db = useDB();
  const t = useT();
  const [folders, setFolders] = useState<DocumentFolder[]>([]);

  useEffect(() => {
    if (!open) return;
    void db.listDocumentFolders().then(setFolders);
  }, [open, db]);

  const createFolder = useCallback(async (path: string) => {
    await db.createDocumentFolder(path);
    setFolders(await db.listDocumentFolders());
  }, [db]);

  return (
    <FolderPicker
      open={open}
      title={title}
      hint={hint}
      confirmLabel={confirmLabel}
      rootLabel={t("doc.libraryRoot")}
      folders={folders.map((folder) => folder.path)}
      lockedPaths={new Set(folders.filter((folder) => folder.locked).map((folder) => folder.path))}
      onCreateFolder={createFolder}
      onClose={onClose}
      onPick={onPick}
    />
  );
}
