import { useT } from "@/hooks/useT";
import { SelectedWordState } from "@/store/selectedWordStore";
import { WordChatPanel } from "@/components/WordChatPanel";

interface ToolsModalWordTabProps {
  active: boolean;
  selectedWord: SelectedWordState;
}

/** Word chat tab body (Vocabulary page only): notes/chat for the currently selected word. */
export function ToolsModalWordTab({ active, selectedWord }: ToolsModalWordTabProps) {
  const t = useT();

  return (
    <div style={{ display: active ? "flex" : "none", height: "100%" }} className="flex-col overflow-hidden p-3">
      {selectedWord.word ? (
        <WordChatPanel
          key={selectedWord.wordId ?? selectedWord.word}
          wordId={selectedWord.wordId}
          word={selectedWord.word}
          enrichedContext={selectedWord.enrichedContext}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-4">
          <p className="text-xs text-muted-foreground">{t("tools.wordNoSelection")}</p>
        </div>
      )}
    </div>
  );
}
