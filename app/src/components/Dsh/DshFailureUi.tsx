import { useEffect, useState } from "react";
import { BookOpen, Check, Copy, ExternalLink, RefreshCw, RotateCcw } from "lucide-react";
import { openExternal } from "@/ipc/shell";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTitle } from "@/components/ui/dialog";

/** The modal shown when the DSH host fails to start. Shows the error, a port
 *  input (so the user can fix a bad/in-use port inline), and Retry / Apply &
 *  Restart actions. Built on the shared `Dialog`, which mounts
 *  `DshPanelBlocker` so the native DSH view steps aside for the modal. */
function DshFailedModal({
  open, error, currentPort, onApplyPort, onRetry, onDismiss,
}: {
  open: boolean;
  error: string | null;
  currentPort: number;
  onApplyPort: (port: number) => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  // Local draft of the port. Pre-fill with the current setting; 0 renders as
  // empty so the "Auto" placeholder shows (mirrors DshPortSetting in Settings).
  const [draft, setDraft] = useState(currentPort === 0 ? "" : String(currentPort));
  useEffect(() => {
    setDraft(currentPort === 0 ? "" : String(currentPort));
  }, [currentPort]);

  const apply = () => {
    const n = Number(draft);
    onApplyPort(Number.isFinite(n) && n > 0 ? Math.min(65535, Math.floor(n)) : 0);
  };

  return (
    <Dialog open={open} onClose={onDismiss} maxWidth="max-w-md">
      <div className="p-5 space-y-4">
        <DialogTitle className="text-sm font-semibold text-destructive">
          {t("dsh.failed")}
        </DialogTitle>
        {error && (
          <p className="text-xs text-muted-foreground leading-relaxed break-words">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="dsh-port-input">
            {t("settings.dshPort")}
          </label>
          <input
            id="dsh-port-input"
            type="number"
            min={0}
            max={65535}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
            placeholder={t("settings.dshPortAuto")}
            className="w-full h-9 px-3 rounded-lg border border-input bg-background text-sm focus:outline-hidden focus:ring-2 focus:ring-primary/30"
          />
          <p className="text-xs text-muted-foreground">{t("dsh.portHint")}</p>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
        <Button
          variant="ghost"
          onClick={onDismiss}
          className="h-8 px-4 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          {t("dsh.dismiss")}
        </Button>
        <Button
          variant="ghost"
          onClick={onRetry}
          className="h-8 px-4 rounded-lg text-xs font-semibold bg-muted text-foreground hover:bg-muted/80 transition-colors"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          {t("dsh.retry")}
        </Button>
        <Button
          variant="ghost"
          onClick={apply}
          className="h-8 px-4 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
          {t("dsh.applyAndRestart")}
        </Button>
      </div>
    </Dialog>
  );
}

const DSH_GITHUB_URL = "https://github.com/deepseek-ai/deepseek-harness";
const DSH_INSTALL_CMD = "npm i -g @deepseek-ai/dsh";
const DSH_UPGRADE_CMD = "npm update -g @deepseek-ai/dsh";
const DSH_VERIFY_CMD = "dsh --version";

/** A small clipboard-copy button with transient "Copied" feedback. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // clipboard may be unavailable (no user gesture / insecure context) —
          // the command is still visible to type by hand.
        }
      }}
      className="absolute right-1.5 top-1.5 flex h-6 items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? t("dsh.notInstalledCopied") : label}</span>
    </button>
  );
}

/** A single labeled command block with a copy button. */
function CommandBlock({ text, copyLabel }: { text: string; copyLabel: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 px-3 py-2 pr-16 font-mono text-xs leading-relaxed text-foreground">
        <code>{text}</code>
      </pre>
      <CopyButton text={text} label={copyLabel} />
    </div>
  );
}

/** Inline guidance shown when the supervised `dsh` host can't start because the
 *  `dsh` CLI isn't installed. This is a setup guide, not an error: the user
 *  hasn't installed DSH yet, so we point them at the official source and the
 *  install/upgrade commands, then offer a retry once they've installed it.
 *  Rendered in place of (not as a modal over) the DSH view, so it doesn't need
 *  the DshPanelBlocker — no native view is attached when `dsh` is missing. */
function DshNotInstalledGuide({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  const copyLabel = t("dsh.notInstalledCopy");
  return (
    <div className="absolute inset-0 overflow-y-auto bg-background p-6">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{t("dsh.notInstalledTitle")}</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("dsh.notInstalledLead")}
            </p>
          </div>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledPrereq")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledPrereqText")}</p>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledSteps")}
          </h3>
          <ol className="space-y-3">
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep1")}</p>
              <CommandBlock text={DSH_INSTALL_CMD} copyLabel={copyLabel} />
            </li>
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep2")}</p>
              <CommandBlock text={DSH_VERIFY_CMD} copyLabel={copyLabel} />
            </li>
            <li className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("dsh.notInstalledStep3")}</p>
            </li>
          </ol>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledUpgrade")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledUpgradeText")}</p>
          <CommandBlock text={DSH_UPGRADE_CMD} copyLabel={copyLabel} />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("dsh.notInstalledOfficial")}
          </h3>
          <p className="text-xs text-muted-foreground">{t("dsh.notInstalledOfficialText")}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openExternal(DSH_GITHUB_URL)}
              className="h-8"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t("dsh.notInstalledOpenGitHub")}
            </Button>
            <Button size="sm" onClick={onRetry} className="h-8">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              {t("dsh.notInstalledRetry")}
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground/80">
            {t("dsh.notInstalledPathHint")}
          </p>
        </div>
      </div>
    </div>
  );
}

export { DshFailedModal, DshNotInstalledGuide };
