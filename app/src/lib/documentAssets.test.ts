import { describe, expect, it } from "vitest";
import {
  documentAssetIdsFromContent,
  prepareDocumentAssetsForExport,
  type DocumentAsset,
} from "./documentAssets";

const asset = (id: string, mime = "image/webp"): DocumentAsset => ({
  id,
  document_id: 7,
  file_name: "pasted image.webp",
  mime_type: mime,
  size: 3,
  data_base64: "YWJj",
});

describe("document assets", () => {
  it("finds unique attachment references in stored block JSON", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const content = `["tanwords-asset://${a}","tanwords-asset://${a}","tanwords-asset://${b}"]`;
    expect(documentAssetIdsFromContent(content)).toEqual([a, b]);
  });

  it("rewrites attachment URLs and emits portable export files", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const result = prepareDocumentAssetsForExport(
      `![diagram](tanwords-asset://${id})`,
      [asset(id)]
    );
    expect(result.content).toBe(`![diagram](./assets/${id}.webp)`);
    expect(result.assets).toEqual([{ name: `${id}.webp`, dataBase64: "YWJj" }]);
  });
});
