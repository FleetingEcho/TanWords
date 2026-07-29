import { create } from "zustand";

const MODAL_POS_KEY = "tanwords_tools_modal_pos";
const MODAL_SIZE_KEY = "tanwords_tools_modal_size";
const MODAL_MAX_KEY = "tanwords_tools_modal_maximized";

interface Pos {
  x: number;
  y: number;
}

function defaultModalPos(): Pos {
  const w = defaultModalSize().width;
  const h = defaultModalSize().height;
  return {
    x: Math.max(0, (window.innerWidth - w) / 2),
    y: Math.max(0, (window.innerHeight - h) / 2),
  };
}

function defaultModalSize(): { width: number; height: number } {
  return {
    width: Math.min(820, window.innerWidth - 40),
    height: Math.min(700, window.innerHeight - 80),
  };
}

function loadModalPos(): Pos {
  try {
    const raw = localStorage.getItem(MODAL_POS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return defaultModalPos();
}

function loadModalSize(): { width: number; height: number } {
  try {
    const raw = localStorage.getItem(MODAL_SIZE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return defaultModalSize();
}

interface ToolsBallState {
  isOpen: boolean;
  activeTab: "documents" | "chat" | "word";
  modalPos: Pos;
  modalSize: { width: number; height: number };
  maximized: boolean;
  toggleMaximized: () => void;

  openModal: (tab?: "documents" | "chat" | "word") => void;
  closeModal: () => void;
  toggleModal: () => void;
  setActiveTab: (tab: "documents" | "chat" | "word") => void;
  setModalPos: (pos: Pos) => void;
  setModalSize: (size: { width: number; height: number }) => void;
}

export const useToolsBallStore = create<ToolsBallState>((set, get) => ({
  isOpen: false,
  activeTab: "documents",
  modalPos: loadModalPos(),
  modalSize: loadModalSize(),
  maximized: localStorage.getItem(MODAL_MAX_KEY) === "1",

  toggleMaximized: () => {
    const next = !get().maximized;
    set({ maximized: next });
    localStorage.setItem(MODAL_MAX_KEY, next ? "1" : "0");
  },

  openModal: (tab) => {
    if (tab) set({ activeTab: tab });
    set({ isOpen: true });
  },

  closeModal: () => set({ isOpen: false }),

  toggleModal: () => {
    const { isOpen } = get();
    set({ isOpen: !isOpen });
  },

  setActiveTab: (tab) => set({ activeTab: tab }),

  setModalPos: (pos) => {
    set({ modalPos: pos });
    localStorage.setItem(MODAL_POS_KEY, JSON.stringify(pos));
  },

  setModalSize: (size) => {
    set({ modalSize: size });
    localStorage.setItem(MODAL_SIZE_KEY, JSON.stringify(size));
  },
}));
