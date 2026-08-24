import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import { useDragState } from "./dragState";
import { DragLayer } from "./DragLayer";
import { usePointerDragSource } from "./usePointerDragSource";

beforeEach(() => {
  useDragState.setState({ pageId: null, x: 0, y: 0, active: false });
});

describe("dragState store", () => {
  it("start records the page and point but stays inactive", () => {
    useDragState.getState().start("dashboard", 10, 20);
    const s = useDragState.getState();
    expect(s.pageId).toBe("dashboard");
    expect(s.x).toBe(10);
    expect(s.y).toBe(20);
    expect(s.active).toBe(false);
  });

  it("move activates the drag whenever a pageId is in flight", () => {
    useDragState.getState().start("dashboard", 0, 0);
    // The store does not measure distance; the source's own threshold gate
    // decides whether to call move at all. Any move activates.
    useDragState.getState().move(1, 0);
    expect(useDragState.getState().active).toBe(true);
  });

  it("move is a no-op when no drag is in flight", () => {
    useDragState.getState().move(100, 100);
    expect(useDragState.getState().active).toBe(false);
    expect(useDragState.getState().pageId).toBeNull();
  });

  it("end resets the drag", () => {
    useDragState.getState().start("dashboard", 0, 0);
    useDragState.getState().move(50, 50);
    useDragState.getState().end();
    const s = useDragState.getState();
    expect(s.pageId).toBeNull();
    expect(s.active).toBe(false);
  });
});

describe("DragLayer", () => {
  it("renders nothing when no drag is active", () => {
    render(<DragLayer />);
    expect(document.querySelector(".fixed")).toBeNull();
  });

  it("renders a preview following the pointer when the drag is active", () => {
    useDragState.setState({ pageId: "dashboard", x: 100, y: 80, active: true });
    render(<DragLayer />);
    const layer = document.querySelector(".fixed") as HTMLElement;
    expect(layer).not.toBeNull();
    // The preview names the dragged page.
    expect(layer.textContent).toContain("Dashboard");
    // Positioned near the pointer (left = x + 12).
    expect(layer.style.left).toBe("112px");
    expect(layer.style.top).toBe("92px");
  });
});

describe("usePointerDragSource", () => {
  it("activates a drag after a pointer move past threshold and ends on pointerup", () => {
    const onDrop = vi.fn();
    function Probe() {
      const src = usePointerDragSource("dashboard", onDrop);
      return <button data-testid="src" {...src}>src</button>;
    }
    render(<Probe />);
    const el = screen.getByTestId("src");
    // pointerdown starts tracking.
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerType: "touch" });
    expect(useDragState.getState().pageId).toBe("dashboard");
    expect(useDragState.getState().active).toBe(false);
    // Move past threshold activates.
    fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
    expect(useDragState.getState().active).toBe(true);
    // Drop fires onDrop.
    fireEvent.pointerUp(window, { clientX: 50, clientY: 0 });
    expect(onDrop).toHaveBeenCalledWith("dashboard", 50, 0);
    expect(useDragState.getState().active).toBe(false);
    cleanup();
  });

  it("does not activate on a click without movement", () => {
    const onDrop = vi.fn();
    function Probe() {
      const src = usePointerDragSource("dashboard", onDrop);
      return <button data-testid="src" {...src}>src</button>;
    }
    render(<Probe />);
    const el = screen.getByTestId("src");
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerType: "touch" });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });
    expect(useDragState.getState().active).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not activate on a sub-threshold move (a click still navigates)", () => {
    const onDrop = vi.fn();
    function Probe() {
      const src = usePointerDragSource("dashboard", onDrop);
      return <button data-testid="src" {...src}>src</button>;
    }
    render(<Probe />);
    const el = screen.getByTestId("src");
    fireEvent.pointerDown(el, { clientX: 0, clientY: 0, button: 0, pointerType: "touch" });
    // A move below the 6px threshold stays inactive.
    fireEvent.pointerMove(window, { clientX: 3, clientY: 0 });
    expect(useDragState.getState().active).toBe(false);
    fireEvent.pointerUp(window, { clientX: 3, clientY: 0 });
    expect(onDrop).not.toHaveBeenCalled();
  });
});
