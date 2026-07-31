/** Self-updater for macOS, replacing electron-updater's path there.
 *
 *  electron-updater hands the download to native Squirrel.Mac, which validates
 *  the new bundle's code signature against the running app's and refuses
 *  anything that doesn't match. Without an Apple Developer ID the app is only
 *  ad-hoc signed, and an ad-hoc identity is derived from the binary's own hash
 *  — it changes with every build, so the check can never pass. That is a wall,
 *  not a misconfiguration.
 *
 *  The Tauri version this app replaced never hit it, because it never used
 *  Squirrel: it downloaded the archive, verified a signature it made itself,
 *  swapped the bundle and relaunched. This is that model, with ed25519 (Node's
 *  built-in crypto) where Tauri used minisign.
 *
 *  Order of operations matters: the signature is checked over the downloaded
 *  bytes *before* anything is unpacked, and the running bundle is only touched
 *  by the detached swap script after the app has exited. */
import { app } from "electron";
import { spawn } from "node:child_process";
import { verify as edVerify, createPublicKey } from "node:crypto";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { UpdateInfoPayload } from "./updater";

/** Public half of the key in `~/.tanwords/updater.key`, which
 *  `scripts/sign-release.mjs` signs releases with. Embedded rather than
 *  fetched: a key the updater downloads is a key an attacker can substitute. */
const PUBLIC_KEY_SPKI_B64 = "MCowBQYDK2VwAyEAKi04gRThKsletKe5L2qDn+q/gpB0bGVsqpReG7AE5rc=";

const FEED_URL = "https://github.com/FleetingEcho/TanWords/releases/latest/download/update.json";

interface PlatformEntry {
  url: string;
  size: number;
  sha512: string;
  signature: string;
}

interface Manifest {
  version: string;
  pubDate?: string;
  notes?: string;
  platforms: Record<string, PlatformEntry>;
}

/** Numeric-segment comparison, so 1.10.0 sorts above 1.9.0 (a string compare
 *  would put it below). Anything non-numeric is ignored rather than guessed at. */
function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.split(/[.\-+]/).map((p) => Number.parseInt(p, 10)).filter(Number.isFinite);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function entryForThisMac(manifest: Manifest): PlatformEntry | null {
  return manifest.platforms[`darwin-${process.arch}`] ?? null;
}

/** The `.app` the running process lives in. `app.getAppPath()` points inside
 *  the bundle (Resources/app.asar), so walk up to the bundle root instead. */
function bundlePath(): string {
  // …/TanWords.app/Contents/MacOS/TanWords
  return path.resolve(path.dirname(app.getPath("exe")), "..", "..");
}

export function createMacUpdater(emitEvent: (name: string, payload: unknown) => void) {
  let pending: { entry: PlatformEntry; version: string } | null = null;

  async function fetchManifest(): Promise<Manifest | null> {
    const response = await fetch(FEED_URL, { redirect: "follow" });
    if (!response.ok) return null;
    return (await response.json()) as Manifest;
  }

  return {
    async check(): Promise<UpdateInfoPayload | null> {
      try {
        const manifest = await fetchManifest();
        if (!manifest?.version || !isNewer(manifest.version, app.getVersion())) return null;

        const entry = entryForThisMac(manifest);
        // A release that shipped only one architecture is not an error — this
        // machine simply has nothing to install.
        if (!entry) return null;

        pending = { entry, version: manifest.version };
        return { version: manifest.version, date: manifest.pubDate, notes: manifest.notes || undefined };
      } catch (error) {
        // Offline, rate-limited, or no release yet: "up to date" is the honest
        // thing to show, not an error the user can do nothing about.
        console.warn("[updater] check failed, treating as no update available:", error);
        return null;
      }
    },

    async downloadAndInstall(): Promise<void> {
      if (!pending) throw new Error("no update has been checked for");
      const { entry, version } = pending;

      const target = bundlePath();
      // Fail before downloading 130MB the swap could never apply — an app
      // dragged to /Applications by an admin can be read-only for this user.
      try {
        await access(target, constants.W_OK);
        await access(path.dirname(target), constants.W_OK);
      } catch {
        throw new Error(`cannot write to ${target} — move the app somewhere writable, or reinstall manually`);
      }

      const response = await fetch(entry.url, { redirect: "follow" });
      if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);

      const total = entry.size;
      const chunks: Uint8Array[] = [];
      let transferred = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
        transferred += chunk.length;
        emitEvent("updater:progress", {
          percent: total > 0 ? Math.round((transferred / total) * 100) : 0,
          transferred,
          total,
        });
      }
      const bytes = Buffer.concat(chunks);

      // Everything below this line writes to disk, so verify first. Ed25519
      // signs the message directly, hence `null` for the algorithm.
      const publicKey = createPublicKey({
        key: Buffer.from(PUBLIC_KEY_SPKI_B64, "base64"),
        format: "der",
        type: "spki",
      });
      if (!edVerify(null, bytes, publicKey, Buffer.from(entry.signature, "base64"))) {
        throw new Error("update signature is not valid — refusing to install");
      }

      const staging = await mkdtemp(path.join(tmpdir(), "tanwords-update-"));
      try {
        const archive = path.join(staging, "update.zip");
        await writeFile(archive, bytes);
        await run("/usr/bin/ditto", ["-x", "-k", archive, staging]);

        const unpacked = path.join(staging, path.basename(target));
        await access(unpacked, constants.F_OK);

        emitEvent("updater:progress", { percent: 100, transferred: total, total });
        await handOffToSwapScript({ staging, unpacked, target, version });
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    },
  };
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

/** Writes and detaches the script that actually replaces the bundle.
 *
 *  It has to outlive this process: macOS will not let a running app be
 *  swapped out from under itself, so the script waits for the PID to go away
 *  first. The old bundle is moved aside rather than deleted outright, and put
 *  back if the move of the new one fails — a failed update should leave a
 *  working app, not no app. */
async function handOffToSwapScript(opts: {
  staging: string;
  unpacked: string;
  target: string;
  version: string;
}): Promise<void> {
  const { staging, unpacked, target, version } = opts;
  const backup = `${target}.old-${process.pid}`;
  const script = path.join(staging, "swap.sh");

  await writeFile(
    script,
    `#!/bin/sh
set -e
while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
if ! mv "${target}" "${backup}"; then exit 1; fi
if ! mv "${unpacked}" "${target}"; then mv "${backup}" "${target}"; exit 1; fi
rm -rf "${backup}"
# The archive was never downloaded by a browser, so it carries no quarantine
# attribute and Gatekeeper has nothing to prompt about — the same reason the
# Tauri build installed cleanly without an Apple identity.
open "${target}"
rm -rf "${staging}"
`,
    { mode: 0o755 },
  );

  console.log(`[updater] staged ${version}, swapping after quit`);
  spawn("/bin/sh", [script], { detached: true, stdio: "ignore" }).unref();
  app.quit();
}

export { isNewer as __isNewerForTests };
