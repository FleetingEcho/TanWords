import { afterEach, describe, expect, it } from "vitest";
import { rangeBetween, sameRange, wordRangeAt } from "./touchSelection";

/** jsdom has no layout, so caret hit-testing is stubbed: the "point" is just
 *  the offset we want the caret to land on. Everything above that — growing a
 *  caret into a word, joining two points into a span — is real. */
function caretAt(text: Text, offset: number) {
  (document as unknown as { caretRangeFromPoint: (x: number, y: number) => Range }).caretRangeFromPoint = (x) => {
    const range = document.createRange();
    range.setStart(text, x);
    range.collapse(true);
    return range;
  };
  return offset;
}

function paragraph(content: string): Text {
  const p = document.createElement("p");
  p.textContent = content;
  document.body.appendChild(p);
  return p.firstChild as Text;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("wordRangeAt", () => {
  const SENTENCE = "The cheapest shared machines were fine.";

  it("selects the whole word the caret lands inside", () => {
    const text = paragraph(SENTENCE);
    expect(wordRangeAt(caretAt(text, 6), 0)?.toString()).toBe("cheapest");
  });

  it("still means the word when the caret lands just past its last letter", () => {
    const text = paragraph(SENTENCE);
    expect(wordRangeAt(caretAt(text, 3), 0)?.toString()).toBe("The");
  });

  it("keeps words with inner punctuation whole", () => {
    const text = paragraph("It doesn't feel state-of-the-art.");
    expect(wordRangeAt(caretAt(text, 5), 0)?.toString()).toBe("doesn't");
    expect(wordRangeAt(caretAt(text, 20), 0)?.toString()).toBe("state-of-the-art");
  });

  it("selects nothing on blank space, so a tap there dismisses", () => {
    const text = paragraph("word  gap");
    expect(wordRangeAt(caretAt(text, 5), 0)).toBeNull();
  });
});

describe("rangeBetween", () => {
  const SENTENCE = "The cheapest shared machines were fine.";

  it("grows the pivot word forward to the word under the finger", () => {
    const text = paragraph(SENTENCE);
    const pivot = wordRangeAt(caretAt(text, 4), 0)!;
    expect(rangeBetween(pivot, 23, 0).toString()).toBe("cheapest shared machines");
  });

  it("grows backwards when the drag goes the other way", () => {
    const text = paragraph(SENTENCE);
    const pivot = wordRangeAt(caretAt(text, 14), 0)!;
    expect(rangeBetween(pivot, 1, 0).toString()).toBe("The cheapest shared");
  });

  it("shrinks back as the finger returns, rather than stranding the far edge", () => {
    const text = paragraph(SENTENCE);
    const pivot = wordRangeAt(caretAt(text, 4), 0)!;
    rangeBetween(pivot, 30, 0);
    expect(rangeBetween(pivot, 14, 0).toString()).toBe("cheapest shared");
  });
});

describe("sameRange", () => {
  it("recognises a re-tap on the selected word", () => {
    const text = paragraph("The cheapest shared machines were fine.");
    const first = wordRangeAt(caretAt(text, 4), 0)!;
    const again = wordRangeAt(caretAt(text, 7), 0)!;
    expect(sameRange(first, again)).toBe(true);
    expect(sameRange(first, wordRangeAt(caretAt(text, 14), 0)!)).toBe(false);
  });
});
