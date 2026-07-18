import { describe, expect, it } from "vitest";
import { liftMermaid, lowerMermaid } from "./mermaidTransforms";

describe("Mermaid block transforms", () => {
  it("lifts Mermaid code fences, including nested blocks", () => {
    const blocks = [
      {
        type: "quote",
        children: [
          {
            type: "codeBlock",
            props: { language: "mermaid" },
            content: [{ type: "text", text: "graph TD\n  A --> B", styles: {} }],
          },
        ],
      },
    ];

    expect(liftMermaid(blocks as any)).toEqual([
      {
        type: "quote",
        children: [
          { type: "mermaid", props: { code: "graph TD\n  A --> B" } },
        ],
      },
    ]);
  });

  it("lowers charts back to portable Mermaid code fences", () => {
    expect(
      lowerMermaid([{ type: "mermaid", props: { code: "flowchart LR\n  A --> B" } }]),
    ).toEqual([
      {
        type: "codeBlock",
        props: { language: "mermaid" },
        content: [
          { type: "text", text: "flowchart LR\n  A --> B", styles: {} },
        ],
      },
    ]);
  });
});
