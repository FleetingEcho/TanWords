import React from "react";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import type { KnowledgeNode } from "@/features/knowledge-map/types";

export function KnowledgeNodePanel({node,expanding,checked,onExpand,onToggle}:{node:KnowledgeNode|null;expanding:boolean;checked:boolean;onExpand:()=>void;onToggle:()=>void}){
 if(!node)return <aside className="flex h-full items-center justify-center border-l p-6 text-center text-sm text-muted-foreground">选择一个节点查看详情，或从任意节点继续展开。</aside>;
 const learnable=node.kind==="word"||node.kind==="phrase";
 return <aside className="h-full overflow-y-auto border-l bg-card p-5"><span className="text-[10px] font-bold uppercase tracking-widest text-primary">{node.kind}</span><div className="mt-2 flex items-center gap-2"><h2 className="font-serif text-2xl font-bold">{node.label}</h2>{learnable&&<SpeakButton text={node.label} className="h-4 w-4"/>}</div><p className="mt-1 text-muted-foreground">{node.zh||"暂无中文释义"}</p>{node.level&&<span className="mt-3 inline-block rounded-full bg-muted px-2 py-1 text-xs font-bold">CEFR {node.level}</span>}{node.note&&<p className="mt-4 rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">{node.note}</p>}<div className="mt-6 space-y-2"><Button onClick={onExpand} disabled={expanding} className="w-full">{expanding?"正在生成这个分支…":node.expanded?"继续扩展这个节点":"从这里展开"}</Button>{learnable&&<Button variant="outline" onClick={onToggle} disabled={Boolean(node.word_id)} className="w-full">{node.word_id?"已在 Vocabulary":checked?"取消选择":"选择加入学习"}</Button>}</div><div className="mt-6 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">每次扩展只要求模型生成 8–10 个简单条目，适合本地小模型。已生成内容会永久缓存。</div></aside>
}
