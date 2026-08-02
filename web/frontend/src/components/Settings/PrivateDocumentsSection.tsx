import { FormEvent, useEffect, useState } from "react";
import { invoke } from "@/api/client";
import { LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { SettingRow } from "./SettingsShared";

type Status = {
  configured: boolean;
  unlocked: boolean;
  legacy_documents: number;
};

export function PrivateDocumentsSection() {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => invoke<Status>("db_private_password_status").then(setStatus);
  useEffect(() => { void load(); }, []);

  const close = () => {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword || newPassword !== confirmation) return;
    setSaving(true);
    try {
      await invoke("db_change_document_password", { currentPassword, newPassword });
      toast.success(t("settings.privatePasswordChanged"));
      close();
      await load();
    } catch {
      toast.error(t("doc.invalidPassword"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingRow
        label={t("settings.privatePassword")}
        sub={status?.legacy_documents
          ? t("settings.privatePasswordLegacy", { n: status.legacy_documents })
          : status?.configured
            ? t("settings.privatePasswordSub")
            : t("settings.privatePasswordNotSet")}
      >
        <Button
          variant="outline"
          disabled={!status || (!status.configured && status.legacy_documents === 0)}
          onClick={() => setOpen(true)}
          className="h-8 gap-2 rounded-lg px-3 text-xs"
        >
          <LockKeyhole className="h-3.5 w-3.5" />
          {t("settings.changePrivatePassword")}
        </Button>
      </SettingRow>

      <Dialog open={open} onClose={close} maxWidth="max-w-sm">
        <form onSubmit={submit} className="p-6">
          <DialogTitle className="text-base font-semibold">
            {t("settings.changePrivatePassword")}
          </DialogTitle>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {t("settings.privatePasswordDialogHint")}
          </p>
          {[
            [t("settings.currentPassword"), currentPassword, setCurrentPassword],
            [t("settings.newPassword"), newPassword, setNewPassword],
            [t("doc.confirmPassword"), confirmation, setConfirmation],
          ].map(([label, value, setter]) => (
            <label key={label as string} className="mt-4 block text-xs font-medium">
              {label as string}
              <input
                type="password"
                value={value as string}
                onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                autoComplete="off"
                className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-primary/30"
              />
            </label>
          ))}
          {confirmation && confirmation !== newPassword && (
            <p className="mt-2 text-xs text-destructive">{t("doc.passwordsDoNotMatch")}</p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t("doc.cancel")}</Button>
            <Button type="submit" disabled={saving || !currentPassword || !newPassword || newPassword !== confirmation}>
              {saving ? t("settings.saving") : t("settings.changePrivatePassword")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
