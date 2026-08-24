import { describe, expect, it, beforeEach } from "vitest";
import { useNavStore, type NavDestination } from "./navStore";

beforeEach(() => {
  useNavStore.setState({
    page: "dashboard",
    wordId: undefined,
    sentenceId: undefined,
    settingsSection: undefined,
    settingsOpen: false,
    chatSessionId: undefined,
    activeWorkspaceId: null,
  });
});

describe("navStore destination", () => {
  it("starts on a page destination", () => {
    const dest = useNavStore.getState().currentDestination();
    expect(dest).toEqual({ kind: "page", page: "dashboard" });
  });

  it("openWorkspace activates a workspace destination and remembers the last page", () => {
    useNavStore.getState().navigate("vocabulary");
    useNavStore.getState().openWorkspace("ws-1");
    const dest = useNavStore.getState().currentDestination();
    expect(dest).toEqual({ kind: "workspace", workspaceId: "ws-1" });
    // The page field retains its last full-page value so a later navigate
    // resumes it.
    expect(useNavStore.getState().page).toBe("vocabulary");
    expect(useNavStore.getState().currentPage()).toBe("vocabulary");
  });

  it("navigate clears the workspace and resumes full-page mode", () => {
    useNavStore.getState().openWorkspace("ws-1");
    useNavStore.getState().navigate("chat");
    const dest = useNavStore.getState().currentDestination();
    expect(dest).toEqual({ kind: "page", page: "chat" });
    expect(useNavStore.getState().activeWorkspaceId).toBeNull();
  });

  it("opens Settings as an overlay without leaving the current workspace", () => {
    useNavStore.getState().navigate("documents");
    useNavStore.getState().openWorkspace("ws-1");

    useNavStore.getState().navigate("settings", undefined, "data");

    expect(useNavStore.getState()).toMatchObject({
      page: "documents",
      activeWorkspaceId: "ws-1",
      settingsOpen: true,
      settingsSection: "data",
    });
    useNavStore.getState().closeSettings();
    expect(useNavStore.getState()).toMatchObject({
      page: "documents",
      activeWorkspaceId: "ws-1",
      settingsOpen: false,
      settingsSection: undefined,
    });
  });

  it("closeWorkspace leaves the workspace without changing the remembered page", () => {
    useNavStore.getState().navigate("documents");
    useNavStore.getState().openWorkspace("ws-1");
    useNavStore.getState().closeWorkspace();
    const dest = useNavStore.getState().currentDestination();
    expect(dest).toEqual({ kind: "page", page: "documents" });
    expect(useNavStore.getState().activeWorkspaceId).toBeNull();
  });

  it("openVocabularySentence / openChatSession clear the workspace", () => {
    useNavStore.getState().openWorkspace("ws-1");
    useNavStore.getState().openVocabularySentence(5);
    expect(useNavStore.getState().activeWorkspaceId).toBeNull();
    expect(useNavStore.getState().currentDestination()).toEqual({ kind: "page", page: "vocabulary" });

    useNavStore.getState().openWorkspace("ws-2");
    useNavStore.getState().openChatSession("s1");
    expect(useNavStore.getState().activeWorkspaceId).toBeNull();
    expect(useNavStore.getState().currentDestination()).toEqual({ kind: "page", page: "chat" });
  });

  it("currentDestination is typed as a discriminated union", () => {
    // Compile-time assertion: the return type narrows correctly.
    const d: NavDestination = useNavStore.getState().currentDestination();
    if (d.kind === "workspace") {
      // workspaceId is accessible only in the workspace branch.
      const _id: string = d.workspaceId;
      expect(typeof _id).toBe("string");
    } else {
      const _p = d.page;
      expect(typeof _p).toBe("string");
    }
  });
});
