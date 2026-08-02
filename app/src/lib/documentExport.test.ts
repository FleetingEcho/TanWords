import { describe, expect, it, vi } from "vitest";

const { saveMock, writeMock, invokeMock, markdownToBlocksOffThreadMock, blocksToHtmlOffThreadMock } = vi.hoisted(() => ({
  saveMock: vi.fn(async () => "/tmp/exported.html"),
  writeMock: vi.fn(async () => {}),
  invokeMock: vi.fn(async (_command: string, args: Record<string, unknown>) => {
    if (args.id === "11111111-1111-4111-8111-111111111111") {
      return { mime_type: "image/webp", data_base64: "YWJjZA==" };
    }
    throw new Error("missing asset");
  }),
  markdownToBlocksOffThreadMock: vi.fn(async () => []),
  blocksToHtmlOffThreadMock: vi.fn(async () => `<pre class="mermaid">graph TD; A-->B;</pre>`),
}));

vi.mock("@/ipc/dialog", () => ({
  saveDialog: saveMock,
}));

vi.mock("@/ipc/host", () => ({
  callMain: writeMock,
}));

vi.mock("@/ipc/backend", () => ({
  invoke: invokeMock,
}));

vi.mock("@/platform", () => ({
  isDesktopHost: true,
}));

vi.mock("./documentWorkerClient", () => ({
  markdownToBlocksOffThread: markdownToBlocksOffThreadMock,
  blocksToHtmlOffThread: blocksToHtmlOffThreadMock,
}));

import { exportEditorHtml, exportMarkdownAsHtml, exportMarkdownAsPdf } from "./documentExport";

const assetId = "11111111-1111-4111-8111-111111111111";

describe("documentExport", () => {
  beforeEach(() => {
    writeMock.mockClear();
    saveMock.mockClear();
    invokeMock.mockClear();
  });

  it("highlights code blocks and inlines database image assets", async () => {
    const html = `
      <div data-content-type="image">
        <figure>
          <img src="tanwords-asset://${assetId}" alt="pasted image">
        </figure>
      </div>
      <div data-content-type="codeBlock">
        <pre><code data-language="javascript">const answer = 42;
console.log(answer);</code></pre>
      </div>`;
    const editor = { blocksToHTMLLossy: () => html };

    await exportEditorHtml(editor, "Export Test");

    expect(writeMock).toHaveBeenCalledTimes(1);
    const [channel, payload] = writeMock.mock.calls[0] as unknown as [string, { path: string; data: string }];
    expect(channel).toBe("file:write");
    expect(payload.data).toContain(`src="data:image/webp;base64,YWJjZA=="`);
    expect(payload.data).not.toContain(`tanwords-asset://${assetId}`);
    expect(payload.data).toContain(`class="shiki github-light"`);
    expect(payload.data).toContain(`<span style="color:#D73A49">const</span>`);
    expect(payload.data).toContain(`console.</span>`);
    expect(payload.data).toContain(`pre { background: #f3f4f6; border: 1px solid #d1d5db; padding: 16px;`);
    expect(payload.data).toContain(`"PingFang SC"`);
  });

  it("inlines local vault image URLs as data URLs", async () => {
    const assetUrl = "http://127.0.0.1:4242/asset?path=%2Fvault%2Fassets%2Fa.png&token=tok";
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, {
      headers: { "content-type": "image/png" },
    })));

    const editor = {
      blocksToHTMLLossy: () => `<img src="${assetUrl}" alt="local">`,
    };
    await exportEditorHtml(editor, "Local Export");

    const [channel, payload] = writeMock.mock.calls[writeMock.mock.calls.length - 1] as unknown as [string, { path: string; data: string }];
    expect(channel).toBe("file:write");
    expect(payload.data).toContain(`src="data:image/png;base64,${btoa("\x89PNG")}"`);
    expect(payload.data).not.toContain(assetUrl);
    vi.unstubAllGlobals();
  });

  it("exports raw markdown as HTML through the shared pipeline", async () => {
    await exportMarkdownAsHtml("Markdown Note", "# Note\n\nSome text");

    expect(markdownToBlocksOffThreadMock).toHaveBeenCalledWith("# Note\n\nSome text");
    expect(blocksToHtmlOffThreadMock).toHaveBeenCalledWith([]);
    const [channel, payload] = writeMock.mock.calls[writeMock.mock.calls.length - 1] as unknown as [string, { path: string; data: string }];
    expect(channel).toBe("file:write");
    expect(payload.data).toContain("<title>Markdown Note</title>");
  });

  it("exports raw markdown as PDF through the shared pipeline", async () => {
    saveMock.mockResolvedValueOnce("/tmp/markdown.pdf");
    await exportMarkdownAsPdf("Markdown PDF", "# PDF\n\nContent");

    expect(markdownToBlocksOffThreadMock).toHaveBeenCalledWith("# PDF\n\nContent");
    const [channel, payload] = writeMock.mock.calls[writeMock.mock.calls.length - 1] as unknown as [string, { path: string; html: string }];
    expect(channel).toBe("window:printHtmlToPdf");
    expect(payload.path).toBe("/tmp/markdown.pdf");
    expect(payload.html).toContain("<title>Markdown PDF</title>");
  });
});
