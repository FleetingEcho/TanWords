import { Markdown, renderInline } from "@/components/AiChat/Markdown";
import { SpeakButton } from "@/components/ui/SpeakButton";

/** Highlights **bold** emphasis (the model's own "this is the key point" markup)
 * in a warm color instead of leaving it plain bold black/white — makes the actual
 * point of a note easier to spot at a glance. */
const BOLD_CLASS = "text-amber-600 dark:text-amber-400";

/** A blockquote line counts as an example sentence to speak if it looks
 * predominantly English (more Latin letters than CJK characters). This lets
 * a translation line in the same blockquote be skipped without needing the
 * model to tag anything explicitly. */
function isEnglishLine(line: string): boolean {
  if (!line.trim()) return false;
  const cjk = (line.match(/[一-鿿]/g) || []).length;
  const letters = (line.match(/[A-Za-z]/g) || []).length;
  return letters > cjk && letters >= 3;
}

function ExampleBlockquote({ lines, quoteKey }: { lines: string[]; quoteKey: string }) {
  const englishText = lines.filter(isEnglishLine).join(" ").trim();
  return (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-foreground/90">
      {lines.map((line, j) => (
        <p key={`${quoteKey}-${j}`} className="flex items-start gap-1.5">
          {/* Example lines can carry their own bold/code emphasis (e.g. the word
           * being illustrated) — render inline markdown here too, instead of the
           * literal asterisks a plain span would show. */}
          <span>{renderInline(line, `${quoteKey}-${j}`, BOLD_CLASS)}</span>
          {j === 0 && englishText && <SpeakButton text={englishText} className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
        </p>
      ))}
    </blockquote>
  );
}

/** Renders a word's freeform AI-generated markdown explanation. Example
 * sentences are written as blockquotes by prompt convention (see
 * providers/base.ts buildEnrichSystemPrompt) so they get a speak button;
 * everything else renders as plain markdown. */
export function EnrichmentText({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <Markdown
      text={text}
      boldClassName={BOLD_CLASS}
      renderBlockquote={(lines, key) => <ExampleBlockquote lines={lines} quoteKey={key} />}
    />
  );
}
