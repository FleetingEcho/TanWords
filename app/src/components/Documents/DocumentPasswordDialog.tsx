import { FormEvent, useEffect, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/hooks/useT";

export interface DocumentPasswordRequest {
  title: string;
  description: string;
  confirm?: boolean;
}

export function DocumentPasswordDialog({
  request,
  onCancel,
  onSubmit,
}: {
  request: DocumentPasswordRequest | null;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!request) return;
    setPassword("");
    setConfirmation("");
    setError("");
  }, [request]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!password) return;
    if (request?.confirm && password !== confirmation) {
      setError(t("doc.passwordsDoNotMatch"));
      return;
    }
    onSubmit(password);
  };

  return (
    <Dialog open={request !== null} onClose={onCancel} maxWidth="max-w-sm">
      <form onSubmit={submit} className="p-6">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LockKeyhole className="h-5 w-5" />
        </div>
        <DialogTitle className="text-base font-semibold">{request?.title}</DialogTitle>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{request?.description}</p>

        <label className="mt-5 block text-xs font-medium text-foreground">
          {t("doc.password")}
          <input
            autoFocus
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setError("");
            }}
            className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-primary/30"
          />
        </label>

        {request?.confirm && (
          <label className="mt-3 block text-xs font-medium text-foreground">
            {t("doc.confirmPassword")}
            <input
              type="password"
              value={confirmation}
              onChange={(event) => {
                setConfirmation(event.target.value);
                setError("");
              }}
              className="mt-1.5 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus:ring-2 focus:ring-primary/30"
            />
          </label>
        )}

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("doc.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={!password || Boolean(request?.confirm && !confirmation)}
          >
            {request?.confirm ? t("doc.protect") : t("doc.continue")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
