import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./SplashScreen";

const mocks = vi.hoisted(() => ({ backendOrigin: vi.fn() }));

vi.mock("@/platform", () => ({ isDesktopHost: true }));
vi.mock("@/hooks/useT", () => ({ useT: () => () => "gloss" }));
vi.mock("@/ipc/backend", () => ({
  backendOrigin: mocks.backendOrigin,
}));

describe("SplashScreen", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.tanwordsShellReady;
    mocks.backendOrigin.mockReturnValue(new Promise<string>(() => {}));
  });

  it("renders its wordmark in the first frame", () => {
    render(<SplashScreen />);
    expect(screen.getByText("TanWords")).toBeInTheDocument();
  });

  it("never fades before the real app shell has committed", async () => {
    vi.useFakeTimers();
    mocks.backendOrigin.mockResolvedValue("http://127.0.0.1:1234");
    const { container } = render(<SplashScreen />);

    await act(async () => { await Promise.resolve(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(container.firstElementChild?.className).not.toContain("fade-out");

    act(() => { window.dispatchEvent(new CustomEvent("tanwords:shell-ready")); });
    expect(container.firstElementChild?.className).toContain("fade-out");
    vi.useRealTimers();
  });
});
