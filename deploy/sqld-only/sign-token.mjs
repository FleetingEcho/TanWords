// Prints a bearer token for connecting a TanWords desktop app directly to
// this standalone sqld instance (Settings > Cloud tab). Reproducible from
// deploy/sqld-only/.env alone. Pass "ro" for a read-only token.
import { sign, verify } from "node:crypto";
import { deriveKeysFromSecret, readEnvValue } from "../sqld/keys.mjs";

const envPath = new URL("./.env", import.meta.url);
const secret = readEnvValue(envPath, "TANWORDS_SQLD_AUTH_KEY");
if (!secret) {
  console.error("error: TANWORDS_SQLD_AUTH_KEY is not set in deploy/sqld-only/.env");
  console.error("Run deploy/sqld-only/deploy.sh once — it generates one.");
  process.exit(1);
}

const { privateKey, publicKey } = deriveKeysFromSecret(secret);

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const permission = process.argv[2] === "ro" ? "ro" : undefined;
const tenYears = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 60 * 60;
const header = { alg: "EdDSA", typ: "JWT" };
const payload = permission ? { a: permission, exp: tenYears } : { exp: tenYears };

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = sign(null, Buffer.from(signingInput), privateKey);
const jwt = `${signingInput}.${b64url(signature)}`;

const ok = verify(null, Buffer.from(signingInput), publicKey, signature);
console.error(`self-verify: ${ok ? "OK" : "FAILED"}`);
console.error(`permission: ${permission ?? "rw"}, expires: ${new Date(tenYears * 1000).toISOString()}`);
console.log(jwt);
