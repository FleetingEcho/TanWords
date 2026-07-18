import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { logError, reportWriteError } from "./useDB.errors";
import type { KnowledgeMapDetail, KnowledgeMapSummary, MapWordAddResult, NewKnowledgeNode, SavePatternResult } from "@/features/knowledge-map/types";

export function useDBKnowledgeMap(){
 const listKnowledgeMaps=useCallback(async():Promise<KnowledgeMapSummary[]>=>{try{return await invoke("db_list_knowledge_maps")}catch(e){logError("listKnowledgeMaps",e);return[]}},[]);
 const createKnowledgeMap=useCallback(async(rootLabel:string,rootType:string,targetLevels:string):Promise<number>=>{try{return await invoke("db_create_knowledge_map",{rootLabel,rootType,targetLevels})}catch(e){reportWriteError("createKnowledgeMap",e,"创建知识地图失败");return 0}},[]);
 const deleteKnowledgeMap=useCallback(async(mapId:number):Promise<boolean>=>{try{await invoke("db_delete_knowledge_map",{mapId});return true}catch(e){reportWriteError("deleteKnowledgeMap",e,"删除知识地图失败");return false}},[]);
 const getKnowledgeMap=useCallback(async(mapId:number):Promise<KnowledgeMapDetail|null>=>{try{return await invoke("db_get_knowledge_map",{mapId})}catch(e){logError("getKnowledgeMap",e);return null}},[]);
 const addKnowledgeNodes=useCallback(async(mapId:number,parentId:number,nodes:NewKnowledgeNode[]):Promise<number[]>=>{try{return await invoke("db_add_knowledge_nodes",{mapId,parentId,nodes})}catch(e){reportWriteError("addKnowledgeNodes",e,"保存地图分支失败");return[]}},[]);
 const updateKnowledgeNodeNote=useCallback(async(nodeId:number,note:string):Promise<boolean>=>{try{await invoke("db_update_knowledge_node_note",{nodeId,note});return true}catch(e){reportWriteError("updateKnowledgeNodeNote",e,"保存例句失败");return false}},[]);
 const addMapWordsToVocabulary=useCallback(async(nodeIds:number[]):Promise<MapWordAddResult>=>{try{return await invoke("db_add_map_words_to_vocabulary",{nodeIds})}catch(e){reportWriteError("addMapWordsToVocabulary",e,"添加词汇失败");return{added:0,linked:0,skipped:nodeIds.length}}},[]);
 const saveSentencePattern=useCallback(async(sentence:string,zh:string,skeleton:string,note:string,level:string,source:string):Promise<SavePatternResult|null>=>{try{return await invoke("db_save_sentence_pattern",{sentence,zh,skeleton,note,level,source})}catch(e){reportWriteError("saveSentencePattern",e,"收藏句式失败");return null}},[]);
 return useMemo(()=>({listKnowledgeMaps,createKnowledgeMap,deleteKnowledgeMap,getKnowledgeMap,addKnowledgeNodes,updateKnowledgeNodeNote,addMapWordsToVocabulary,saveSentencePattern}),[listKnowledgeMaps,createKnowledgeMap,deleteKnowledgeMap,getKnowledgeMap,addKnowledgeNodes,updateKnowledgeNodeNote,addMapWordsToVocabulary,saveSentencePattern]);
}
