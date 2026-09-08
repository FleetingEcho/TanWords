import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pageFromHash, useNavStore } from "./navStore";

/** jsdom fires `hashchange` asynchronously after history mutations; the tests
 *  dispatch it by hand instead, so each scenario is synchronous and doesn't
 *  depend on task ordering. */
function fireHashChange(): void {
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function setHash(hash: string): void {
  window.location.hash = hash;
  fireHashChange();
}

describe("navStore URL hash sync", () => {
  beforeEach(() => {
    window.location.hash = "";
    useNavStore.setState({ page: "dashboard", activeWorkspaceId: null });
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("navigate writes the page into the URL hash", () => {
    useNavStore.getState().navigate("feeds");
    expect(window.location.hash).toBe("#/feeds");
    useNavStore.getState().navigate("documents");
    expect(window.location.hash).toBe("#/documents");
  });

  it("pageFromHash reads the page back and rejects unknown values", () => {
    window.location.hash = "#/vocabulary";
    expect(pageFromHash()).toBe("vocabulary");
    window.location.hash = "#/not-a-page";
    expect(pageFromHash()).toBeNull();
    window.location.hash = "";
    expect(pageFromHash()).toBeNull();
  });

  it("drops hash pages this host cannot render", () => {
    // The test host resolves to web capabilities: no terminal, dsh, browser.
    window.location.hash = "#/terminal";
    expect(pageFromHash()).toBeNull();
    window.location.hash = "#/dsh";
    expect(pageFromHash()).toBeNull();
    window.location.hash = "#/feeds";
    expect(pageFromHash()).toBe("feeds");
  });

  it("adopts back/forward navigation through hashchange", () => {
    useNavStore.getState().navigate("feeds");
    useNavStore.getState().navigate("chat");
    expect(useNavStore.getState().page).toBe("chat");
    // Simulate the user pressing Back: the hash reverts to the previous entry.
    setHash("#/feeds");
    expect(useNavStore.getState().page).toBe("feeds");
    expect(window.location.hash).toBe("#/feeds");
  });

  it("leaves the page alone when the hash names nothing restorable", () => {
    useNavStore.getState().navigate("feeds");
    setHash("#/garbage");
    expect(useNavStore.getState().page).toBe("feeds");
    setHash("");
    expect(useNavStore.getState().page).toBe("feeds");
  });

  it("does not loop: adopting a hash page does not duplicate the entry", () => {
    useNavStore.getState().navigate("feeds");
    setHash("#/documents");
    expect(useNavStore.getState().page).toBe("documents");
    // navigate() ran inside the handler and rewrote the same hash — the URL
    // must still be exactly what the back/forward produced.
    expect(window.location.hash).toBe("#/documents");
  });

  it("opening a page leaves overlay state out of the hash", () => {
    useNavStore.getState().navigate("settings", undefined, "data");
    // Settings is an overlay, not a page destination: no hash, page unchanged.
    expect(window.location.hash).toBe("");
    expect(useNavStore.getState().page).toBe("dashboard");
    expect(useNavStore.getState().settingsOpen).toBe(true);
  });
});
