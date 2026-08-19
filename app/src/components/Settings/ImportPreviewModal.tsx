import React, { useMemo, useState } from "react";
import { useT } from "@/hooks/useT";
import { Button } from "@/components/ui/button";
import {
  ImportDecisions,
  ImportGroup,
  ImportKind,
  ImportPlan,
  ImportProgress,
} from "@/hooks/useDB.types";

const KIND_LABEL: Record<ImportKind, string> = {
  words: "settings.importDBKindWords",
  patterns: "settings.importDBKindPatterns",
  articles: "settings.importDBKindArticles",
  documents: "settings.importDBKindDocuments",
  knownWords: "settings.importDBKindKnownWords",
};

/** A group is worth rendering only if it would actually do something. */
function isEmpty(group: ImportGroup) {
  return group.newCount === 0 && group.conflicts.length === 0;
}

export function ImportPreviewModal({
  plan,
  importing,
  progress,
  onCancel,
  onConfirm,
  t,
}: {
  plan: ImportPlan;
  importing: boolean;
  progress: ImportProgress | null;
  onCancel: () => void;
  onConfirm: (decisions: ImportDecisions) => void;
  t: ReturnType<typeof useT>;
}) {
  // Keys chosen for overwrite, per group. Absent = skip, which is the safe
  // default and needs no initialisation.
  const [selected, setSelected] = useState<Partial<Record<ImportKind, Set<string>>>>({});

  const groups = useMemo(() => plan.groups.filter((g) => !isEmpty(g)), [plan.groups]);
  const totalNew = groups.reduce((sum, g) => sum + g.newCount, 0);
  const totalConflicts = groups.reduce((sum, g) => sum + g.conflicts.length, 0);
  const totalSelected = groups.reduce(
    (sum, g) => sum + (selected[g.kind]?.size ?? 0),
    0
  );

  const toggle = (kind: ImportKind, key: string) => {
    setSelected((prev) => {
      const next = new Set(prev[kind] ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [kind]: next };
    });
  };

  const setGroup = (group: ImportGroup, all: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [group.kind]: all ? new Set(group.conflicts.map((c) => c.key)) : new Set<string>(),
    }));
  };

  const confirm = () => {
    const overwrite: Partial<Record<ImportKind, string[]>> = {};
    for (const group of groups) {
      const keys = selected[group.kind];
      if (keys && keys.size > 0) overwrite[group.kind] = [...keys];
    }
    onConfirm({ overwrite, includeNew: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-background shadow-xl">
        <div className="shrink-0 border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t("settings.importDBTitle")}</h2>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={plan.sourcePath}>
            {t("settings.importDBFrom")}: {plan.sourcePath}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("settings.importDBNothing")}
            </p>
          ) : (
            <div className="space-y-5">
              {groups.map((group) => {
                const chosen = selected[group.kind] ?? new Set<string>();
                return (
                  <section key={group.kind}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <h3 className="text-xs font-semibold text-foreground">
                          {t(KIND_LABEL[group.kind])}
                        </h3>
                        {group.newCount > 0 && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            {t("settings.importDBNew", { n: group.newCount })}
                          </span>
                        )}
                        {group.conflicts.length > 0 && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {t("settings.importDBConflicts", { n: group.conflicts.length })}
                          </span>
                        )}
                      </div>
                      {group.conflicts.length > 0 && (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={() => setGroup(group, true)}
                            className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {t("settings.importDBSelectAll")}
                          </button>
                          <button
                            onClick={() => setGroup(group, false)}
                            className="rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {t("settings.importDBSelectNone")}
                          </button>
                        </div>
                      )}
                    </div>

                    {group.conflicts.length > 0 && (
                      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-lg border border-border">
                        {group.conflicts.map((conflict) => (
                          <li key={conflict.key}>
                            <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-muted/50">
                              <input
                                type="checkbox"
                                checked={chosen.has(conflict.key)}
                                onChange={() => toggle(group.kind, conflict.key)}
                                className="mt-1 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-foreground" title={conflict.title}>
                                  {conflict.title}
                                </div>
                                <div className="mt-0.5 grid gap-0.5 text-[11px] text-muted-foreground sm:grid-cols-2">
                                  <span className="truncate" title={conflict.existing}>
                                    {t("settings.importDBExisting")}: {conflict.existing || "—"}
                                  </span>
                                  <span className="truncate text-primary" title={conflict.incoming}>
                                    {t("settings.importDBIncoming")}: {conflict.incoming || "—"}
                                  </span>
                                </div>
                              </div>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="shrink-0 space-y-2 border-t border-border px-5 py-4">
          {importing && progress && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {t(KIND_LABEL[progress.step])} ({progress.stepIndex}/{progress.stepTotal})
                  {progress.total > 0 && ` · ${progress.done}/${progress.total}`}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      ((progress.stepIndex - 1 + (progress.total > 0 ? progress.done / progress.total : 0)) /
                        progress.stepTotal) *
                        100
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}
          {totalConflicts > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("settings.importDBOverwriteHint")} {t("settings.importDBSrsNote")}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {t("settings.importDBNew", { n: totalNew })}
              {totalConflicts > 0 && ` · ${totalSelected}/${totalConflicts}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={onCancel}
                disabled={importing}
                className="h-8 rounded-lg px-3 text-xs font-medium border border-input hover:bg-muted disabled:opacity-50"
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={confirm}
                disabled={importing || groups.length === 0}
                className="h-8 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {importing ? t("settings.importDBImporting") : t("settings.importDBConfirm")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
