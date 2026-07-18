import { create } from "zustand";

const BALL_POS_KEY = "tanwords_tools_ball_pos";
const MODAL_POS_KEY = "tanwords_tools_modal_pos";
const MODAL_SIZE_KEY = "tanwords_tools_modal_size";
const OLD_BALL_POS_KEY = "tanwords_quickdoc_pos"; // migrate from old QuickDocBall

interface Pos {
  x: number;
  y: number;
}

function clampBallPos(p: Pos): Pos {
  const SIZE = 44;
  const MARGIN = 12;
  return {
    x: Math.min(Math.max(MARGIN, p.x), window.innerWidth - SIZE - MARGIN),
    y: Math.min(Math.max(MARGIN, p.y), window.innerHeight - SIZE - MARGIN),
  };
}

function defaultBallPos(): Pos {
  const SIZE = 44;
  return { x: window.innerWidth - SIZE - 20, y: window.innerHeight - SIZE - 20 };
}

function loadBallPos(): Pos {
  try {
    // Migrate from old key first
    const oldRaw = localStorage.getItem(OLD_BALL_POS_KEY);
    if (oldRaw) {
      const parsed = JSON.parse(oldRaw);
      localStorage.removeItem(OLD_BALL_POS_KEY);
      return clampBallPos({ x: parsed.x, y: parsed.y });
    }
    const raw = localStorage.getItem(BALL_POS_KEY);
    if (raw) return clampBallPos(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return clampBallPos(defaultBallPos());
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
  activeTab: "documents" | "chat" | "writing" | "word";
  ballPos: Pos;
  modalPos: Pos;
  modalSize: { width: number; height: number };

  openModal: (tab?: "documents" | "chat" | "writing" | "word") => void;
  closeModal: () => void;
  toggleModal: () => void;
  setActiveTab: (tab: "documents" | "chat" | "writing" | "word") => void;
  setBallPos: (pos: Pos) => void;
  setModalPos: (pos: Pos) => void;
  setModalSize: (size: { width: number; height: number }) => void;
}

export const useToolsBallStore = create<ToolsBallState>((set, get) => ({
  isOpen: false,
  activeTab: "documents",
  ballPos: loadBallPos(),
  modalPos: loadModalPos(),
  modalSize: loadModalSize(),

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

  setBallPos: (pos) => {
    const clamped = clampBallPos(pos);
    set({ ballPos: clamped });
    localStorage.setItem(BALL_POS_KEY, JSON.stringify(clamped));
  },

  setModalPos: (pos) => {
    set({ modalPos: pos });
    localStorage.setItem(MODAL_POS_KEY, JSON.stringify(pos));
  },

  setModalSize: (size) => {
    set({ modalSize: size });
    localStorage.setItem(MODAL_SIZE_KEY, JSON.stringify(size));
  },
}));
