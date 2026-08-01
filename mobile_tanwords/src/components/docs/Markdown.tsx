/**
 * Minimal markdown renderer for the doc preview toggle — no dependencies.
 * Supports: # ## ### headings, **bold**, *italic*, `inline code`,
 * - / * / 1. lists, > quotes, --- hr, paragraphs. Anything else renders as a
 * plain paragraph. Deliberately small: v1 preview ≠ desktop BlockNote.
 */
import React from "react";
import { Text, View } from "react-native";

type InlineNode = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

/** Split one line into styled runs: code → bold → italic, in that precedence. */
export function parseInline(line: string): InlineNode[] {
  // Single regex pass keeps indexes stable; last-wins on overlapping marks.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;
  const nodes: InlineNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) nodes.push({ text: line.slice(last, m.index) });
    if (m[1]) nodes.push({ text: m[1].slice(1, -1), code: true });
    else if (m[2]) nodes.push({ text: m[2].slice(2, -2), bold: true });
    else if (m[3]) nodes.push({ text: m[3].slice(1, -1), italic: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) nodes.push({ text: line.slice(last) });
  return nodes;
}

function InlineText({ line, baseClass }: { line: string; baseClass: string }) {
  return (
    <Text className={baseClass}>
      {parseInline(line).map((n, i) =>
        n.bold || n.italic || n.code ? (
          <Text
            key={i}
            className={[
              n.bold ? "font-bold" : "",
              n.italic ? "italic" : "",
              n.code ? "font-mono text-[13px] bg-muted rounded px-0.5" : "",
            ].join(" ")}
          >
            {n.text}
          </Text>
        ) : (
          <Text key={i}>{n.text}</Text>
        )
      )}
    </Text>
  );
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let quote: string[] = [];

  const flushQuote = (key: string) => {
    if (quote.length === 0) return;
    blocks.push(
      <View key={key} className="my-2 border-l-2 border-border pl-3">
        {quote.map((q, i) => (
          <Text key={i} className="text-[15px] leading-6 text-muted-foreground italic">
            {q}
          </Text>
        ))}
      </View>
    );
    quote = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw;
    if (!line.startsWith("> ")) flushQuote(`q-${idx}`);

    if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length;
      const size = level === 1 ? "text-[22px]" : level === 2 ? "text-[19px]" : "text-[17px]";
      blocks.push(
        <InlineText key={idx} line={line.replace(/^#+\s+/, "")} baseClass={`${size} font-bold text-foreground mt-4 mb-1`} />
      );
    } else if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const numeric = line.match(/^\s*(\d+)\.\s+(.*)$/);
      const bullet = numeric ? `${numeric[1]}. ` : "• ";
      const body = numeric ? numeric[2] : line.replace(/^\s*[-*]\s+/, "");
      blocks.push(
        <View key={idx} className="flex-row pl-1">
          <Text className="text-[15px] leading-6 text-muted-foreground">{bullet}</Text>
          <View className="flex-1">
            <InlineText line={body} baseClass="text-[15px] leading-6 text-foreground" />
          </View>
        </View>
      );
    } else if (line.startsWith("> ")) {
      quote.push(line.slice(2));
    } else if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<View key={idx} className="my-3 h-px bg-border" />);
    } else if (line.trim() === "") {
      blocks.push(<View key={idx} className="h-3" />);
    } else {
      blocks.push(
        <InlineText key={idx} line={line} baseClass="text-[15px] leading-6 text-foreground" />
      );
    }
  });
  flushQuote("q-end");

  if (blocks.length === 0) {
    return null;
  }
  return <View>{blocks}</View>;
}
