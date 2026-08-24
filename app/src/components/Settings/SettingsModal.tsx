import { X } from "lucide-react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { SettingsPage } from "./SettingsPage";

/** Settings overlays the active page/workspace so live pages remain mounted
 *  and the user returns to exactly the same context when it closes. */
export function SettingsModal() {
  const t = useT();
  const open = useNavStore((state) => state.settingsOpen);
  const closeSettings = useNavStore((state) => state.closeSettings);

  return (
    <Dialog
      open={open}
      onClose={closeSettings}
      maxWidth="max-w-6xl"
      className="flex h-[min(92vh,960px)] flex-col overflow-hidden"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <DialogTitle className="text-sm font-semibold">{t("nav.settings")}</DialogTitle>
        <Button
          variant="ghost"
          size="icon"
          onClick={closeSettings}
          aria-label={t("common.close")}
          title={t("common.close")}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsPage />
      </div>
    </Dialog>
  );
}
