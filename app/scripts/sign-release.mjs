#!/usr/bin/env node
/**
 * Signs the built macOS zip and emits `update.json`, the feed the in-app
 * updater reads.
 *
 * Why this exists at all: electron-updater's macOS path hands the download to
 * native Squirrel.Mac, which refuses any update whose code signature doesn't
 * match the running app's — impossible without an Apple Developer ID, because
 * an ad-hoc signature's identity changes on every build. The Tauri version this
 * app replaced never hit that wall: it downloaded, checked its own signature,
 * and swapped the bundle itself. This restores that model, with ed25519 (via
 * Node's built-in crypto, no dependency) in place of Tauri's minisign.
 *
 * The private key is deliberately outside the repo. Losing it means shipped
 * clients can no longer verify any future update and will be stuck on whatever
 * version they have — exactly as with the old Tauri key.
 *
 *   node scripts/sign-release.mjs
 */
import { createHash, createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(APP_DIR, "..", "dist-releases");
const KEY_PATH = process.env["TANWORDS_UPDATER_KEY"] ?? path.join(homedir(), ".tanwords", "updater.key");
const REPO = "FleetingEcho/TanWords";

function die(message) {
  console.error(`sign-release: ${message}`);
  process.exit(1);
}

if (!existsSync(KEY_PATH)) {
  die(`no private key at ${KEY_PATH}. Generate one with:\n` +
    `  node -e 'const{generateKeyPairSync}=require("crypto"),fs=require("fs");` +
    `const{privateKey}=generateKeyPairSync("ed25519");` +
    `fs.writeFileSync(process.argv[1],privateKey.export({type:"pkcs8",format:"pem"}),{mode:0o600})' ${KEY_PATH}`);
}

const { version } = JSON.parse(readFileSync(path.join(APP_DIR, "package.json"), "utf8"));
const privateKey = createPrivateKey(readFileSync(KEY_PATH));

/** What electron-builder may have called this arch's zip.
 *
 *  x64 is listed twice on purpose. electron-builder omits the arch suffix for
 *  whichever arch it treats as the default, so the Intel zip has shipped as
 *  both `TanWords-<v>-x64-mac.zip` (1.1.1) and `TanWords-<v>-mac.zip` (1.5.0).
 *  This script only knew the first spelling, so v1.5.0's update.json went out
 *  with a `darwin-arm64` entry and nothing else — every Intel install has been
 *  silently unable to update since. Checking both names is the fix; the
 *  emptiness check below is what would have caught it.
 */
function candidates(arch) {
  return arch === "x64"
    ? [`TanWords-${version}-x64-mac.zip`, `TanWords-${version}-mac.zip`]
    : [`TanWords-${version}-${arch}-mac.zip`];
}

// One entry per arch actually built, so a partial build (arm64 only) produces a
// feed that simply has nothing to offer an Intel client rather than a broken
// URL it would fail to download.
const platforms = {};
for (const arch of ["arm64", "x64"]) {
  const name = candidates(arch).find((n) => existsSync(path.join(DIST, n)));
  if (!name) continue;
  const file = path.join(DIST, name);

  const bytes = readFileSync(file);
  platforms[`darwin-${arch}`] = {
    url: `https://github.com/${REPO}/releases/download/v${version}/${name}`,
    size: bytes.length,
    sha512: createHash("sha512").update(bytes).digest("base64"),
    // Ed25519 signs the message directly — no pre-hashing, hence `null` for
    // the algorithm. The signature covers the zip bytes, so a tampered or
    // truncated download fails before anything is unpacked.
    signature: edSign(null, bytes, privateKey).toString("base64"),
  };
  console.log(`signed ${name} (${(bytes.length / 1e6).toFixed(1)} MB)`);
}

if (Object.keys(platforms).length === 0) {
  const built = readdirSync(DIST).filter((f) => f.endsWith(".zip")).join(", ") || "(none)";
  die(`no TanWords-${version}-<arch>-mac.zip in ${DIST}. Found: ${built}`);
}

// Loud, not fatal: an arm64-only release is a legitimate thing to publish
// deliberately, but doing it by accident is how v1.5.0 stranded every Intel
// user. Naming it at the point of signing is the last moment anyone looks.
for (const arch of ["arm64", "x64"]) {
  if (!platforms[`darwin-${arch}`]) {
    console.warn(
      `WARNING: no ${arch} build found — clients on that architecture will be ` +
        `offered no update by this feed. Expected one of: ${candidates(arch).join(", ")}`,
    );
  }
}

const manifest = {
  version,
  pubDate: new Date().toISOString(),
  notes: process.env["TANWORDS_RELEASE_NOTES"] ?? "",
  platforms,
};

const out = path.join(DIST, "update.json");
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${out}`);
