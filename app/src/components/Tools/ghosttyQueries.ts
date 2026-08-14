import type { TerminalSurfaceTheme } from "./terminalSurface";

const encoder = new TextEncoder();

const PRIMARY_DA = "\x1b[?1;2c";
const SECONDARY_DA = "\x1b[>0;4000;0c";
const QUERY_CANDIDATES = [
  "\x1b[c",
  "\x1b[0c",
  "\x1b[>c",
  "\x1b[>0c",
  "\x1b]10;?\x07",
  "\x1b]10;?\x1b\\",
  "\x1b]11;?\x07",
  "\x1b]11;?\x1b\\",
] as const;

function bytesToBinaryString(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return result;
}

function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index);
  return bytes;
}

function rgbComponents(value: string | undefined): [number, number, number] {
  if (!value) return [0, 0, 0];
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex?.length === 3) {
    return [...hex].map((component) => Number.parseInt(component + component, 16)) as [number, number, number];
  }
  if (hex?.length === 6) {
    return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
  }
  const rgb = value.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  if (!rgb) return [0, 0, 0];
  return [rgb[1], rgb[2], rgb[3]].map((component) => (
    Math.max(0, Math.min(255, Number.parseInt(component, 10)))
  )) as [number, number, number];
}

function oscColorResponse(code: "10" | "11", color: string | undefined): string {
  const components = rgbComponents(color).map((component) => (
    (component * 257).toString(16).padStart(4, "0")
  ));
  return `\x1b]${code};rgb:${components.join("/")}\x1b\\`;
}

export interface GhosttyQueryResult {
  data: Uint8Array;
  responses: string[];
}

/**
 * ghostty-web 0.4 cannot answer OSC 10/11 because its WASM terminal is created
 * without the allocator those queries require. It also drains only one queued
 * libghostty response per write. Intercept the small startup-query subset used
 * by modern shells so fish does not wait ten seconds for terminal detection.
 */
export class GhosttyQueryInterceptor {
  private pending = "";

  process(data: Uint8Array, theme: TerminalSurfaceTheme): GhosttyQueryResult {
    let source = this.pending + bytesToBinaryString(data);
    this.pending = "";

    // Search every escape in the tail: an OSC ST terminator contains a second
    // ESC, so looking only at the last one would accidentally pass the earlier
    // half of a split query into libghostty.
    for (let index = source.indexOf("\x1b"); index >= 0; index = source.indexOf("\x1b", index + 1)) {
      const suffix = source.slice(index);
      const isPartial = QUERY_CANDIDATES.some((candidate) => (
        candidate !== suffix && candidate.startsWith(suffix)
      ));
      if (!isPartial) continue;
      this.pending = suffix;
      source = source.slice(0, index);
      break;
    }

    const responses: string[] = [];
    const filtered = source.replace(
      /\x1b\[(0)?c|\x1b\[>(0)?c|\x1b\](10|11);\?(?:\x07|\x1b\\)/g,
      (query, _primaryZero: string | undefined, _secondaryZero: string | undefined, colorCode: "10" | "11" | undefined) => {
        if (query.startsWith("\x1b[>")) responses.push(SECONDARY_DA);
        else if (query.startsWith("\x1b[")) responses.push(PRIMARY_DA);
        else if (colorCode) {
          responses.push(oscColorResponse(
            colorCode,
            colorCode === "10" ? theme.foreground : theme.background,
          ));
        }
        return "";
      },
    );

    return { data: binaryStringToBytes(filtered), responses };
  }
}
