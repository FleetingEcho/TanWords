import { Markdown } from "@/components/AiChat/Markdown";
import { SpeakButton } from "@/components/ui/SpeakButton";

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
          <span>{line}</span>
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
      renderBlockquote={(lines, key) => <ExampleBlockquote lines={lines} quoteKey={key} />}
    />
  );
}
