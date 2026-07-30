export function findTextMatches(
  root: HTMLElement,
  query: string,
  maxMatches = Number.POSITIVE_INFINITY,
): Range[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || maxMatches <= 0) return [];

  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      return parent?.closest("[aria-hidden='true'], script, style")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.data.toLocaleLowerCase();
    let offset = 0;
    while ((offset = text.indexOf(needle, offset)) !== -1) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + needle.length);
      ranges.push(range);
      if (ranges.length >= maxMatches) return ranges;
      offset += Math.max(needle.length, 1);
    }
  }
  return ranges;
}
