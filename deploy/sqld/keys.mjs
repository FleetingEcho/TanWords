// Deterministically derives an Ed25519 keypair from a single hex secret, so
// the only thing that has to exist (in deploy/.env, as TANWORDS_SQLD_AUTH_KEY)
// is one random value — the keypair sqld's JWT auth needs is reconstructed
// from it on demand, both locally (to sign tokens) and at deploy time (to
// write the public key sqld trusts). Rotating the .env value and redeploying
// changes the keypair, which invalidates every previously signed token.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

// RFC 8410 PKCS#8 encoding of a raw Ed25519 private key: a fixed 16-byte
// prefix (algorithm identifier for id-Ed25519) followed by the 32-byte seed.
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function deriveKeysFromSecret(hexSecret) {
  const secret = hexSecret.trim();
  if (!/^[0-9a-fA-F]{16,}$/.test(secret)) {
    throw new Error("TANWORDS_SQLD_AUTH_KEY must be a hex string (e.g. openssl rand -hex 32)");
  }
  const seed = createHash("sha256").update(secret, "utf8").digest();
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, seed]);
  const privateKey = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function readEnvValue(envPath, key) {
  if (!existsSync(envPath)) return "";
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}
