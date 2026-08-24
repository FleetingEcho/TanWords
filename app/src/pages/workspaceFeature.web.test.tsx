import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("@/platform", () => ({ isDesktopHost: false }));

import {
  isWorkspacesEnabled,
  setWorkspacesEnabled,
  useWorkspacesEnabled,
} from "./workspaceFeature";

describe("workspace feature on the web host", () => {
  it("stays unavailable even when the persisted user flag is enabled", () => {
    setWorkspacesEnabled(true);
    expect(isWorkspacesEnabled()).toBe(false);
    expect(renderHook(() => useWorkspacesEnabled()).result.current).toBe(false);
  });
});
