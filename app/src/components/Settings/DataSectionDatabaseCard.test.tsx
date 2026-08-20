import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({ isDesktopHost: true }));

import { DataSectionDatabaseCard } from "./DataSectionDatabaseCard";

const POSTGRES_URL = "postgres://tanwords_user:super-secret@db.example.com:5432/tanwords?sslmode=require";

const SIZE_LABELS: Record<string, string> = {
  "settings.dbSizeIncludesAuxiliary": "Includes the SQLite database, WAL, and shared-memory files",
  "settings.dbSizeFromServer": "Reported by the database server (total size of the whole database)",
};

function renderCard(data: Record<string, unknown>) {
  const labels: Record<string, string> = {
    "settings.dbTabLocal": "Local",
    "settings.dbTabCloud": "Cloud",
    "settings.remoteDB": "Online database",
    "settings.remoteDBSub": "Connect a Postgres database",
    "settings.remoteDBConnected": "Connected",
    "settings.remoteDBSync": "Sync now",
    "settings.remoteDBDisconnect": "Disconnect",
    "settings.remoteDBPostgresUrl": "Connection string",
    "settings.remoteDBShowUrl": "Show connection string",
    "settings.remoteDBHideUrl": "Hide connection string",
    "settings.remoteAccessCopyUrl": "Copy connection string",
    ...SIZE_LABELS,
    "settings.importDB": "Import from a local database",
    "settings.importDBSub": "Import data",
    "settings.importOverwrite": "Full-overwrite import",
    "settings.importOverwriteSubCloud": "Overwrite cloud data",
    "settings.importOverwriteChoose": "Choose file & overwrite…",
  };
  const t = ((key: string) => labels[key] ?? key) as never;
  render(<DataSectionDatabaseCard data={data as never} t={t} />);
}

function postgresConnectionData() {
  return {
    activeTab: "cloud",
    connection: {
      kind: "postgres",
      path: "",
      remoteUrl: POSTGRES_URL,
      caps: { export: false, switchPath: false, sync: false, writable: true, vacuum: false },
    },
    isRemote: true,
    isOffline: false,
    canImport: true,
    postgresOpen: false,
    exporting: false,
    analyzing: false,
    overwriting: false,
    postgresExportProgress: null,
    setActiveTab: vi.fn(),
    setConfirmDisconnect: vi.fn(),
    handleChooseImportFile: vi.fn(),
    handleChooseOverwriteFile: vi.fn(),
  };
}

describe("DataSectionDatabaseCard Postgres credentials", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("keeps the saved connection string masked until reveal, then allows copying it", () => {
    renderCard({ ...postgresConnectionData(), formattedDbSize: "0 B" });

    const field = screen.getByLabelText("Connection string");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue(POSTGRES_URL);
    expect(screen.queryByText(POSTGRES_URL)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show connection string" }));
    expect(field).toHaveAttribute("type", "text");

    fireEvent.click(screen.getByRole("button", { name: "Copy connection string" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(POSTGRES_URL);
  });

  it("does not render the obsolete Sync now action", () => {
    renderCard({ ...postgresConnectionData(), formattedDbSize: "0 B" });
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
  });
});

describe("DataSectionDatabaseCard size badge", () => {
  it("shows the size with the server-report tooltip for a Postgres profile", () => {
    renderCard({ ...postgresConnectionData(), formattedDbSize: "12.34 MB" });
    const badge = screen.getByText("12.34 MB");
    expect(badge).toHaveAttribute("title", SIZE_LABELS["settings.dbSizeFromServer"]);
  });

  it("hides the size badge when the size is unmeasurable (null)", () => {
    renderCard({ ...postgresConnectionData(), formattedDbSize: null });
    // Neither size-tooltip element should be present.
    expect(screen.queryByText((_, el) => el?.getAttribute("title") === SIZE_LABELS["settings.dbSizeFromServer"]))
      .not.toBeInTheDocument();
    expect(screen.queryByText((_, el) => el?.getAttribute("title") === SIZE_LABELS["settings.dbSizeIncludesAuxiliary"]))
      .not.toBeInTheDocument();
  });
});
