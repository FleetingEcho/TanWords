import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({ isDesktopHost: true }));

const useDataSectionMock = vi.fn();
vi.mock("./useDataSection", () => ({ useDataSection: (...args: unknown[]) => useDataSectionMock(...args) }));
vi.mock("@/hooks/useDB", () => ({ useDB: vi.fn() }));
vi.mock("@/components/Settings/R2Section", () => ({ R2Section: () => null }));
vi.mock("@/components/Settings/ImportPreviewModal", () => ({ ImportPreviewModal: () => null }));
vi.mock("@/components/Settings/ImportErrorModal", () => ({ ImportErrorModal: () => null }));
vi.mock("@/components/Settings/BackupPasswordDialog", () => ({ BackupPasswordDialog: () => null }));
vi.mock("@/components/Settings/DataSectionDatabaseCard", () => ({ DataSectionDatabaseCard: () => null }));
vi.mock("@/components/Settings/PostgresAccountPasswordDialog", () => ({ PostgresAccountPasswordDialog: () => null }));

import { DataSection } from "./DataSection";

const LABELS: Record<string, string> = {
  "settings.overwriteBackupReminderTitle": "Back up your database first",
  "settings.overwriteBackupReminderMessage": "You're about to replace every row. Back up first!",
  "settings.overwriteBackupReminderBackup": "Back up now",
  "settings.overwriteBackupReminderSkip": "Skip, I have a backup",
  "settings.importOverwriteConfirmTitle": "Replace the active database?",
  "settings.importOverwriteConfirmMessage": "Every row will be erased. Source: {path}",
  "settings.importOverwriteConfirm": "Overwrite",
};

const t = ((key: string, vars?: Record<string, string>) => {
  let s = LABELS[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}) as never;

const PICKED_PATH = "/home/zteng/Downloads/replacement.db";

function baseData(overrides: Record<string, unknown> = {}) {
  return {
    isRemote: false,
    confirmClear: false,
    setConfirmClear: vi.fn(),
    pendingSwitchPath: null,
    setPendingSwitchPath: vi.fn(),
    switching: false,
    showExportPassword: false,
    pendingExportSource: null,
    setShowExportPassword: vi.fn(),
    showImportPassword: false,
    pendingImportPath: null,
    importPassword: "",
    importPlan: null,
    analyzing: false,
    importing: false,
    importProgress: null,
    importError: null,
    pendingOverwritePath: null,
    overwriting: false,
    overwriteProgress: null,
    overwriteBackupReminder: null,
    postgresRemoteBusy: false,
    postgresRemoteAuthAction: null,
    setPostgresRemoteAuthAction: vi.fn(),
    confirmDisconnect: false,
    setConfirmDisconnect: vi.fn(),
    handleDisconnect: vi.fn(),
    confirmSwitch: vi.fn(),
    analyzeImport: vi.fn(),
    handleImport: vi.fn(),
    confirmOverwrite: vi.fn(),
    handleOverwriteBackupNow: vi.fn(),
    handleOverwriteBackupSkip: vi.fn(),
    handleConfirmPostgresRemoteAuth: vi.fn(),
    startExport: vi.fn(),
    setImportPlan: vi.fn(),
    setImportPassword: vi.fn(),
    setImportError: vi.fn(),
    setShowImportPassword: vi.fn(),
    setPendingImportPath: vi.fn(),
    setPendingOverwritePath: vi.fn(),
    setOverwriteBackupReminder: vi.fn(),
    handleClearTranslations: vi.fn(),
    ...overrides,
  };
}

function renderSection(data: Record<string, unknown>) {
  useDataSectionMock.mockReturnValue(data);
  render(<DataSection db={{} as never} t={t} />);
}

describe("overwrite backup reminder gate", () => {
  beforeEach(() => {
    useDataSectionMock.mockReset();
  });

  it("the file picker's result shows the backup reminder, NOT the destructive confirm", () => {
    // handleChooseOverwriteFile stages the path behind the reminder, so a
    // freshly picked file must render the reminder and nothing destructive.
    renderSection(baseData({ overwriteBackupReminder: PICKED_PATH }));

    expect(screen.getByText("Back up your database first")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back up now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip, I have a backup" })).toBeInTheDocument();
    // the destructive confirm is NOT open yet
    expect(screen.queryByText("Replace the active database?")).not.toBeInTheDocument();
  });

  it("Skip advances to the destructive confirm via the handler", () => {
    const data = baseData({ overwriteBackupReminder: PICKED_PATH });
    renderSection(data);

    fireEvent.click(screen.getByRole("button", { name: "Skip, I have a backup" }));
    expect(data.handleOverwriteBackupSkip).toHaveBeenCalledTimes(1);
  });

  it("Back up now cancels toward the export flow via the handler", () => {
    const data = baseData({ overwriteBackupReminder: PICKED_PATH });
    renderSection(data);

    // cancel side of the reminder modal = "back up first"
    fireEvent.click(screen.getByRole("button", { name: "Back up now" }));
    expect(data.handleOverwriteBackupNow).toHaveBeenCalledTimes(1);
  });

  it("the destructive confirm only appears once the reminder is cleared with a staged path", () => {
    // after Skip: the hook moves the path to pendingOverwritePath and clears
    // the reminder — that state must show the destructive confirm.
    renderSection(baseData({ pendingOverwritePath: PICKED_PATH, overwriteBackupReminder: null }));

    expect(screen.getByText("Replace the active database?")).toBeInTheDocument();
    expect(screen.queryByText("Back up your database first")).not.toBeInTheDocument();
  });
});
