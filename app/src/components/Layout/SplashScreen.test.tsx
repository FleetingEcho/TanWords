import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SplashScreen } from "./SplashScreen";

vi.mock("@/platform", () => ({ isDesktopHost: true }));
vi.mock("@/hooks/useT", () => ({ useT: () => () => "gloss" }));
vi.mock("@/ipc/backend", () => ({
  // Keep the backend pending: the startup artwork must be present before any
  // sidecar/window readiness signal resolves.
  backendOrigin: () => new Promise<string>(() => {}),
}));

describe("SplashScreen", () => {
  it("renders its wordmark in the first frame", () => {
    render(<SplashScreen />);
    expect(screen.getByText("TanWords")).toBeInTheDocument();
  });
});
