import { KITCHEN_MANIFEST, validateKitchenManifest } from "./kitchenManifest";

describe("Kitchen manifest", () => {
  it("has stable unique interactive objects and valid actions", () => {
    expect(validateKitchenManifest()).toEqual([]);
    expect(KITCHEN_MANIFEST.objects).toHaveLength(20);
    expect(new Set(KITCHEN_MANIFEST.objects.map((item) => item.key)).size).toBe(20);
  });
});
