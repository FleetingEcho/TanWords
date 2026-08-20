import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff } from "lucide-react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/formatBytes";
import { RefreshCw } from "lucide-react";
import { connectR2, disconnectR2, getR2Status, getR2Usage, setR2AlwaysUpload, type R2Status, type R2Usage } from "@/lib/documentAssets";

const FIELD_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-3 text-xs outline-hidden focus:ring-2 focus:ring-primary/30";

/** Cloudflare R2 as the store for large uploads.
 *
 *  Lives beside the Postgres panel because it answers the same question — "where
 *  does my data go" — but it is a *different* store: the database holds rows,
 *  the bucket holds bytes. A large multi-megabyte blob
 *  outright (SQLITE_NOMEM), which is what this exists to route around. */
export function R2Section() {
  const t = useT();
  const [status, setStatus] = useState<R2Status | null>(null);
  const [usage, setUsage] = useState<R2Usage | null>(null);
  const [usageBusy, setUsageBusy] = useState(false);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [bucket, setBucket] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  const load = () => {
    getR2Status()
      .then((next) => {
        setStatus(next);
        setAccountId(next.account_id);
        setBucket(next.bucket);
        setAccessKeyId(next.access_key_id);
        setPublicBaseUrl(next.public_base_url ?? "");
      })
      .catch(() => setStatus(null));
  };
  useEffect(load, []);

  const loadUsage = () => {
    setUsageBusy(true);
    setUsageError(null);
    getR2Usage()
      .then((next) => { setUsage(next); setUsageError(null); })
      .catch((error) => {
        setUsage(null);
        setUsageError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setUsageBusy(false));
  };
  // Only once the bucket is known to be connected: the command errors out
  // otherwise, and listing costs a Class A operation.
  useEffect(() => {
    if (status?.configured) loadUsage();
  }, [status?.configured]);

  const connect = async () => {
    setBusy(true);
    try {
      await connectR2({ accountId, bucket, accessKeyId, secretAccessKey, publicBaseUrl });
      toast.success(t("settings.r2Connected"));
      setSecretAccessKey("");
      setOpen(false);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await disconnectR2();
      toast.success(t("settings.r2Disconnected"));
      setSecretAccessKey("");
      load();
    } finally {
      setBusy(false);
    }
  };

  const configured = status?.configured ?? false;
  // Both lengths are evidenced, not guessed: R2 itself rejects a short key
  // with "should be 32", and its secret is the SHA-256 of the token value, so
  // always 64 hex. The common mistake is pasting the ~40-character *token
  // value* into the secret field, which fails much later as
  // SignatureDoesNotMatch.
  const keyLooksWrong = accessKeyId.trim().length > 0 && accessKeyId.trim().length !== 32;
  const secretLooksWrong = secretAccessKey.trim().length > 0 && secretAccessKey.trim().length !== 64;

  return (
    <div className="bg-card border border-border rounded-xl px-5 py-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            {configured ? <Cloud className="h-4 w-4 text-primary" /> : <CloudOff className="h-4 w-4 text-muted-foreground" />}
            {t("settings.r2Title")}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground/75">{t("settings.r2ScopeNote")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {configured
              ? status?.always_upload
                ? t("settings.r2ConnectedAll", { bucket: status?.bucket ?? "" })
                : t("settings.r2ConnectedTo", {
                    bucket: status?.bucket ?? "",
                    size: formatBytes(status?.threshold_bytes ?? 0),
                  })
              : t("settings.r2Sub")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void disconnect()}
              className="h-8 rounded-lg px-3 text-xs"
            >
              {t("settings.r2Disconnect")}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
            className="h-8 rounded-lg px-3 text-xs"
          >
            {configured ? t("settings.r2Edit") : t("settings.r2Connect")}
          </Button>
        </div>
      </div>

      {status?.configured && (
        <label className="flex items-start justify-between gap-3 border-t border-border pt-3">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium">{t("settings.r2AlwaysTitle")}</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {status.always_upload
                ? t("settings.r2AlwaysOn")
                : t("settings.r2AlwaysOff", { size: formatBytes(status.threshold_bytes) })}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={status.always_upload}
            onClick={() => {
              const next = !status.always_upload;
              setStatus({ ...status, always_upload: next });
              setR2AlwaysUpload(next).then(load).catch((error) => {
                toast.error(error instanceof Error ? error.message : String(error));
                load();
              });
            }}
            className={`relative mt-0.5 h-[18px] w-8 shrink-0 rounded-full transition-colors ${
              status.always_upload ? "bg-primary" : "bg-muted-foreground/30"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-all ${
                status.always_upload ? "left-[calc(100%-1rem)]" : "left-0.5"
              }`}
            />
          </button>
        </label>
      )}

      {status?.configured && usageError && (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          <span className="min-w-0 flex-1 text-destructive">{usageError}</span>
          <Button
            variant="ghost"
            size="icon"
            disabled={usageBusy}
            onClick={loadUsage}
            title={t("settings.documentImagesRefresh")}
            className="h-7 w-7 shrink-0 text-muted-foreground"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${usageBusy ? "animate-spin" : ""}`} />
          </Button>
        </div>
      )}

      {status?.configured && usage && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              {t("settings.r2Usage", {
                used: formatBytes(usage.used_bytes),
                total: formatBytes(usage.limit_bytes),
              })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              disabled={usageBusy}
              onClick={loadUsage}
              title={t("settings.documentImagesRefresh")}
              className="h-7 w-7 text-muted-foreground"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${usageBusy ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all ${
                usage.used_bytes >= usage.block_at_bytes ? "bg-destructive" : "bg-primary"
              }`}
              style={{ width: `${Math.min(100, (usage.used_bytes / usage.limit_bytes) * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground/75">
            {usage.used_bytes >= usage.block_at_bytes
              ? t("settings.r2UsageBlocked", { limit: formatBytes(usage.block_at_bytes) })
              : t("settings.r2UsageHint", { limit: formatBytes(usage.block_at_bytes) })}
          </p>
        </div>
      )}

      {open && (
        <div className="space-y-2.5 border-t border-border pt-3">
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("settings.r2AccountId")}</span>
            <input value={accountId} onChange={(e) => setAccountId(e.target.value)} className={FIELD_CLASS} placeholder="a1b2c3…" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("settings.r2Bucket")}</span>
            <input value={bucket} onChange={(e) => setBucket(e.target.value)} className={FIELD_CLASS} placeholder="tanwords" />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("settings.r2AccessKeyId")}</span>
            <input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} className={FIELD_CLASS} placeholder={t("settings.r2AccessKeyIdHint")} />
            {keyLooksWrong && (
              <span className="mt-1 block text-[11px] text-destructive">{t("settings.r2AccessKeyIdWrong")}</span>
            )}
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("settings.r2SecretKey")}</span>
            <input
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              className={FIELD_CLASS}
              placeholder={configured ? t("settings.r2SecretKept") : t("settings.r2SecretKeyHint")}
            />
            {secretLooksWrong && (
              <span className="mt-1 block text-[11px] text-destructive">{t("settings.r2SecretKeyWrong")}</span>
            )}
          </label>
          <label className="block text-xs">
            <span className="mb-1 block text-muted-foreground">{t("settings.r2PublicUrl")}</span>
            <input
              value={publicBaseUrl}
              onChange={(e) => setPublicBaseUrl(e.target.value)}
              className={FIELD_CLASS}
              placeholder="https://files.example.com"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground/75">{t("settings.r2PublicUrlSub")}</span>
          </label>
          <div className="flex justify-end">
            <Button
              onClick={() => void connect()}
              disabled={busy || !accountId.trim() || !bucket.trim() || !accessKeyId.trim() || !secretAccessKey.trim()}
              className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {busy ? t("settings.r2Testing") : t("settings.r2SaveAndTest")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
