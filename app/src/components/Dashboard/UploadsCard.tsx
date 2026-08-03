import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { CloseIcon } from "@/components/ui/icons";
import { AssetDropzone } from "@/components/shared/AssetDropzone";
import { DocumentImageManager } from "@/components/Documents/DocumentImageManager";
import { useStandaloneUpload } from "@/hooks/useStandaloneUpload";

/** Drop files straight from the dashboard, and open the same asset manager the
 *  Documents page uses to manage them — in place, rather than navigating to
 *  Docs and hunting for the button there. */
export function UploadsCard() {
  const t = useT();
  const [managerOpen, setManagerOpen] = useState(false);
  const { uploading, progress, uploadFiles } = useStandaloneUpload();

  return (
    <>
      <div className="flex flex-wrap items-stretch gap-3">
        <AssetDropzone
          variant="card"
          onFiles={uploadFiles}
          busy={uploading}
          progress={progress}
          className="min-w-64 flex-1"
        />
        <Button
          variant="ghost"
          onClick={() => setManagerOpen(true)}
          className="flex h-auto shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-border bg-card px-5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary max-sm:w-full max-sm:flex-row max-sm:py-3"
        >
          <FolderOpen className="h-5 w-5" />
          {t("dash.uploads.manage")}
        </Button>
      </div>

      <Dialog
        open={managerOpen}
        onClose={() => setManagerOpen(false)}
        maxWidth="max-w-[min(94vw,1280px)]"
        className="top-[4vh] h-[88vh] overflow-hidden"
      >
        <DialogTitle className="sr-only">{t("doc.manageDatabaseImages")}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setManagerOpen(false)}
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
          title={t("common.close")}
        >
          <CloseIcon className="h-4 w-4" />
        </Button>
        <DocumentImageManager writable />
      </Dialog>
    </>
  );
}
