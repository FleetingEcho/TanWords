import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { requestWindowHide, showWindow } from "./windowVisibility";

function fakeWindow(fullScreen: boolean) {
  const listeners = new Map<string, () => void>();
  const win = {
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => fullScreen),
    hide: vi.fn(),
    show: vi.fn(),
    setFullScreen: vi.fn((next: boolean) => { fullScreen = next; }),
    once: vi.fn((event: string, handler: () => void) => { listeners.set(event, handler); }),
  };
  return {
    win,
    target: win as unknown as BrowserWindow,
    emit: (event: string) => listeners.get(event)?.(),
  };
}

describe("window visibility", () => {
  it("hides an ordinary or maximized window immediately", () => {
    const { win, target } = fakeWindow(false);

    requestWindowHide(target);

    expect(win.hide).toHaveBeenCalledOnce();
    expect(win.setFullScreen).not.toHaveBeenCalled();
  });

  it("leaves fullscreen before hiding the native window", () => {
    const { win, target, emit } = fakeWindow(true);

    requestWindowHide(target);

    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    expect(win.hide).not.toHaveBeenCalled();
    emit("leave-full-screen");
    expect(win.hide).toHaveBeenCalledOnce();
  });

  it("cancels a pending hide when the app is reopened", () => {
    const { win, target, emit } = fakeWindow(true);

    requestWindowHide(target);
    showWindow(target);
    emit("leave-full-screen");

    expect(win.show).toHaveBeenCalledOnce();
    expect(win.hide).not.toHaveBeenCalled();
  });
});
