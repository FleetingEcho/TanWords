// Regenerates deploy/sqld-only/jwt.pub from deploy/sqld-only/.env's
// TANWORDS_SQLD_AUTH_KEY. Run by deploy.sh before every upload, so the
// server's trusted public key always matches whatever secret is currently
// in .env — editing that one value and redeploying is a full key rotation.
// Shares its key-derivation logic with the main app deployment's
// deploy/sqld/ (same math, different secret/server) rather than duplicating it.
import { writeFileSync } from "node:fs";
import { deriveKeysFromSecret, readEnvValue } from "../sqld/keys.mjs";

const envPath = new URL("./.env", import.meta.url);
const outPath = new URL("./jwt.pub", import.meta.url);

const secret = readEnvValue(envPath, "TANWORDS_SQLD_AUTH_KEY");
if (!secret) {
  console.error("error: TANWORDS_SQLD_AUTH_KEY is not set in deploy/sqld-only/.env");
  process.exit(1);
}

const { publicKey } = deriveKeysFromSecret(secret);
const pem = publicKey.export({ type: "spki", format: "pem" });
writeFileSync(outPath, pem);
console.error(`wrote ${outPath.pathname}`);
