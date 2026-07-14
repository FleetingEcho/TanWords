import { radialLayout } from "./layout";
it("positions every connected node",()=>{const map:any={nodes:[{id:1,parent_id:null},{id:2,parent_id:1},{id:3,parent_id:2}]};expect(radialLayout(map).size).toBe(3)});
