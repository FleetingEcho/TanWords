import React from "react";
import { Button } from "@/components/ui/button";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { KITCHEN_MANIFEST } from "@/features/scene-lab/kitchenManifest";
import type { SceneVocabularyItem } from "@/features/scene-lab/types";

export function ObjectLessonPanel({ objectKey, words, onAdd }: { objectKey: string | null; words: SceneVocabularyItem[]; onAdd: (id: number) => void }) {
  const object = KITCHEN_MANIFEST.objects.find((item) => item.key === objectKey);
  if (!object) return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">点击厨房中的物体开始探索</div>;
  const related = words.filter((item) => item.object_key === objectKey);
  return (
    <div className="h-full overflow-y-auto p-5">
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{object.category}</p>
      <h2 className="mt-1 font-serif text-2xl font-bold">{object.labelEn}</h2>
      <p className="text-sm text-muted-foreground">{object.labelZh}</p>
      {related.length === 0 ? <p className="mt-6 text-sm text-muted-foreground">这个物体暂时没有课程内容。</p> : (
        <div className="mt-5 space-y-4">
          {related.map((item) => <article key={item.id ?? item.word} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <strong className="text-lg">{item.word}</strong><span className="text-xs text-muted-foreground">{item.ipa}</span>
              <SpeakButton text={item.word} className="h-4 w-4" />
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold">{item.level}</span>
            </div>
            <p className="mt-1 text-sm">{item.zh}</p>
            <div className="mt-3 space-y-2">
              {item.examples.map((example, index) => <div key={index} className="rounded-lg bg-muted/50 p-2 text-xs"><p>{example.content_en}</p><p className="mt-0.5 text-muted-foreground">{example.content_zh}</p></div>)}
            </div>
            {item.id && <Button disabled={Boolean(item.word_id)} onClick={() => onAdd(item.id!)} className="mt-3 h-8 w-full text-xs">{item.word_id ? "已在词库" : "加入 Vocabulary"}</Button>}
          </article>)}
        </div>
      )}
    </div>
  );
}
