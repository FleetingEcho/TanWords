import { jsonrepair } from "jsonrepair";
import type { AIProvider } from "@/providers/base";
import type { KnowledgeNode, NewKnowledgeNode } from "./types";

export const DEFAULT_BRANCHES: NewKnowledgeNode[] = [
 {kind:"category",label:"Core Vocabulary",zh:"核心词汇",level:"",note:"Essential words and concepts"},
 {kind:"category",label:"Actions & Processes",zh:"动作与过程",level:"",note:"What people do and how things happen"},
 {kind:"category",label:"Objects & Concepts",zh:"对象与概念",level:"",note:"Things, roles and abstract concepts"},
 {kind:"category",label:"Situations & Use Cases",zh:"场景与用法",level:"",note:"Where and when the language is used"},
 {kind:"category",label:"Problems & Solutions",zh:"问题与解决",level:"",note:"Common difficulties and responses"},
 {kind:"category",label:"Advanced Expressions",zh:"高级表达",level:"",note:"Precise phrases and C1/C2 language"},
];

function simpleParse(raw:string):NewKnowledgeNode[]{
 const start=raw.indexOf("[");
 if(start>=0){try{const data=JSON.parse(jsonrepair(raw.slice(start)));return (Array.isArray(data)?data:[]).map((x:any)=>Array.isArray(x)?{label:String(x[0]??""),zh:String(x[1]??""),level:String(x[2]??""),kind:(String(x[3]??"").includes("phrase")?"phrase":"word") as "word"|"phrase",note:String(x[4]??"")}:{label:String(x.label??x.word??""),zh:String(x.zh??""),level:String(x.level??""),kind:(x.kind==="phrase"||x.kind==="situation"?x.kind:"word"),note:String(x.note??x.example??"")}).filter(x=>x.label.trim()).slice(0,12)}catch{}}
 return raw.split("\n").map(line=>line.replace(/^[-*\d.\s]+/,"").trim()).filter(Boolean).slice(0,10).map(label=>({kind:"word" as const,label,zh:"",level:"",note:""}));
}

async function collect(provider:AIProvider,system:string,user:string){
 const run=(async()=>{const chunks:string[]=[];for await(const c of provider.generate(system,user))chunks.push(c);return chunks.join("")})();
 let timer:number|undefined;const timeout=new Promise<string>((_,reject)=>{timer=window.setTimeout(()=>reject(new Error("本地模型生成超时")),45000)});
 try{return await Promise.race([run,timeout])}finally{if(timer)window.clearTimeout(timer)}
}

export async function generateBranch(provider:AIProvider,root:string,parent:Pick<KnowledgeNode,"label"|"zh"|"kind">|NewKnowledgeNode,targetLevels:string,exclude:string[]=[]):Promise<NewKnowledgeNode[]>{
 const system="You generate practical English vocabulary for a learner. Return only a short JSON array. Follow the format exactly. No markdown and no explanation.";
 const user=`Topic: ${root}\nBranch to expand: ${parent.label} (${parent.zh})\nLearner: CEFR ${targetLevels}.\nReturn 8-10 useful English items strongly related to this branch. Avoid: ${exclude.slice(0,100).join(", ")}.\nUse this very simple format only: [["English word or phrase","简短中文","B1|B2|C1|C2","word|phrase","one short usage note"]].`;
 return simpleParse(await collect(provider,system,user));
}

export async function expandNode(provider:AIProvider,root:string,node:KnowledgeNode,targetLevels:string,exclude:string[]):Promise<NewKnowledgeNode[]>{return generateBranch(provider,root,{label:node.label,zh:node.zh,kind:node.kind},targetLevels,exclude)}
