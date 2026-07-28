import { useMemo } from "react";
import { Markdown, renderInline } from "@/components/AiChat/Markdown";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { EnrichOutline, parseEnrichOutline } from "@/lib/enrichSections";

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

/** An example sentence and its translation, as one card.
 *
 * Examples are the densest thing on a word page (the prompt asks for 4-6 of
 * them), so they get a surface of their own rather than a quote bar: the pair
 * reads as one unit while scrolling, the English carries the visual weight the
 * learner is here for, and the translation recedes to a gloss.
 *
 * The speak button sits in a fixed gutter rather than trailing the sentence.
 * Trailing it reads better when it fits, but an example that happens to fill its
 * last line pushes the button onto a line of its own — an orphaned icon under
 * the text. A gutter puts it in the same place on every card instead. */
function ExampleBlockquote({ lines, quoteKey }: { lines: string[]; quoteKey: string }) {
  const englishText = lines.filter(isEnglishLine).join(" ").trim();

  return (
    <figure className="group my-3.5 flex gap-2.5 rounded-lg border border-border/60 bg-card/60 px-4 py-3 transition-colors hover:border-primary/30">
      {englishText && (
        <SpeakButton
          text={englishText}
          className="mt-[0.35em] h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
        />
      )}
      <div className="min-w-0 flex-1">
        {lines.map((line, j) => (
          <p
            key={`${quoteKey}-${j}`}
            className={
              isEnglishLine(line)
                ? "text-[0.97em] font-medium leading-[1.7] text-foreground [&+p]:mt-1"
                : "text-[0.85em] leading-relaxed text-muted-foreground [&+p]:mt-1"
            }
          >
            {/* Example lines can carry their own bold/code emphasis (e.g. the word
             * being illustrated) — render inline markdown here too, instead of the
             * literal asterisks a plain span would show. */}
            {renderInline(line, `${quoteKey}-${j}`)}
          </p>
        ))}
      </div>
    </figure>
  );
}

const renderExample = (lines: string[], key: string) => <ExampleBlockquote lines={lines} quoteKey={key} />;

/** Renders a word's freeform AI-generated markdown explanation. Example
 * sentences are written as blockquotes by prompt convention (see
 * providers/base.ts buildEnrichSystemPrompt) so they get a speak button;
 * everything else renders as plain markdown.
 *
 * When the explanation has headings it is rendered section by section (see
 * lib/enrichSections) so each topic is visually separable and addressable by id
 * — the word page's jump nav scrolls to those ids. Short explanations with no
 * headings (the quick lookup in WordSearchBox) fall through to a single flow. */
export function EnrichmentText({ text, outline }: { text: string; outline?: EnrichOutline }) {
  const parsed = useMemo(() => outline ?? parseEnrichOutline(text), [outline, text]);
  if (!text.trim()) return null;

  if (parsed.sections.length === 0) {
    return <Markdown text={text} renderBlockquote={renderExample} />;
  }

  return (
    <div>
      {parsed.lead && (
        <div className="text-[1.03em] leading-[1.8] text-foreground/90">
          <Markdown text={parsed.lead} renderBlockquote={renderExample} />
        </div>
      )}
      {parsed.sections.map((section) => (
        <section key={section.id} id={section.id} data-section-id={section.id} className="mt-7 first:mt-0">
          <h2 className="mb-2.5 flex items-center gap-2.5">
            <span className="h-[1.05em] w-[3px] shrink-0 rounded-full bg-primary/70" />
            <span className="text-[1.05em] font-bold leading-snug tracking-tight">
              {renderInline(section.title, `${section.id}-title`)}
            </span>
          </h2>
          {section.body && <Markdown text={section.body} renderBlockquote={renderExample} />}
        </section>
      ))}
    </div>
  );
}
