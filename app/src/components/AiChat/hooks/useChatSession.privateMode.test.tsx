import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useChatSession } from "./useChatSession";
import type { ChatSidebarState } from "./useChatSidebar";

// Temp-chat mode's contract is "nothing is written to the database." The
// guards live across several call sites; these tests pick the ones whose
// write is gated *only* by the private flag (so the test isolates the guard
// rather than a separate "is this a new session" precondition):
//   - handleStop: saves unconditionally in normal mode (just needs a session
//     id on sessionMetaRef), suppressed entirely in private mode.
//   - clearMessages: writes + reloads the list in normal mode; no-ops in
//     private mode.
// The streaming auto-save interval is time-based and shares the same guard,
// so the handleStop path is the cheaper stand-in for "a save that would
// otherwise happen."

type MockFn = ReturnType<typeof vi.fn>;

function makeDeps() {
  const upsertChatSession = vi.fn(async () => {}) as MockFn;
  const saveSession = vi.fn(async () => {}) as MockFn;
  const loadSessions = vi.fn(async () => []) as MockFn;

  const db = {
    getChatSession: vi.fn(async () => null),
    upsertChatSession,
    renameChatSession: vi.fn(async () => true),
    deleteChatSession: vi.fn(async () => {}),
  } as unknown as Parameters<typeof useChatSession>[0]["db"];

  const sidebar = {
    loadSessions, saveSession,
    setSessions: vi.fn(), setArchivedSessions: vi.fn(),
    searchQuery: "", setSearchQuery: vi.fn(),
    dateFrom: "", dateTo: "", setDateRange: vi.fn(),
    searchResults: null, setSearchResults: vi.fn(),
    sessions: [], archivedSessions: [], displaySessions: [],
    toggleArchived: vi.fn(async () => {}), togglePinned: vi.fn(async () => {}),
  } as unknown as ChatSidebarState;

  return { db, sidebar, upsertChatSession, saveSession, loadSessions };
}

function renderSession() {
  const deps = makeDeps();
  const { result } = renderHook(() =>
    useChatSession({ db: deps.db, targetLevel: "B2", providers: [], initialSessionId: undefined, sidebar: deps.sidebar })
  );
  return { result, ...deps };
}

describe("useChatSession temporary-chat mode", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("togglePrivateMode starts a fresh ephemeral conversation", () => {
    const { result } = renderSession();
    expect(result.current.privateMode).toBe(false);

    act(() => result.current.togglePrivateMode());

    expect(result.current.privateMode).toBe(true);
    expect(result.current.isNewSession).toBe(true);
    expect(result.current.activeId).not.toBeNull();
    expect(result.current.displayItems).toHaveLength(0);
  });

  it("handleStop saves in normal mode but is suppressed in temporary mode", () => {
    const { result, saveSession } = renderSession();

    // A session id on the meta ref is the only precondition handleStop needs
    // to save (it doesn't check isNewSession) — so it cleanly isolates the
    // private-mode guard.
    act(() => {
      (result.current.sessionMetaRef as { current: { id: string; title: string } }).current = { id: "s1", title: "T" };
    });

    // Temporary mode on: stop must NOT persist.
    act(() => result.current.togglePrivateMode());
    act(() => result.current.handleStop());
    expect(saveSession).not.toHaveBeenCalled();

    // Exit temporary mode (-> a normal new chat) and arm a session id again:
    // stop now persists the in-memory transcript.
    act(() => result.current.togglePrivateMode());
    act(() => {
      (result.current.sessionMetaRef as { current: { id: string; title: string } }).current = { id: "s2", title: "T2" };
    });
    act(() => result.current.handleStop());
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(saveSession).toHaveBeenCalledWith(
      "s2", "T2", expect.any(Array), expect.any(String), expect.any(String), expect.any(String)
    );
  });

  it("clearMessages no-ops in temporary mode (no DB write, no list reload)", async () => {
    const { result, upsertChatSession, loadSessions } = renderSession();

    // The hook's mount effect loads the session list once; capture that
    // baseline so the assertion is about whether clearMessages *adds* a call.
    const loadCallsAtMount = loadSessions.mock.calls.length;

    // Temporary mode: clear must touch neither the DB nor the session list.
    act(() => result.current.togglePrivateMode());
    await act(async () => { await result.current.clearMessages(); });
    expect(upsertChatSession).not.toHaveBeenCalled();
    expect(loadSessions.mock.calls.length).toBe(loadCallsAtMount);
  });
});
