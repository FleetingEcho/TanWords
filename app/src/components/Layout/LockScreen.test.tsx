import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useT", () => ({ useT: () => (key: string) => key }));
vi.mock("@/platform", () => ({ isDesktopHost: false }));
vi.mock("@/store/settingsStore", () => ({
  useSettingsStore: (selector: (state: unknown) => unknown) => selector({
    lockScreenImage: "",
    lockScreenVisible: false,
    lockScreenBlur: 0,
  }),
}));
vi.mock("@/store/appLockStore", () => ({
  useAppLockStore: (selector: (state: unknown) => unknown) => selector({
    verify: vi.fn(),
    setLocked: vi.fn(),
  }),
}));

import { LockScreen } from "./LockScreen";

describe("LockScreen startup transition", () => {
  it("leaves the transition to the single global startup cover", () => {
    const { container, rerender } = render(<LockScreen pending />);
    expect(container.querySelector("[data-lock-startup-transition]")).toBeNull();

    rerender(<LockScreen />);
    expect(container.querySelector("[data-lock-startup-transition]")).toBeNull();
  });

  it("does not autofocus the password field on mobile web", () => {
    const { container } = render(<LockScreen />);
    expect(container.querySelector("input")).not.toHaveAttribute("autofocus");
  });
});
