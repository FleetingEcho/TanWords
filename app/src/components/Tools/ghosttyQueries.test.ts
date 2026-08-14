import { describe, expect, it } from "vitest";
import { GhosttyQueryInterceptor } from "./ghosttyQueries";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const theme = { foreground: "#abcdef", background: "#123456" };

describe("GhosttyQueryInterceptor", () => {
  it("answers device and color queries without passing unsupported OSC to libghostty", () => {
    const interceptor = new GhosttyQueryInterceptor();
    const result = interceptor.process(
      encoder.encode("before\x1b[c\x1b[>0c\x1b]10;?\x07\x1b]11;?\x1b\\after"),
      theme,
    );

    expect(decoder.decode(result.data)).toBe("beforeafter");
    expect(result.responses).toEqual([
      "\x1b[?1;2c",
      "\x1b[>0;4000;0c",
      "\x1b]10;rgb:abab/cdcd/efef\x1b\\",
      "\x1b]11;rgb:1212/3434/5656\x1b\\",
    ]);
  });

  it("recognizes a query split across PTY output chunks", () => {
    const interceptor = new GhosttyQueryInterceptor();
    const first = interceptor.process(encoder.encode("text\x1b]11;?\x1b"), theme);
    const second = interceptor.process(encoder.encode("\\more"), theme);

    expect(decoder.decode(first.data)).toBe("text");
    expect(first.responses).toEqual([]);
    expect(decoder.decode(second.data)).toBe("more");
    expect(second.responses).toEqual(["\x1b]11;rgb:1212/3434/5656\x1b\\"]);
  });

  it("preserves unrelated terminal bytes exactly", () => {
    const interceptor = new GhosttyQueryInterceptor();
    const input = new Uint8Array([0, 27, 91, 51, 49, 109, 0x80, 0xff]);

    expect(interceptor.process(input, theme).data).toEqual(input);
  });
});
