export type KnowledgeNodeKind = "topic" | "category" | "word" | "phrase" | "situation" | "contrast";
export interface KnowledgeNode { id:number; map_id:number; parent_id:number|null; kind:KnowledgeNodeKind; label:string; zh:string; level:string; note:string; depth:number; sort_order:number; expanded:boolean; word_id:number|null }
export interface KnowledgeEdge { source_id:number; target_id:number; relation:string }
export interface KnowledgeMapDetail { id:number; root_label:string; root_type:string; target_levels:string; nodes:KnowledgeNode[]; edges:KnowledgeEdge[] }
export interface KnowledgeMapSummary { id:number; root_label:string; root_type:string; node_count:number; updated_at:string }
export interface NewKnowledgeNode { kind:KnowledgeNodeKind; label:string; zh:string; level:string; note:string }
export interface MapWordAddResult { added:number; linked:number; skipped:number }
