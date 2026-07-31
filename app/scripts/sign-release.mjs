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

// One entry per arch actually built, so a partial build (arm64 only) produces a
// feed that simply has nothing to offer an Intel client rather than a broken
// URL it would fail to download.
const platforms = {};
for (const arch of ["arm64", "x64"]) {
  const name = `TanWords-${version}-${arch}-mac.zip`;
  const file = path.join(DIST, name);
  if (!existsSync(file)) continue;

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

const manifest = {
  version,
  pubDate: new Date().toISOString(),
  notes: process.env["TANWORDS_RELEASE_NOTES"] ?? "",
  platforms,
};

const out = path.join(DIST, "update.json");
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${out}`);
