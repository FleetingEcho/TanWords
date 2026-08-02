import { describe, expect, it } from "vitest";
import { requiresAttachmentPassword } from "./privateDocumentPolicy";

describe("private document sensitive actions", () => {
  it("requires a fresh password for attachment download and delete", () => {
    expect(requiresAttachmentPassword(true, "download")).toBe(true);
    expect(requiresAttachmentPassword(true, "delete")).toBe(true);
  });

  it("does not challenge normal documents", () => {
    expect(requiresAttachmentPassword(false, "download")).toBe(false);
    expect(requiresAttachmentPassword(false, "delete")).toBe(false);
  });
});
