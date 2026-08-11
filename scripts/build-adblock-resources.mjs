#!/usr/bin/env node
/**
 * Builds the uBlock Origin resource bundle (scriptlets + redirects) that the
 * shared Rust adblock engine loads via `engine.use_resources(...)`.
 *
 * Why this exists: the adblock-rust `resource-assembler` feature can still
 * parse uBO's *web-accessible* redirect resources, but its scriptlet
 * assembler is `#[deprecated]` and only understands the pre-2023 line-based
 * uBO format. uBO's current `scriptlets.js` is an ES module that the crate
 * explicitly recommends transforming "into `Resource`s using JS code" — which
 * is what this script does.
 *
 * Source of truth: Ghostery's pre-generated uBO resources JSON (they already
 * compile uBO's ES module into plain JS bodies, so no import machinery is
 * needed here):
 *   https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json
 *
 * Output: the adblock-rust `Vec<Resource>` serialization, embedded into the
 * core crate via `include_str!` at compile time — the binary ships it, so
 * runtime has zero network dependency for scriptlets.
 *
 * Usage:
 *   node scripts/build-adblock-resources.mjs [--force]
 *
 * The upstream JSON is cached in the repo (`app/core/src/resources/ublock-origin-resources.json`)
 * so builds stay reproducible; `--force` re-downloads it.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC_DIR = join(ROOT, "app", "core", "src", "resources");
const RAW_JSON = join(SRC_DIR, "ublock-origin-resources.json");
const OUT_JSON = join(SRC_DIR, "ublock-resources.json");

const SOURCE_URL =
  "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json";

const FORCE = process.argv.includes("--force");

function fetchRaw() {
  if (!FORCE && existsSync(RAW_JSON)) {
    console.log(`[adblock-resources] using cached ${RAW_JSON}`);
    return readFileSync(RAW_JSON, "utf-8");
  }
  console.log(`[adblock-resources] downloading ${SOURCE_URL}`);
  return fetch(SOURCE_URL).then((r) => {
    if (!r.ok) throw new Error(`download failed: HTTP ${r.status}`);
    return r.text();
  });
}

/** adblock-rust `Resource.kind` is `{"mime": "<mime>"}` for newtype variants. */
const mimeKind = (mime) => ({ mime });

/**
 * Convert Ghostery's bundle to adblock-rust `Resource` objects.
 *
 * - scriptlets: `{name, aliases, body, dependencies}` — body is plain JS
 *   text; content must be base64. `.js` = application/javascript (injectable
 *   scriptlet), `.fn` = fn/javascript (dependency function).
 * - redirects: `{name, aliases, body, contentType}` — for binary types
 *   (`;base64` in the contentType) the body is already base64 of the payload;
 *   for text types the body is raw text and must be base64-encoded.
 */
function convert(raw) {
  const src = JSON.parse(raw);
  const out = [];
  for (const s of src.scriptlets ?? []) {
    const isFn = s.name.endsWith(".fn");
    out.push({
      name: s.name,
      aliases: s.aliases ?? [],
      kind: mimeKind(isFn ? "fn/javascript" : "application/javascript"),
      content: Buffer.from(s.body, "utf-8").toString("base64"),
      ...((s.dependencies?.length && { dependencies: s.dependencies }) || {}),
    });
  }
  for (const r of src.redirects ?? []) {
    const binary = r.contentType.includes(";base64");
    const mime = r.contentType.split(";")[0];
    out.push({
      name: r.name,
      aliases: r.aliases ?? [],
      kind: mimeKind(mime),
      // Binary bodies arrive pre-encoded; text bodies must be encoded here.
      content: binary ? r.body : Buffer.from(r.body, "utf-8").toString("base64"),
    });
  }
  return out;
}

async function main() {
  mkdirSync(SRC_DIR, { recursive: true });
  const raw = await fetchRaw();
  if (FORCE || !existsSync(RAW_JSON)) writeFileSync(RAW_JSON, raw, "utf-8");

  const resources = convert(raw);
  const json = JSON.stringify(resources, null, 0) + "\n";
  writeFileSync(OUT_JSON, json, "utf-8");

  const hash = createHash("sha256").update(json).digest("hex").slice(0, 12);
  const scriptlets = (JSON.parse(raw).scriptlets ?? []).length;
  const redirects = (JSON.parse(raw).redirects ?? []).length;
  console.log(
    `[adblock-resources] wrote ${OUT_JSON}: ${resources.length} resources ` +
      `(${scriptlets} scriptlets + ${redirects} redirects), ` +
      `${(json.length / 1024).toFixed(0)} KiB, sha256:${hash}`,
  );
}

main().catch((e) => {
  console.error(`[adblock-resources] failed: ${e.message}`);
  process.exit(1);
});
