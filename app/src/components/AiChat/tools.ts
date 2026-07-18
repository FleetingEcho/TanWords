import { invoke } from "@tauri-apps/api/core";
import { ToolDef } from "@/providers/base";
import { contentToBlocks, markdownToBlocks, blocksToText } from "@/lib/docFormat";

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
  vocabulary: { label: "Vocabulary", tools: ["save_word", "search_vocabulary", "extract_vocabulary", "add_words_to_vocab"] },
  documents:  { label: "Documents",  tools: ["list_documents", "insert_into_document"] },
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
    description: "Extract C1+ level English vocabulary and expressions worth learning from a piece of text the user pasted into the chat. Call this when the user asks you to pull out, extract, or harvest vocabulary/生词 from an article or long text they shared — do the extraction yourself and pass the results as structured items; do not just describe them in prose. Each item needs a short context sentence quoted from the source text. The results are shown to the user as review cards, not saved automatically.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Extracted vocabulary/expression items, C1-calibrated, deduped against obviously basic words",
          items: {
            type: "object",
            properties: {
              word:      { type: "string", description: "The word or expression, in its base/dictionary form" },
              zh:        { type: "string", description: "Concise Chinese meaning in this context" },
              word_type: { type: "string", enum: ["n", "v", "adj", "adv", "prep", "phrase"], description: "Part of speech, or 'phrase' for expressions" },
              level:     { type: "string", enum: ["B2", "C1", "C2"], description: "Estimated CEFR level" },
              context:   { type: "string", description: "The sentence from the source text where this appears" },
            },
            required: ["word", "zh", "context"],
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

      default:
        return { tool_use_id: id, content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (e: any) {
    return { tool_use_id: id, content: `Error in ${name}: ${e?.message ?? String(e)}`, is_error: true };
  }
}
