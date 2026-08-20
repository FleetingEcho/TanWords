import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/platform", () => ({ isDesktopHost: false }));

import { DataSectionDatabaseCard } from "./DataSectionDatabaseCard";

it("requires password re-authentication before revealing or rotating a managed Postgres credential", () => {
  const setPostgresRemoteAuthAction = vi.fn();
  const labels: Record<string, string> = {
    "settings.dbTabLocal": "Local",
    "settings.dbTabCloud": "Cloud",
    "settings.remoteAccessTitle": "Postgres remote access",
    "settings.remoteAccessSub": "Managed Postgres",
    "settings.remoteAccessOn": "Enabled",
    "settings.remoteDBPostgresUrl": "Connection string",
    "settings.remoteDBShowUrl": "Show connection string",
    "settings.remoteAccessCopyUrl": "Copy connection string",
    "settings.remoteAccessRotate": "Rotate password",
    "settings.remoteAccessDisable": "Disable",
    "settings.importDB": "Import",
    "settings.importDBSub": "Import data",
    "settings.importOverwrite": "Overwrite",
    "settings.importOverwriteSubCloud": "Overwrite cloud data",
    "settings.importOverwriteChoose": "Choose file",
  };
  const t = ((key: string) => labels[key] ?? key) as never;
  const data = {
    activeTab: "cloud",
    connection: {
      kind: "postgres",
      path: "",
      remoteUrl: "postgres://tanwords_user_1@db.example.com:5432/tanwords_user_1",
      caps: { export: false, switchPath: false, sync: false, writable: true, vacuum: false },
    },
    formattedDbSize: "0 B",
    isRemote: true,
    isOffline: false,
    canImport: true,
    postgresRemote: {
      enabled: true,
      url: "postgres://tanwords_user_1@db.example.com:5432/tanwords_user_1",
    },
    postgresRemoteBusy: false,
    postgresRemoteUrlVisible: false,
    analyzing: false,
    overwriting: false,
    setActiveTab: vi.fn(),
    setPostgresRemoteAuthAction,
    setPostgresRemoteUrlVisible: vi.fn(),
    setConfirmDisconnect: vi.fn(),
    handleChooseImportFile: vi.fn(),
    handleChooseOverwriteFile: vi.fn(),
  } as never;

  render(<DataSectionDatabaseCard data={data} t={t} />);

  expect(screen.getByLabelText("Connection string")).toHaveAttribute("type", "password");
  expect(screen.queryByRole("button", { name: "Copy connection string" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Show connection string" }));
  expect(setPostgresRemoteAuthAction).toHaveBeenCalledWith("reveal");

  fireEvent.click(screen.getByRole("button", { name: "Rotate password" }));
  expect(setPostgresRemoteAuthAction).toHaveBeenCalledWith("rotate");
});
