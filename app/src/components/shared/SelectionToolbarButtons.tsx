import { useState } from "react";
import { BookmarkPlus, BookPlus, Check, Copy, Languages, MessageSquareQuote, Search } from "lucide-react";
import { useT } from "@/hooks/useT";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { hostCapabilities } from "@/platform";
import { Button } from "@/components/ui/button";
import { Anchor, AskMode, MAX_PATTERN, canAddAsWord, isWordish, wordCount } from "./selectionAskHelpers";
import { copyText } from "./touchSelection";

/** The button row inside the floating selection toolbar — split out of
 * SelectionAsk purely for size. Same grammar for a word and a sentence, so
 * the buttons don't move around under the cursor between selections:
 *   [ keep it ] [ translate ] [ go deeper ] | [ copy ] [ hear it ]
 * "keep it" can offer both actions at once: a multi-word selection (a
 * quote, a clause with a comma) reads like a sentence but may still be
 * exactly the idiom/collocation someone wants filed under Words instead —
 * so both buttons show whenever the text qualifies for either, rather than
 * the toolbar guessing a single intent from word count and punctuation. */
export function SelectionToolbarButtons({
  anchor, collected, adding, saving, addWord, savePattern, dismiss, setAsking,
}: {
  anchor: Anchor;
  collected: boolean;
  adding: boolean;
  saving: boolean;
  addWord: () => void;
  savePattern: (sentence: string) => void;
  dismiss: () => void;
  setAsking: (v: { anchor: Anchor; mode: AskMode } | null) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const canWord = canAddAsWord(anchor.text);
  // A lone word already gets its own "add word" slot — only offer "save
  // sentence" alongside it once there's more than one word to it.
  const canSentence = wordCount(anchor.text) > 1 && anchor.text.length <= MAX_PATTERN;
  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-2xl ring-1 ring-black/5">
      {/* 1 — keep it */}
      {canWord && (
        collected ? (
          <span className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            {t("sel.inVocab")}
          </span>
        ) : (
          <Button
            variant="ghost"
            onClick={addWord}
            disabled={adding}
            className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
          >
            <BookPlus className="h-3 w-3" />
            {adding ? t("sel.adding") : t("sel.addWord")}
          </Button>
        )
      )}
      {canSentence && (
        <Button
          variant="ghost"
          onClick={() => savePattern(anchor.text)}
          disabled={saving}
          className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-primary"
        >
          <BookmarkPlus className="h-3 w-3" />
          {saving ? t("sel.saving") : t("sel.savePattern")}
        </Button>
      )}

      {/* 2 — translate. A sentence gets a plain rendering; a word gets
        * its meaning *here*, since a bare gloss out of context is a
        * coin flip ("address" = 地址 or 着手处理?). */}
      <Button
        variant="ghost"
        onClick={() => {
          setAsking({ anchor, mode: isWordish(anchor.text) ? "explain" : "translate" });
          dismiss();
        }}
        className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
      >
        <Languages className="h-3 w-3" />
        {t("sel.translate")}
      </Button>

      {/* 3 — go deeper: the full word card, or a follow-up question. */}
      {isWordish(anchor.text) ? (
        <Button
          variant="ghost"
          onClick={() => { setAsking({ anchor, mode: "deep" }); dismiss(); }}
          className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
        >
          <Search className="h-3 w-3" />
          {t("sel.lookup")}
        </Button>
      ) : (
        <Button
          variant="ghost"
          onClick={() => {
            if (anchor.inChat) {
              window.dispatchEvent(new CustomEvent("tanwords:ask-selection", { detail: { text: anchor.text } }));
            } else {
              setAsking({ anchor, mode: "explain" });
            }
            dismiss();
          }}
          className="h-7 gap-1.5 rounded-lg px-2 text-[11px] font-medium"
        >
          <MessageSquareQuote className="h-3 w-3" />
          {t("sel.ask")}
        </Button>
      )}

      {/* 4 — copy and hear it. Icon-only: this group is plumbing, and the
        * labelled actions above are what the toolbar is for. */}
      <span className="mx-0.5 h-4 w-px bg-border/70" />
      <Button
        variant="ghost"
        aria-label={t("sel.copy")}
        title={t("sel.copy")}
        onClick={() => {
          void copyText(anchor.text).then((ok) => {
            if (!ok) return;
            setCopied(true);
            // Long enough to read the tick, short enough that the toolbar
            // isn't still sitting there when you look back at the sentence.
            window.setTimeout(dismiss, 600);
          });
        }}
        className="h-7 w-7 rounded-lg p-0"
      >
        {copied
          ? <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          : <Copy className="h-3.5 w-3.5" />}
      </Button>
      <span className="grid h-7 w-7 place-items-center">
        {hostCapabilities.nativeTts && <SpeakButton text={anchor.text} className="w-3.5 h-3.5" />}
      </span>
    </div>
  );
}
