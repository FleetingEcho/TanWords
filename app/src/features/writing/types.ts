export interface WritingVocabulary {
  id?: number;
  originalExpression: string;
  word: string;
  suggested_word?: string;
  meaning: string;
  reason: string;
  exampleSentence: string;
  example_sentence?: string;
  selected: boolean;
  vocabulary_id?: number | null;
}

export interface WritingSentence {
  id?: number;
  position?: number;
  original: string;
  corrected: string;
  natural: string;
  explanation: string;
  vocabulary: WritingVocabulary[];
}

export interface WritingAnalysis {
  detectedType: "sentence" | "essay";
  detectedGenre: string;
  overallFeedback: string;
  refinedFullText: string;
  structureFeedback: string;
  coherenceFeedback: string;
  toneFeedback: string;
  sentences: WritingSentence[];
  modelEssays: string[];
}

export type WritingMode = "quick" | "deep";

export interface WritingCandidate {
  original: string;
  refined: string;
  explanation: string;
}

export interface WritingSuggestion {
  word: string;
  level?: "B1" | "B2" | "C1" | "C2";
  meaning: string;
  reason: string;
  exampleSentence: string;
}

/** Temporary AI result. Nothing here is persisted until the user selects it. */
export interface WritingResponse {
  refinedText: string;
  analysis: string;
  candidates: WritingCandidate[];
  vocabulary: WritingSuggestion[];
  modelEssays: string[];
}

export interface WritingSubmission extends WritingAnalysis {
  id: number;
  originalText: string;
  input_type?: "sentence" | "essay";
  original_text?: string;
  detected_genre?: string;
  overall_feedback?: string;
  refined_full_text?: string;
  structure_feedback?: string;
  coherence_feedback?: string;
  tone_feedback?: string;
  model_essays?: string[];
  created_at: string;
}

export interface WritingSummary {
  id: number;
  title: string;
  content: string;
  source_type: "sentences" | "submissions" | "summaries";
  source_snapshot: string;
  created_at: string;
}
