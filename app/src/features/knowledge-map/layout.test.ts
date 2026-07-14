import { radialLayout } from "./layout";
it("positions every connected node",()=>{const map:any={nodes:[{id:1,parent_id:null},{id:2,parent_id:1},{id:3,parent_id:2}]};expect(radialLayout(map).size).toBe(3)});

it("keeps a generated sibling batch visually separated", () => {
  const nodes = [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }, ...Array.from({ length: 10 }, (_, index) => ({ id: index + 3, parent_id: 2 }))];
  const positions = radialLayout({ nodes } as any);
  const children = nodes.slice(2).map((node) => positions.get(node.id)!);
  for (let index = 1; index < children.length; index++) {
    expect(Math.hypot(children[index].x - children[index - 1].x, children[index].y - children[index - 1].y)).toBeGreaterThan(110);
  }
});
