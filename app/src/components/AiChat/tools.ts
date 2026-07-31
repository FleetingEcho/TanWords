import { invoke } from "@/ipc/backend";
import { ToolDef } from "@/providers/base";
import { contentToBlocks, markdownToBlocks, blocksToText, blocksToStorage } from "@/lib/docFormat";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// ── Tool Groups ────────────────────────────────────────────────────────────

export const TOOL_GROUPS = {
  vocabulary: { label: "Vocabulary", tools: ["save_word", "search_vocabulary", "add_words_to_vocab", "generate_sentences"] },
  documents:  { label: "Documents",  tools: ["list_documents", "insert_into_document", "summarize_conversation", "save_note_as_document"] },
} as const;

export type ToolGroupKey = keyof typeof TOOL_GROUPS;

// ── Tool Definitions ───────────────────────────────────────────────────────

const ALL_TOOL_DEFS: Record<string, ToolDef> = {
  save_word: {
    name: "save_word",
    description: "Save an English word to the user's vocabulary database. Call this when the user asks to save, add, or remember a word.",
    input_schema: {
      type: "object",
      properties: {
        word:      { type: "string", description: "The English word" },
        zh:        { type: "string", description: "Chinese translation / meaning" },
        word_type: { type: "string", enum: ["n", "v", "adj", "adv", "prep", "conj", "pron"], description: "Part of speech" },
        level:     { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "CEFR level (estimate if unsure)" },
      },
      required: ["word", "zh"],
    },
  },

  search_vocabulary: {
    name: "search_vocabulary",
    description: "Search the user's vocabulary. Use to check if a word already exists before saving.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Word or prefix to search for" },
      },
      required: ["query"],
    },
  },

  extract_vocabulary: {
    name: "extract_vocabulary",
    description: "Extract the English words, phrases, collocations and idioms worth learning from a piece of text the user pasted into the chat — anything a learner would benefit from saving, judged by usefulness rather than a CEFR cutoff. Call this when the user asks you to pull out, extract, or harvest vocabulary/生词 from an article or long text they shared — do the extraction yourself and pass the results as structured items; do not just describe them in prose. Each item needs a short context sentence quoted from the source text. The results are shown to the user as review cards, not saved automatically.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Items worth learning — above-level words, but also familiar words used in unfamiliar senses, natural collocations, phrasal verbs, idioms and set expressions; deduped against words the learner certainly knows",
          items: {
            type: "object",
            properties: {
              word:      { type: "string", description: "The word or expression, in its base/dictionary form" },
              zh:        { type: "string", description: "Concise Chinese meaning in this context" },
              word_type: { type: "string", enum: ["n", "v", "adj", "adv", "prep", "phrase", "idiom"], description: "Part of speech, 'phrase' for expressions/collocations, 'idiom' for idioms" },
              level:     { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "Honest estimated CEFR level of this word/expression as used here" },
              context:   { type: "string", description: "The sentence from the source text where this appears" },
            },
            required: ["word", "zh", "context"],
          },
        },
      },
      required: ["items"],
    },
  },

  extract_patterns: {
    name: "extract_patterns",
    description: "Extract sentences worth imitating from a piece of text the user shared — advanced structures, elegant phrasing, useful grammar, rhetorical moves. Call this alongside extract_vocabulary when studying an article: pass the results as structured items, do not just quote them in prose. Each sentence must be copied verbatim from the source text. The results are shown as review cards the user can save to their sentence library; nothing is saved automatically.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Sentences worth learning from the source text, each with its reusable pattern skeleton",
          items: {
            type: "object",
            properties: {
              sentence: { type: "string", description: "The EXACT sentence, copied verbatim from the source text" },
              zh:       { type: "string", description: "Natural Chinese translation" },
              level:    { type: "string", enum: ["A2", "B1", "B2", "C1", "C2"], description: "Estimated CEFR level" },
              skeleton: { type: "string", description: "Reusable pattern skeleton with placeholders, e.g. 'It is not until X that Y'" },
              note:     { type: "string", description: "Short Chinese note: 这句好在哪、用了什么句式/语法/修辞" },
            },
            required: ["sentence", "zh"],
          },
        },
      },
      required: ["items"],
    },
  },

  add_words_to_vocab: {
    name: "add_words_to_vocab",
    description: "Batch-save multiple words directly to the user's vocabulary in one call, skipping duplicates automatically. Use when the user says something like '都加进去' / 'add all of these' after you've already shown them a list of words (e.g. from extract_vocabulary).",
    input_schema: {
      type: "object",
      properties: {
        words: {
          type: "array",
          items: {
            type: "object",
            properties: {
              word:      { type: "string" },
              zh:        { type: "string" },
              word_type: { type: "string" },
              level:     { type: "string" },
              context:   { type: "string" },
            },
            required: ["word", "zh"],
          },
        },
      },
      required: ["words"],
    },
  },

  generate_sentences: {
    name: "generate_sentences",
    description: "Generate example sentences worth saving to the user's sentence library, for a word, topic, or reusable pattern they want to practice. Call this when the user asks you to generate/give them example sentences or sentence patterns — do the generation yourself and pass the results as structured items; do not just list them in prose. The results are shown to the user as review cards, not saved automatically.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Generated example sentences, each built on a distinct reusable sentence pattern",
          items: {
            type: "object",
            properties: {
              sentence: { type: "string", description: "The English sentence" },
              zh:       { type: "string", description: "Natural Chinese translation" },
              level:    { type: "string", enum: ["A2", "B1", "B2", "C1", "C2"], description: "Estimated CEFR level" },
              skeleton: { type: "string", description: "Reusable sentence pattern skeleton, e.g. 'be shortlisted for + noun'" },
              note:     { type: "string", description: "Short Chinese note on the scenario or register this pattern fits" },
            },
            required: ["sentence", "zh"],
          },
        },
      },
      required: ["items"],
    },
  },

  list_documents: {
    name: "list_documents",
    description: "List the user's documents (id and title). Use to find a document ID before inserting content.",
    input_schema: { type: "object", properties: {}, required: [] },
  },

  insert_into_document: {
    name: "insert_into_document",
    description: "Append formatted content to the end of an existing document. Supports markdown: # heading, ## subheading, - bullet, plain text.",
    input_schema: {
      type: "object",
      properties: {
        doc_id:  { type: "number", description: "Document ID from list_documents" },
        content: { type: "string", description: "Markdown-formatted content to append" },
      },
      required: ["doc_id", "content"],
    },
  },

  summarize_conversation: {
    name: "summarize_conversation",
    description: "Turn the conversation so far (or the text/article the user shared) into a structured note — a title and a polished markdown summary. Call this when the user asks you to summarize this into a note (e.g. '总结成笔记', 'summarize this to a note'). This only prepares the note for the user to review; it is NOT saved anywhere yet — call save_note_as_document separately when the user then asks you to save it.",
    input_schema: {
      type: "object",
      properties: {
        title:   { type: "string", description: "Short, descriptive note title" },
        content: { type: "string", description: "Markdown-formatted note body: # heading, ## subheading, - bullet, plain text" },
      },
      required: ["title", "content"],
    },
  },

  save_note_as_document: {
    name: "save_note_as_document",
    description: "Save a note as a brand-new document in the user's Documents library. Call this when the user asks you to save, keep, or file away a note (e.g. 'save it', '存起来', '保存为文档') — typically right after summarize_conversation produced one; pass that same title/content, not a re-summary. Do not use this to append to an existing document; use insert_into_document for that.",
    input_schema: {
      type: "object",
      properties: {
        title:   { type: "string", description: "Short, descriptive document title" },
        content: { type: "string", description: "Markdown-formatted note content: # heading, ## subheading, - bullet, plain text" },
      },
      required: ["title", "content"],
    },
  },
};

