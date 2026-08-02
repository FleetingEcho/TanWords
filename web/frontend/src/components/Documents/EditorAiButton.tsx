import { Sparkles } from "lucide-react";
import { useBlockNoteEditor, useEditorState } from "@blocknote/react";
import { useT } from "@/hooks/useT";
import { useNavStore } from "@/store/navStore";
import { usePendingChatSelectionStore } from "@/store/pendingChatSelectionStore";

/** Formatting-toolbar button: send the selected text to AI Chat. If Chat is
 *  already open it prefills immediately; otherwise it opens Chat and prefills
 *  on mount. */
export function EditorAiButton() {
  const t = useT();
  const editor = useBlockNoteEditor();
  const selectedText = useEditorState({
    editor,
    selector: ({ editor: currentEditor }: any) => currentEditor.getSelectedText(),
  });

  if (!selectedText?.trim()) return null;

  const openInChat = () => {
    const text = selectedText.trim();
    usePendingChatSelectionStore.getState().setText(text);
    if (useNavStore.getState().currentPage() === "chat") {
      window.dispatchEvent(new CustomEvent("tanwords:ask-selection", { detail: { text } }));
    } else {
      useNavStore.getState().navigate("chat");
    }
  };

  return (
    <button
      type="button"
      onClick={openInChat}
      title={t("doc.askAiSelection")}
      className="bn-button mx-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md"
    >
      <Sparkles className="h-4 w-4" />
    </button>
  );
}
