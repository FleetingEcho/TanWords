import { create } from "zustand";

/** UI signals a page host surfaces to the application shell.

 *  Today the only such signal is the Terminal page's embedded "maximize"
 *  mode: it removes app chrome (sidebar, command bar) without invoking the
 *  fragile browser fullscreen API and without unmounting the live PTY.
 *  Previously `App.tsx` owned that boolean and passed it down as the
 *  `immersive` prop. Moving the retained Terminal lifecycle into its adapter
 *  (per the plan's Phase 1) means the adapter now owns the state, but
 *  `App.tsx` still has to compute `immersive` for `MainLayout` and
 *  `disableBlur` for `AppBackground`.
 *
 *  Rather than thread a callback prop back up through the host, this tiny
 *  store is the shared source. The Terminal adapter writes
 *  `terminalMaximized`; `App.tsx` reads it and combines it with "is the
 *  terminal route active" the same way it always has. The store stays
 *  terminal-named for now; Phase 4 will generalize it when other panes can
 *  request focus/immersive behaviour. */
interface PageHostUiState {
  terminalMaximized: boolean;
  setTerminalMaximized: (value: boolean) => void;
}

export const usePageHostUiStore = create<PageHostUiState>((set) => ({
  terminalMaximized: false,
  setTerminalMaximized: (value) => set({ terminalMaximized: value }),
}));