export function getEnabledTools(groups: Set<ToolGroupKey>): ToolDef[] {
  const names = new Set<string>();
  for (const g of groups) TOOL_GROUPS[g].tools.forEach((n) => names.add(n));
  return [...names].map((n) => ALL_TOOL_DEFS[n]).filter(Boolean);
}

// ── Tool Executor ──────────────────────────────────────────────────────────

export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const { id, name, input } = call;
  try {
    switch (name) {

      case "save_word": {
        const { word, zh, word_type, level } = input as any;
        await invoke("db_add_word", { word, zh, wordType: word_type ?? null, level: level ?? null });
        window.dispatchEvent(new CustomEvent("vocab-updated"));
        return { tool_use_id: id, content: `✓ Saved "${word}" (${zh}) to vocabulary.` };
      }

      case "search_vocabulary": {
        const { query } = input as any;
        const results: any[] = await invoke("db_get_words", {
          search: query, levelFilter: null, sortBy: null,
        });
        if (results.length === 0) return { tool_use_id: id, content: `No words found for "${query}".` };
        const list = results.slice(0, 10).map((w: any) => `${w.word} (${w.zh})`).join(", ");
        return { tool_use_id: id, content: `Found: ${list}` };
      }

      case "extract_vocabulary": {
        // No DB write here — the caller renders these as interactive review
        // cards (VocabExtractionCard) and the user accepts individually.
        const { items } = input as { items: unknown[] };
        const n = Array.isArray(items) ? items.length : 0;
        return { tool_use_id: id, content: `✓ Extracted ${n} item${n === 1 ? "" : "s"} — review the cards below.` };
      }

      case "extract_patterns": {
        // No DB write here — the caller renders these as interactive review
        // cards (SentenceExtractionCard) and the user accepts individually.
        const { items } = input as { items: unknown[] };
        const n = Array.isArray(items) ? items.length : 0;
        return { tool_use_id: id, content: `✓ Extracted ${n} sentence${n === 1 ? "" : "s"} — review the cards below.` };
      }

      case "add_words_to_vocab": {
        const { words } = input as { words: { word: string; zh: string; word_type?: string; level?: string; context?: string }[] };
        const result: { added: number; skipped: number } = await invoke("db_add_words_batch", {
          words: words ?? [],
          source: "chat",
        });
        if (result.added > 0) window.dispatchEvent(new CustomEvent("vocab-updated"));
        return {
          tool_use_id: id,
          content: `✓ Added ${result.added} word${result.added === 1 ? "" : "s"}${result.skipped > 0 ? `, skipped ${result.skipped} already in vocabulary` : ""}.`,
        };
      }

      case "generate_sentences": {
        // No DB write here — the caller renders these as interactive review
        // cards (SentenceExtractionCard) and the user accepts individually.
        const { items } = input as { items: unknown[] };
        const n = Array.isArray(items) ? items.length : 0;
        return { tool_use_id: id, content: `✓ Generated ${n} sentence${n === 1 ? "" : "s"} — review the cards below.` };
      }

      case "list_documents": {
        const result: any = await invoke("db_get_documents", {
          search: null, dateFrom: null, dateTo: null, tag: null, sort: "updated", page: 0,
        });
        const items: any[] = result?.items ?? [];
        if (items.length === 0) return { tool_use_id: id, content: "No documents found." };
        const list = items.map((d: any) => `#${d.id}: "${d.title}" (${d.word_count} words)`).join("\n");
        return { tool_use_id: id, content: `Documents:\n${list}` };
      }

      case "insert_into_document": {
        const { doc_id, content: mdContent } = input as any;
        const doc: any = await invoke("db_get_document", { id: doc_id });
        if (!doc) return { tool_use_id: id, content: `Document #${doc_id} not found.`, is_error: true };

        // Existing blocks (converts legacy Lexical content on the fly)
        const existing = await contentToBlocks(doc.content);
        const appended = await markdownToBlocks(mdContent as string);
        const blocks = [...existing, ...appended];

        const newText = blocksToText(blocks);
        const wordCount = newText.split(/\s+/).filter(Boolean).length;

        await invoke("db_update_document", {
          id: doc_id,
          title: doc.title,
          content: JSON.stringify(blocks),
          contentText: newText,
          tags: doc.tags,
          pinned: doc.pinned,
          wordCount,
        });
        return { tool_use_id: id, content: `✓ Appended content to "${doc.title}".` };
      }

      case "summarize_conversation": {
        // No DB write here — the caller renders this as a preview card (NoteCard)
        // that save_note_as_document persists once the user asks to save it.
        return { tool_use_id: id, content: `✓ Note ready — review below.` };
      }

      case "save_note_as_document": {
        const { title, content: mdContent } = input as { title: string; content: string };
        const blocks = await markdownToBlocks(mdContent);
        const storage = blocksToStorage(blocks);
        const docId: number = await invoke("db_create_document_with_content", {
          title,
          content: storage.content,
          contentText: storage.contentText,
          tags: JSON.stringify(["ai-chat-note"]),
          wordCount: storage.wordCount,
        });
        return { tool_use_id: id, content: `✓ Saved "${title}" to Documents (#${docId}).` };
      }

      default:
        return { tool_use_id: id, content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (e: any) {
    return { tool_use_id: id, content: `Error in ${name}: ${e?.message ?? String(e)}`, is_error: true };
  }
}
