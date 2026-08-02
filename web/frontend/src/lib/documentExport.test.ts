import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";

const { downloadMock, invokeMock, markdownToBlocksOffThreadMock, blocksToHtmlOffThreadMock } = vi.hoisted(() => ({
  downloadMock: vi.fn((_filename: string, _blob: Blob) => {}),
  invokeMock: vi.fn(async (_command: string, args: Record<string, unknown>) => {
    if (args.id === "11111111-1111-4111-8111-111111111111") {
      return { mime_type: "image/webp", data_base64: "YWJjZA==" };
    }
    throw new Error("missing asset");
  }),
  markdownToBlocksOffThreadMock: vi.fn(async () => []),
  blocksToHtmlOffThreadMock: vi.fn(async () => `<pre class="mermaid">graph TD; A-->B;</pre>`),
}));

// Web export goes through browser downloads/print instead of desktop dialogs.
vi.mock("@/api/platform", () => ({
  downloadBlob: downloadMock,
  downloadText: vi.fn(),
  openExternal: vi.fn(async () => {}),
  pickFiles: vi.fn(async () => []),
  readClipboardImage: vi.fn(async () => null),
}));

vi.mock("@/api/client", () => ({
  invoke: invokeMock,
}));

vi.mock("./documentWorkerClient", () => ({
  markdownToBlocksOffThread: markdownToBlocksOffThreadMock,
  blocksToHtmlOffThread: blocksToHtmlOffThreadMock,
}));

import { exportEditorHtml, exportMarkdownAsHtml, exportMarkdownAsPdf } from "./documentExport";

const assetId = "11111111-1111-4111-8111-111111111111";

async function lastDownload(): Promise<{ filename: string; data: string }> {
  const call = downloadMock.mock.calls[downloadMock.mock.calls.length - 1] as unknown as [string, Blob] | undefined;
  expect(call).toBeTruthy();
  return { filename: call![0], data: await call![1].text() };
}

beforeAll(() => {
  // jsdom never implemented these; the print path and platform.downloadBlob
  // use them, so give tests inert stand-ins.
  if (!URL.createObjectURL) URL.createObjectURL = () => "blob:mock";
  if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
});

describe("documentExport", () => {
  beforeEach(() => {
    downloadMock.mockClear();
    invokeMock.mockClear();
    markdownToBlocksOffThreadMock.mockClear();
    blocksToHtmlOffThreadMock.mockClear();
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

    const { filename, data } = await lastDownload();
    expect(filename).toBe("Export Test.html");
    expect(data).toContain(`src="data:image/webp;base64,YWJjZA=="`);
    expect(data).not.toContain(`tanwords-asset://${assetId}`);
    expect(data).toContain(`class="shiki github-light"`);
    expect(data).toContain(`<span style="color:#D73A49">const</span>`);
    expect(data).toContain(`console.</span>`);
    expect(data).toContain(`pre { background: #f3f4f6; border: 1px solid #d1d5db; padding: 16px;`);
    expect(data).toContain(`"PingFang SC"`);
  });

  it("inlines loopback asset-URL images as data URLs", async () => {
    const assetUrl = "http://127.0.0.1:4242/asset?path=%2Fvault%2Fassets%2Fa.png&token=tok";
    const png = new Uint8Array([137, 80, 78, 71]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(png, {
      headers: { "content-type": "image/png" },
    })));

    const editor = {
      blocksToHTMLLossy: () => `<img src="${assetUrl}" alt="local">`,
    };
    await exportEditorHtml(editor, "Local Export");

    const { data } = await lastDownload();
    expect(data).toContain(`src="data:image/png;base64,${btoa("\x89PNG")}"`);
    expect(data).not.toContain(assetUrl);
    vi.unstubAllGlobals();
  });

  it("exports raw markdown as HTML through the shared pipeline", async () => {
    await exportMarkdownAsHtml("Markdown Note", "# Note\n\nSome text");

    expect(markdownToBlocksOffThreadMock).toHaveBeenCalledWith("# Note\n\nSome text");
    expect(blocksToHtmlOffThreadMock).toHaveBeenCalledWith([]);
    const { data } = await lastDownload();
    expect(data).toContain("<title>Markdown Note</title>");
  });

  it("exports raw markdown via the print path, falling back to an HTML download when popups are blocked", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    await exportMarkdownAsPdf("Markdown PDF", "# PDF\n\nContent");

    expect(markdownToBlocksOffThreadMock).toHaveBeenCalledWith("# PDF\n\nContent");
    const { filename, data } = await lastDownload();
    expect(filename).toBe("Markdown PDF.html");
    expect(data).toContain("<title>Markdown PDF</title>");
    openSpy.mockRestore();
  });
});
