import type { KnowledgeMapDetail } from "./types";

export interface PositionedNode { id: number; x: number; y: number }

/**
 * Radial tree with tangent-spaced children. A parent's children form a row
 * perpendicular to the branch direction, so 8–12 generated nodes never pile
 * on top of one another. Deeper expansions keep growing away from the root.
 */
export function radialLayout(map: KnowledgeMapDetail): Map<number, PositionedNode> {
  const output = new Map<number, PositionedNode>();
  const root = map.nodes.find((node) => node.parent_id === null);
  if (!root) return output;
  output.set(root.id, { id: root.id, x: 0, y: 0 });

  const children = new Map<number, number[]>();
  for (const node of map.nodes) {
    if (node.parent_id == null) continue;
    const list = children.get(node.parent_id) ?? [];
    list.push(node.id);
    children.set(node.parent_id, list);
  }

  const roots = children.get(root.id) ?? [];
  roots.forEach((id, index) => {
    const angle = -Math.PI / 2 + index * Math.PI * 2 / Math.max(1, roots.length);
    output.set(id, { id, x: Math.cos(angle) * 330, y: Math.sin(angle) * 330 });
  });

  const placeDescendants = (parentId: number, depth: number) => {
    const parent = output.get(parentId);
    const ids = children.get(parentId) ?? [];
    if (!parent || !ids.length) return;
    const length = Math.hypot(parent.x, parent.y) || 1;
    const radial = { x: parent.x / length, y: parent.y / length };
    const tangent = { x: -radial.y, y: radial.x };
    const forward = depth === 2 ? 420 : 380;
    const spacing = depth === 2 ? 132 : 118;
    ids.forEach((id, index) => {
      const offset = (index - (ids.length - 1) / 2) * spacing;
      output.set(id, {
        id,
        x: parent.x + radial.x * forward + tangent.x * offset,
        y: parent.y + radial.y * forward + tangent.y * offset,
      });
      placeDescendants(id, depth + 1);
    });
  };
  roots.forEach((id) => placeDescendants(id, 2));
  return output;
}
