import { describe, expect, it } from "vitest";
import { MAX_APP_BG_UPLOAD_BYTES } from "./GeneralSection";

describe("app background upload limit", () => {
  it("accepts images up to 20 MB", () => {
    expect(MAX_APP_BG_UPLOAD_BYTES).toBe(20 * 1024 * 1024);
  });
});
