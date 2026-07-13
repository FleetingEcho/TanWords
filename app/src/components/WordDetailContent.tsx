import { Skeleton } from "@/components/ui/Skeleton";
import { ExclamationTriangleIcon } from "@heroicons/react/24/solid";

// ── Skeleton Components ────────────────────────────────────────────────────

export function LoadingSkeleton({ t }: { t: (k: string) => string }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      <p className="text-xs text-center text-muted-foreground">{t("modal.fetching")}</p>
    </div>
  );
}

export function ErrorState({ message, t }: { message: string; t: (k: string) => string }) {
  return (
    <div className="py-8 text-center space-y-3">
      <p className="text-destructive text-sm inline-flex items-center gap-1.5"><ExclamationTriangleIcon className="w-4 h-4" /> {message}</p>
      <p className="text-xs text-muted-foreground">{t("modal.noProviderSub")}</p>
    </div>
  );
}
