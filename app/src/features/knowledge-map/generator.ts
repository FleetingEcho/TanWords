import { jsonrepair } from "jsonrepair";
import type { AIProvider } from "@/providers/base";
import type { KnowledgeNode, NewKnowledgeNode } from "./types";

export const DEFAULT_BRANCHES: NewKnowledgeNode[] = [
 {kind:"category",label:"Core Vocabulary",zh:"核心词汇",level:"",note:"Essential words and concepts"},
 {kind:"category",label:"Actions & Processes",zh:"动作与过程",level:"",note:"What people do and how things happen"},
 {kind:"category",label:"Objects & Concepts",zh:"对象与概念",level:"",note:"Things, roles and abstract concepts"},
 {kind:"category",label:"Situations & Use Cases",zh:"场景与用法",level:"",note:"Where and when the language is used"},
 {kind:"category",label:"Common Situational Sentences",zh:"常用情景句",level:"",note:"Five natural sentences people commonly use in this situation"},
 {kind:"category",label:"Problems & Solutions",zh:"问题与解决",level:"",note:"Common difficulties and responses"},
 {kind:"category",label:"Advanced Expressions",zh:"高级表达",level:"",note:"Precise phrases and C1/C2 language"},
];

const SENTENCE_FALLBACKS: NewKnowledgeNode[] = [
 {kind:"phrase",label:"What do you think about it?",zh:"你对此怎么看？",level:"B1",note:"Ask for the other person's opinion."},
 {kind:"phrase",label:"Could you tell me more about that?",zh:"你能再多说一点吗？",level:"B1",note:"Invite the other person to continue."},
 {kind:"phrase",label:"That's a good point.",zh:"这个观点很好。",level:"B1",note:"Acknowledge what someone has said."},
 {kind:"phrase",label:"I completely agree with you.",zh:"我完全同意你的看法。",level:"B1",note:"Express clear agreement."},
 {kind:"phrase",label:"I'm not sure about that.",zh:"我不太确定。",level:"B1",note:"Express polite uncertainty."},
 {kind:"phrase",label:"That makes sense.",zh:"这很有道理。",level:"B1",note:"Show that you understand the explanation."},
 {kind:"phrase",label:"It depends on the situation.",zh:"这取决于具体情况。",level:"B1",note:"Give a balanced response."},
 {kind:"phrase",label:"How about you?",zh:"你呢？",level:"A2",note:"Return the question naturally."},
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
 const sentences=parent.label==="Common Situational Sentences";
 const system="You generate practical English vocabulary and sentences for a learner. The topic may be a word or a full situation description in any language. Return only a short JSON array. Follow the format exactly. No markdown and no explanation.";
 const request=sentences
  ? "Return exactly 5 natural, commonly used English sentences for this situation. Every item kind must be phrase. Put the full English sentence in the first field and its natural Chinese translation in the second field."
  : "Return 8-10 useful English words or phrases strongly related to this branch. Every word must have one natural English example sentence in the fifth field. A phrase may also use the fifth field for a short example or usage context.";
 const user=`Topic or situation: ${root}\nBranch to expand: ${parent.label} (${parent.zh})\nLearner: CEFR ${targetLevels}.\n${request}\nAvoid: ${exclude.slice(0,100).join(", ")}.\nUse this simple format only: [["English word, phrase, or sentence","简短中文释义或翻译","B1|B2|C1|C2","word|phrase","natural English example sentence"]].`;
 const parsed=simpleParse(await collect(provider,system,user));
 if(sentences){
  const used=new Set(exclude.map(item=>item.trim().toLowerCase()));
  const result:NewKnowledgeNode[]=[];
  const append=(items:NewKnowledgeNode[])=>items.forEach(item=>{
   const key=item.label.trim().toLowerCase();
   if(key&&!used.has(key)&&item.zh.trim()&&result.length<5){used.add(key);result.push({...item,kind:"phrase"})}
  });
  append(parsed);
  if(result.length<5){
   try{append(simpleParse(await collect(provider,system,`${user}\nYou returned too few valid bilingual sentences. Return ${5-result.length} different additional sentences now.`)))}catch{}
  }
  append(SENTENCE_FALLBACKS);
  return result.slice(0,5);
 }
 return parsed.filter(item=>item.kind!=="word"||item.note.trim());
}

export async function expandNode(provider:AIProvider,root:string,node:KnowledgeNode,targetLevels:string,exclude:string[]):Promise<NewKnowledgeNode[]>{return generateBranch(provider,root,{label:node.label,zh:node.zh,kind:node.kind},targetLevels,exclude)}
