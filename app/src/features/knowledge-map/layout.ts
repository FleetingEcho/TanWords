import type { KnowledgeMapDetail } from "./types";
export interface PositionedNode {id:number;x:number;y:number}
export function radialLayout(map:KnowledgeMapDetail):Map<number,PositionedNode>{
 const out=new Map<number,PositionedNode>();const root=map.nodes.find(n=>n.parent_id===null);if(!root)return out;out.set(root.id,{id:root.id,x:0,y:0});
 const children=new Map<number,number[]>();for(const n of map.nodes){if(n.parent_id!=null){const a=children.get(n.parent_id)??[];a.push(n.id);children.set(n.parent_id,a)}}
 const walk=(id:number,start:number,end:number,depth:number)=>{const ids=children.get(id)??[];ids.forEach((child,i)=>{const angle=start+(end-start)*(i+.5)/ids.length;const radius=depth===1?260:180;const p=out.get(id)!;out.set(child,{id:child,x:p.x+Math.cos(angle)*radius,y:p.y+Math.sin(angle)*radius});const spread=Math.min(Math.PI*.75,(end-start)/Math.max(1,ids.length)*1.4);walk(child,angle-spread/2,angle+spread/2,depth+1)})};walk(root.id,-Math.PI,Math.PI,1);return out;
}
