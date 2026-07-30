import { describe, expect, it } from "vitest";
import { promoteLocalFileLinks } from "./localFileBlocks";

describe("promoteLocalFileLinks", () => {
  it("recognizes a standalone local asset link as a file block", () => {
    const [block] = promoteLocalFileLinks([{
      id: "one",
      type: "paragraph",
      props: { textAlignment: "left" },
      content: [{
        type: "link",
        href: "./assets/60a2160b-Week.zip",
        content: [{ type: "text", text: "Week1111.zip", styles: {} }],
      }],
      children: [],
    }]);

    expect(block).toMatchObject({
      id: "one",
      type: "file",
      props: {
        url: "./assets/60a2160b-Week.zip",
        name: "Week1111.zip",
      },
    });
  });

  it("leaves links embedded in prose unchanged", () => {
    const input = [{
      type: "paragraph",
      content: [
        { type: "text", text: "Get ", styles: {} },
        {
          type: "link",
          href: "./assets/file.zip",
          content: [{ type: "text", text: "the file", styles: {} }],
        },
      ],
      children: [],
    }];

    expect(promoteLocalFileLinks(input)[0].type).toBe("paragraph");
  });
});
