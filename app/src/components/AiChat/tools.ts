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

/** Persists a Markdown note as a new document and tells Documents to refresh. */
export async function saveNoteAsDocument(title: string, content: string): Promise<number> {
  const blocks = await markdownToBlocks(content);
  const storage = blocksToStorage(blocks);
  const docId: number = await invoke("db_create_document_with_content", {
    title,
    content: storage.content,
    contentText: storage.contentText,
    tags: JSON.stringify(["ai-chat-note"]),
    wordCount: storage.wordCount,
  });
  window.dispatchEvent(new CustomEvent("docs-updated"));
  return docId;
}

// ── Tool Groups ────────────────────────────────────────────────────────────

export const TOOL_GROUPS = {
  vocabulary: { label: "Vocabulary", tools: ["get_vocabulary_stats", "list_vocabulary", "search_vocabulary", "save_word", "add_words_to_vocab", "save_sentences"] },
  documents:  { label: "Documents",  tools: ["list_documents", "insert_into_document", "summarize_conversation", "save_note_as_document"] },
  calendar:   { label: "Calendar",   tools: ["list_events", "create_event", "update_event", "delete_event"] },
} as const;

export type ToolGroupKey = keyof typeof TOOL_GROUPS;

// ── Tool Definitions ───────────────────────────────────────────────────────

const ALL_TOOL_DEFS: Record<string, ToolDef> = {
  get_vocabulary_stats: {
    name: "get_vocabulary_stats",
    description: "Get the total number of English words in the user's vocabulary database. Call this whenever the user asks how many words they have saved, or wants an overview of their vocabulary size.",
    input_schema: { type: "object", properties: {}, required: [] },
  },

  list_vocabulary: {
    name: "list_vocabulary",
    description: "List words from the user's vocabulary for review, quizzing, or planning. Use this when the user asks you to quiz them with their saved words, pick words from their library, or see what they have saved. Returns word, Chinese meaning, CEFR level, and SRS level. Use query to narrow by word or Chinese meaning, limit and offset to page, levelFilter to target a CEFR band, or random to draw a sample for a quiz.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional word or Chinese meaning search. Empty returns the whole library." },
        limit: { type: "number", description: "Maximum words to return. Default 30, maximum 100." },
        offset: { type: "number", description: "Skip this many words from the sorted result. Use with limit to page through the library." },
        sortBy: { type: "string", enum: ["recent", "alpha", "freq"], description: "Order words by recently updated, alphabetical, or frequency." },
        levelFilter: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2", "B1-"], description: "Optional CEFR level filter." },
        random: { type: "boolean", description: "Set true to return a random sample. Useful for building quizzes." },
      },
      required: [],
    },
  },

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

  save_sentences: {
    name: "save_sentences",
    description: "Save generated or recommended English sentences directly to the user's sentence library in one call. Use when the user asks you to save, keep, or add sentences you just produced (for example model sentences, quiz feedback examples, or related usage examples). Each item needs the exact English sentence; include a Chinese meaning, usage note, and CEFR level when available. Duplicates are skipped automatically.",
    input_schema: {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sentence: { type: "string", description: "The exact English sentence to save" },
              zh:       { type: "string", description: "Chinese meaning / translation" },
              note:     { type: "string", description: "Short usage note" },
              level:    { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "Estimated CEFR level" },
            },
            required: ["sentence"],
          },
        },
      },
      required: ["sentences"],
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

  list_events: {
    name: "list_events",
    description: "List the user's calendar events, most recent first. Use this to find an event's id before calling update_event or delete_event, to answer questions about the user's schedule, or to check for conflicts before creating a new event. Use from/to (YYYY-MM-DD) to narrow to a date range — e.g. 'today', 'this week', 'next month' — and query to filter by title/description/location text.",
    input_schema: {
      type: "object",
      properties: {
        from:  { type: "string", description: "Only include events starting on or after this date, YYYY-MM-DD. Omit for no lower bound." },
        to:    { type: "string", description: "Only include events starting on or before this date, YYYY-MM-DD. Omit for no upper bound." },
        query: { type: "string", description: "Optional text filter over title, description, and location." },
        limit: { type: "number", description: "Maximum events to return. Default 30, maximum 100." },
      },
      required: [],
    },
  },

  create_event: {
    name: "create_event",
    description: "Create a new calendar event. Call this when the user asks you to schedule, add, book, or create an event/meeting/reminder. Times use the user's local wall-clock time, formatted as 'YYYY-MM-DD HH:mm' for a timed event or plain 'YYYY-MM-DD' for an all-day event (set all_day true in that case). Work out concrete dates from the conversation's current date rather than asking the user to do the math (e.g. 'tomorrow at 3pm', 'next Friday').",
    input_schema: {
      type: "object",
      properties: {
        title:       { type: "string", description: "Event title" },
        start:       { type: "string", description: "Start, 'YYYY-MM-DD HH:mm' (timed) or 'YYYY-MM-DD' (all-day)" },
        end:         { type: "string", description: "End, same format as start. For a point-in-time reminder, use the same value as start." },
        all_day:     { type: "boolean", description: "True for an all-day event. Default false." },
        description: { type: "string", description: "Optional notes/description" },
        location:    { type: "string", description: "Optional location" },
      },
      required: ["title", "start", "end"],
    },
  },

  update_event: {
    name: "update_event",
    description: "Edit an existing calendar event — reschedule it, rename it, or change its description/location. Call list_events first if you don't already have the event's id from this conversation. Only send the fields that are changing; omitted fields keep their current value.",
    input_schema: {
      type: "object",
      properties: {
        id:          { type: "string", description: "Event id, from list_events or a prior create_event/list_events result" },
        title:       { type: "string", description: "New title" },
        start:       { type: "string", description: "New start, 'YYYY-MM-DD HH:mm' (timed) or 'YYYY-MM-DD' (all-day)" },
        end:         { type: "string", description: "New end, same format as start" },
        all_day:     { type: "boolean", description: "Switch between timed and all-day" },
        description: { type: "string", description: "New notes/description" },
        location:    { type: "string", description: "New location" },
      },
      required: ["id"],
    },
  },

  delete_event: {
    name: "delete_event",
    description: "Permanently delete a calendar event. Call list_events first if you don't already have the event's id from this conversation — confirm you have the right one (title/time) before deleting, since this cannot be undone.",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event id, from list_events" },
      },
      required: ["id"],
    },
  },
};

