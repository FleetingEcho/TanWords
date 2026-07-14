import type { KnowledgeNode } from "./types";

export function buildChildrenMap(nodes: KnowledgeNode[]) {
  const children = new Map<number | null, KnowledgeNode[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parent_id) ?? [];
    siblings.push(node);
    children.set(node.parent_id, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }
  return children;
}

export function getBreadcrumb(nodes: KnowledgeNode[], nodeId: number) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: KnowledgeNode[] = [];
  const visited = new Set<number>();
  let current = byId.get(nodeId);
  while (current && !visited.has(current.id)) {
    result.unshift(current);
    visited.add(current.id);
    current = current.parent_id === null ? undefined : byId.get(current.parent_id);
  }
  return result;
}
