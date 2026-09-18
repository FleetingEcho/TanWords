/** Tests for the tanNotes → blocks conversion, against the shapes the REAL
 *  tanNotes database stores (paragraphs with link marks, epoch-millis
 *  timestamps) — same lesson as blockAdapter.test.ts: assert on reality. */
import { describe, it, expect } from "vitest";
import { classifyImageSrc, convertTanNotesNote, deriveTitle, epochMsToStamp } from "./tanNotesImport";

/** Verbatim doc from the real tanNotes DB on this machine (links only). */
const REAL_NOTE = {
  id: "01a0b58c-7c93-75a2-8275-899992663a31",
  doc: JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "1.django debugger skill" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "2.Track web console QA request " },
          {
            type: "text",
            marks: [{
              type: "link",
              attrs: { href: "https://example.com/T26032", target: "_blank", rel: "noopener noreferrer nofollow", class: null },
            }],
            text: "https://example.com/T26032",
          },
        ],
      },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "3." }] },
    ],
  }),
  plain_text: "1.django debugger skill\n\n2.Track web console QA request https://example.com/T26032\n\n\n\n3.",
  color: "green",
  corner: "rounded",
  opacity: 100,
  always_on_top: 1 as unknown as boolean,
  font_family: null,
  font_size: null,
  collapsed: 0 as unknown as boolean,
  x: 1486,
  y: 1242,
  w: 392,
  h: 517,
  is_open: 0 as unknown as boolean,
  created_at: 1789752278163,
  updated_at: 1789752391436,
  deleted_at: null,
};

describe("tanNotes conversion", () => {
  it("converts a real tanNotes note to blocks with the link intact", () => {
    const converted = convertTanNotesNote(REAL_NOTE);
    expect(converted.title).toBe("1.django debugger skill");
    expect(converted.images).toEqual([]);
    expect(converted.contentText).toContain("2.Track web console QA request https://example.com/T26032");
    // The link mark survives into TanNotes' storage format.
    expect(converted.content).toContain("https://example.com/T26032");
    expect(converted.content).toContain('"type":"link"');
    expect(converted.color).toBe("green");
    expect(converted.opacity).toBe(100);
    expect(converted.w).toBe(392);
    expect(converted.deleted).toBe(false);
  });

  it("renames tanNotes' image `src` attr to `url` and collects it", () => {
    const note = {
      ...REAL_NOTE,
      doc: JSON.stringify({
        type: "doc",
        content: [{
          type: "image",
          attrs: { src: "a1b2c3/photo.png", alt: "shot", title: null },
        }],
      }),
    };
    const converted = convertTanNotesNote(note);
    expect(converted.images).toEqual(["a1b2c3/photo.png"]);
    expect(converted.content).not.toContain('"src"');
    expect(converted.content).toContain("a1b2c3/photo.png");
  });

  it("flags trashed notes", () => {
    const converted = convertTanNotesNote({ ...REAL_NOTE, deleted_at: 1789800000000 });
    expect(converted.deleted).toBe(true);
  });
});

describe("tanNotes stamp conversion", () => {
  it("converts epoch millis to the core's UTC stamp format", () => {
    // 1789752278163 ms → 2026-09-19T… (UTC); format is what SQL compares.
    expect(epochMsToStamp(1789752278163)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(epochMsToStamp(0)).toBe("1970-01-01 00:00:00");
    expect(epochMsToStamp(null)).toBe("1970-01-01 00:00:00");
  });
});

describe("deriveTitle", () => {
  it("takes the first non-empty line", () => {
    expect(deriveTitle("\n\nsecond line\nthird")).toBe("second line");
  });
  it("falls back when the note is empty", () => {
    expect(deriveTitle("")).toBe("Imported note");
  });
});

describe("classifyImageSrc", () => {
  it("splits data URIs", () => {
    const out = classifyImageSrc("data:image/png;base64,aGVsbG8=");
    expect(out).toEqual({ kind: "data", mime: "image/png", base64: "aGVsbG8=" });
  });
  it("leaves remote URLs alone", () => {
    expect(classifyImageSrc("https://example.com/a.png")).toEqual({ kind: "leave" });
  });
  it("treats bare paths as attachments", () => {
    expect(classifyImageSrc("note-dir/photo.png")).toEqual({ kind: "attachment", rel: "note-dir/photo.png" });
  });
});
