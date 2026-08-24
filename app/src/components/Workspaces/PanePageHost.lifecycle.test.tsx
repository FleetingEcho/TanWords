import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ unmounts: 0 }));

vi.mock("@/pages/pageCatalog", () => ({
  getPageDefinition: (id: string) => ({ id, host: "react" }),
}));
vi.mock("@/pages/adapters/lazyPage", async () => {
  const React = await import("react");
  function TestPage() {
    React.useEffect(() => () => { lifecycle.unmounts += 1; }, []);
    return <div data-testid="ordinary-pane-page" />;
  }
  return { getLazyPage: () => TestPage };
});

import { PanePageHost } from "./PanePageHost";

describe("PanePageHost visibility lifecycle", () => {
  beforeEach(() => { lifecycle.unmounts = 0; });

  it("keeps an ordinary page mounted while another pane is maximized", () => {
    const content = { instanceId: "instance-1", pageId: "dashboard" as const };
    const props = {
      paneId: "pane-1",
      content,
      requestFocus: vi.fn(),
      requestOpenFullPage: vi.fn(),
    };
    const view = render(<PanePageHost {...props} visible />);

    view.rerender(<PanePageHost {...props} visible={false} />);

    expect(screen.getByTestId("ordinary-pane-page")).toBeInTheDocument();
    expect(lifecycle.unmounts).toBe(0);
  });
});
