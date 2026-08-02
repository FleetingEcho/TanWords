import type { SceneDefinition } from "./types";

const object = (
  key: string, labelEn: string, labelZh: string,
  category: SceneDefinition["objects"][number]["category"],
  position: [number, number, number], size: [number, number, number],
  color: string, allowedActions: string[],
) => ({ key, labelEn, labelZh, category, position, size, color, allowedActions });

export const KITCHEN_MANIFEST: SceneDefinition = {
  key: "kitchen",
  nameEn: "Kitchen",
  nameZh: "厨房",
  version: 1,
  actions: ["open", "close", "wash", "rinse", "cut", "chop", "stir", "boil", "fry", "bake", "pour", "store", "drain", "serve"],
  objects: [
    object("refrigerator", "refrigerator", "冰箱", "appliance", [-3.8, 1.4, -2.3], [1.25, 2.8, 1.15], "#b8c4cc", ["open", "close", "store"]),
    object("stove", "stove", "炉灶", "appliance", [0.2, 0.65, -2.65], [1.7, 1.3, 0.9], "#4b5563", ["boil", "fry"]),
    object("oven", "oven", "烤箱", "appliance", [1.7, 0.65, -2.65], [1.15, 1.3, 0.9], "#64748b", ["open", "close", "bake"]),
    object("sink", "sink", "水槽", "fixture", [-1.7, 0.92, -2.55], [1.5, 0.22, 0.85], "#93a4ad", ["wash", "rinse", "drain"]),
    object("faucet", "faucet", "水龙头", "fixture", [-1.7, 1.45, -2.7], [0.18, 0.9, 0.18], "#cbd5e1", ["wash", "rinse", "pour"]),
    object("countertop", "countertop", "操作台", "fixture", [0, 0.82, -2.9], [5.8, 0.18, 0.75], "#d6b98c", ["serve"]),
    object("cabinet", "cabinet", "橱柜", "storage", [3.4, 1.1, -2.8], [1.5, 2.2, 0.7], "#a97850", ["open", "close", "store"]),
    object("island", "kitchen island", "中岛台", "fixture", [0, 0.75, 0.4], [3.3, 1.5, 1.45], "#c49a6c", ["cut", "chop", "serve"]),
    object("cutting_board", "cutting board", "砧板", "utensil", [-0.6, 1.56, 0.3], [1.05, 0.08, 0.7], "#deb887", ["cut", "chop"]),
    object("knife", "knife", "刀", "utensil", [-0.5, 1.67, 0.25], [0.75, 0.06, 0.12], "#dbe4e8", ["cut", "chop"]),
    object("saucepan", "saucepan", "炖锅", "cookware", [0.1, 1.48, -2.55], [0.75, 0.35, 0.75], "#374151", ["boil", "stir", "pour"]),
    object("frying_pan", "frying pan", "煎锅", "cookware", [0.75, 1.48, -2.55], [0.85, 0.22, 0.85], "#1f2937", ["fry", "stir", "serve"]),
    object("colander", "colander", "滤盆", "cookware", [-2.1, 1.58, 0.45], [0.7, 0.35, 0.7], "#94a3b8", ["rinse", "drain"]),
    object("mixing_bowl", "mixing bowl", "搅拌碗", "cookware", [1.25, 1.6, 0.45], [0.78, 0.38, 0.78], "#86b6c6", ["stir", "pour"]),
    object("spatula", "spatula", "锅铲", "utensil", [1.8, 1.63, 0.45], [0.65, 0.08, 0.16], "#805d3d", ["stir", "fry", "serve"]),
    object("whisk", "whisk", "打蛋器", "utensil", [1.7, 1.65, 0.1], [0.55, 0.12, 0.12], "#cbd5e1", ["stir"]),
    object("kettle", "kettle", "水壶", "appliance", [2.45, 1.35, -2.5], [0.62, 0.75, 0.62], "#b4534b", ["boil", "pour"]),
    object("plate", "plate", "盘子", "cookware", [0.15, 1.58, 0.55], [0.72, 0.08, 0.72], "#f1f5f9", ["serve"]),
    object("mug", "mug", "马克杯", "cookware", [0.75, 1.72, 0.5], [0.35, 0.45, 0.35], "#d97757", ["pour", "serve"]),
    object("tomato", "tomato", "番茄", "ingredient", [-0.9, 1.72, 0.35], [0.24, 0.24, 0.24], "#dc413c", ["wash", "rinse", "cut", "chop"]),
  ],
};

export const KITCHEN_OBJECT_KEYS = new Set(KITCHEN_MANIFEST.objects.map((item) => item.key));
export const KITCHEN_ACTIONS = new Set(KITCHEN_MANIFEST.actions);

export function validateKitchenManifest(): string[] {
  const errors: string[] = [];
  const keys = new Set<string>();
  for (const item of KITCHEN_MANIFEST.objects) {
    if (keys.has(item.key)) errors.push(`Duplicate object_key: ${item.key}`);
    keys.add(item.key);
    for (const action of item.allowedActions) {
      if (!KITCHEN_ACTIONS.has(action)) errors.push(`Unknown action ${action} on ${item.key}`);
    }
  }
  if (KITCHEN_MANIFEST.objects.length < 15) errors.push("Kitchen requires at least 15 interactive objects");
  return errors;
}
