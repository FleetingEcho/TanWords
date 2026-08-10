import { describe, expect, it } from "vitest";
import { STATUS_LIST, statusLabelKey } from "./documentStatus";

describe("documentStatus", () => {
  it("exposes the closed set in display order", () => {
    expect(STATUS_LIST).toEqual(["active", "onhold", "completed", "dropped"]);
  });

  it("maps each status to its i18n key, and the empty one to none", () => {
    expect(statusLabelKey("active")).toBe("doc.statusActive");
    expect(statusLabelKey("onhold")).toBe("doc.statusOnHold");
    expect(statusLabelKey("completed")).toBe("doc.statusCompleted");
    expect(statusLabelKey("dropped")).toBe("doc.statusDropped");
    expect(statusLabelKey("")).toBe("doc.noStatus");
  });
});