export function getEnabledTools(groups: Set<ToolGroupKey>): ToolDef[] {
  const names = new Set<string>();
  for (const g of groups) TOOL_GROUPS[g].tools.forEach((n) => names.add(n));
  return [...names].map((n) => ALL_TOOL_DEFS[n]).filter(Boolean);
}

// ── Tool Executor ──────────────────────────────────────────────────────────

/** Tools whose execution writes to the database. A temporary (private) chat
 *  promises "nothing here is stored" — the UI copy says exactly that — so
 *  these are refused in private mode rather than silently persisting data
 *  derived from a conversation the user was told is ephemeral. Read-only
 *  tools (search/list/stats/summarize) stay available. */
const WRITE_TOOL_NAMES = new Set([
  "save_word",
  "add_words_to_vocab",
  "save_sentences",
  "insert_into_document",
  "save_note_as_document",
  "create_event",
  "update_event",
  "delete_event",
]);

export async function executeTool(call: ToolCall, options: { privateMode?: boolean } = {}): Promise<ToolResult> {
  const { id, name, input } = call;
  if (options.privateMode && WRITE_TOOL_NAMES.has(name)) {
    return {
      tool_use_id: id,
      content: "This is a temporary chat — nothing is saved. Ask again in a normal chat to persist this.",
      is_error: true,
    };
  }
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

      case "get_vocabulary_stats": {
        const wordCount: number = await invoke("db_get_word_count");
        return {
          tool_use_id: id,
          content: `Vocabulary stats: ${wordCount} saved word${wordCount === 1 ? "" : "s"}.`,
        };
      }

      case "list_vocabulary": {
        const { query, limit, offset, sortBy, levelFilter, random } = input as any;
        const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        const results: any[] = await invoke("db_get_words", {
          search: query || null,
          levelFilter: levelFilter || null,
          sortBy: sortBy || null,
          dateField: null,
          dateFrom: null,
          dateTo: null,
        });
        const pool = random ? shuffle(results) : results;
        const page = pool.slice(safeOffset, safeOffset + safeLimit);
        if (page.length === 0) {
          return {
            tool_use_id: id,
            content: results.length === 0
              ? "No vocabulary words found."
              : `No words found at offset ${safeOffset}. The library has ${results.length} words.`,
          };
        }
        const lines = page.map((w: any, i: number) => {
          const meaning = w.zh ? ` (${w.zh})` : "";
          const level = w.level ? ` [${w.level}]` : "";
          const srs = Number(w.srs_level || 0) > 0 ? ` SRS${w.srs_level}` : "";
          return `${safeOffset + i + 1}. ${w.word}${meaning}${level}${srs}`;
        }).join("\n");
        const total = results.length;
        const shown = page.length;
        return {
          tool_use_id: id,
          content: `Vocabulary has ${total} words; showing ${shown} (${safeOffset + 1}-${safeOffset + shown}):\n${lines}`,
        };
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

      case "save_sentences": {
        const { sentences } = input as { sentences?: { sentence: string; zh?: string; note?: string; level?: string }[] };
        const items = sentences ?? [];
        if (items.length === 0) {
          return { tool_use_id: id, content: "No sentences provided to save.", is_error: true };
        }
        let added = 0;
        let skipped = 0;
        for (const item of items) {
          const sentence = item.sentence?.trim();
          if (!sentence) continue;
          const result: { created: boolean } | null = await invoke("db_save_sentence", {
            sentence,
            zh: item.zh ?? "",
            note: item.note ?? "",
            level: item.level ?? "",
            source: "chat",
          });
          if (result?.created) added += 1;
          else if (result) skipped += 1;
        }
        if (added > 0) window.dispatchEvent(new CustomEvent("sentences-updated"));
        const suffix = skipped > 0 ? `, skipped ${skipped} already saved` : "";
        return { tool_use_id: id, content: `✓ Saved ${added} sentence${added === 1 ? "" : "s"} to the sentence library${suffix}.` };
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
          status: doc.status ?? "",
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
        const docId = await saveNoteAsDocument(title, mdContent);
        return { tool_use_id: id, content: `✓ Saved "${title}" to Documents (#${docId}).` };
      }

      case "list_events": {
        const { from, to, query, limit } = input as { from?: string; to?: string; query?: string; limit?: number };
        const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
        const all: any[] = await invoke("db_list_calendar_events");
        const q = (query ?? "").trim().toLowerCase();
        const filtered = all.filter((e) => {
          if (from && e.start.slice(0, 10) < from) return false;
          if (to && e.start.slice(0, 10) > to) return false;
          if (q && !(
            e.title.toLowerCase().includes(q)
            || e.description.toLowerCase().includes(q)
            || e.location.toLowerCase().includes(q)
          )) return false;
          return true;
        });
        if (filtered.length === 0) return { tool_use_id: id, content: "No matching events." };
        const page = filtered.slice(0, safeLimit);
        const lines = page.map((e) =>
          `- [${e.id}] "${e.title}" ${e.start} → ${e.end}${e.all_day ? " (all day)" : ""}${e.location ? ` @ ${e.location}` : ""}`
        ).join("\n");
        return {
          tool_use_id: id,
          content: `${filtered.length} event${filtered.length === 1 ? "" : "s"}${filtered.length > page.length ? `, showing ${page.length}` : ""}:\n${lines}`,
        };
      }

      case "create_event": {
        const { title, start, end, all_day, description, location } = input as {
          title: string; start: string; end: string; all_day?: boolean; description?: string; location?: string;
        };
        const eventId: string = await invoke("db_create_calendar_event", {
          title, start, end,
          allDay: all_day ?? false,
          description: description ?? "",
          location: location ?? "",
        });
        window.dispatchEvent(new CustomEvent("calendar-updated"));
        return { tool_use_id: id, content: `✓ Created "${title}" (${start} → ${end}), id ${eventId}.` };
      }

      case "update_event": {
        const { id: eventId, title, start, end, all_day, description, location } = input as {
          id: string; title?: string; start?: string; end?: string; all_day?: boolean; description?: string; location?: string;
        };
        let startWire = start;
        let endWire = end;
        if (all_day !== undefined) {
          // The Rust update COALESCEs omitted fields, so flipping allDay
          // while leaving start/end on the other format leaves flag and
          // format divergent — the grid then keeps rendering the old shape.
          // Pull the row's current strings when the model only sent allDay.
          if (startWire === undefined || endWire === undefined) {
            const rows = await invoke<{ id: string; start: string; end: string }[]>("db_list_calendar_events");
            const row = rows.find((r) => r.id === eventId);
            if (row) {
              startWire ??= row.start;
              endWire ??= row.end;
            }
          }
          if (startWire) startWire = all_day ? startWire.slice(0, 10) : startWire.length === 10 ? `${startWire} 00:00` : startWire;
          if (endWire) endWire = all_day ? endWire.slice(0, 10) : endWire.length === 10 ? `${endWire} 00:00` : endWire;
        }
        await invoke("db_update_calendar_event", {
          id: eventId, title, start: startWire, end: endWire, allDay: all_day, description, location,
        });
        window.dispatchEvent(new CustomEvent("calendar-updated"));
        return { tool_use_id: id, content: `✓ Updated event ${eventId}.` };
      }

      case "delete_event": {
        const { id: eventId } = input as { id: string };
        await invoke("db_delete_calendar_event", { eventId });
        window.dispatchEvent(new CustomEvent("calendar-updated"));
        return { tool_use_id: id, content: `✓ Deleted event ${eventId}.` };
      }

      default:
        return { tool_use_id: id, content: `Unknown tool: ${name}`, is_error: true };
    }
  } catch (e: any) {
    return { tool_use_id: id, content: `Error in ${name}: ${e?.message ?? String(e)}`, is_error: true };
  }
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
