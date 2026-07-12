import { create } from "zustand";

export interface WordDefinition {
  id?: number;
  pos: string;
  zh: string;
  en?: string;
  exampleEn?: string;
  exampleZh?: string;
  sortOrder?: number;
}

export interface WordPhonetic {
  locale: string;
  ipa: string;
  accentLabel: string;
}

export interface WordRelation {
  word: string;
  relationType: string;
  note?: string;
}

export interface WordEtymology {
  parts: string;
  story?: string;
  originLang?: string;
}

export interface Word {
  id: number;
  word: string;
  wordType?: string;
  level?: string;
  wordFreq: number;
  mnemonic?: string;
  notes?: string;
  source: string;
  definitions: WordDefinition[];
  phonetics: WordPhonetic[];
  etymology?: WordEtymology;
  synonyms: WordRelation[];
  antonyms: WordRelation[];
  collocations: WordRelation[];
  derivatives: WordRelation[];
  srsLevel: number;
  nextReviewAt?: string;
  createdAt: string;
}

interface VocabularyState {
  words: Word[];
  selectedWord: Word | null;
  isLoading: boolean;
  searchQuery: string;
  filterTab: "all" | "review" | "c1plus" | string;
  totalCount: number;

  setWords: (words: Word[]) => void;
  setSelectedWord: (word: Word | null) => void;
  setIsLoading: (v: boolean) => void;
  setSearchQuery: (query: string) => void;
  setFilterTab: (tab: string) => void;
  setTotalCount: (n: number) => void;
}

export const useVocabularyStore = create<VocabularyState>((set) => ({
  words: [],
  selectedWord: null,
  isLoading: false,
  searchQuery: "",
  filterTab: "all",
  totalCount: 0,

  setWords: (words) => set({ words }),
  setSelectedWord: (word) => set({ selectedWord: word }),
  setIsLoading: (v) => set({ isLoading: v }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterTab: (tab) => set({ filterTab: tab }),
  setTotalCount: (n) => set({ totalCount: n }),
}));
