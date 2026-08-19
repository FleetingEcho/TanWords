// Prints a bearer token for connecting a TanWords desktop app directly to
// the deployed sqld instance (Settings > Cloud tab). Reproducible from
// deploy/.env alone — nothing else to keep track of. Re-running this after
// TANWORDS_SQLD_AUTH_KEY is rotated (and redeployed) prints a token that
// matches the new keypair; tokens signed against the old key stop verifying
// as soon as the server's public key is updated.
import { sign, verify } from "node:crypto";
import { deriveKeysFromSecret, readEnvValue } from "./keys.mjs";

const envPath = new URL("../.env", import.meta.url);
const secret = readEnvValue(envPath, "TANWORDS_SQLD_AUTH_KEY");
if (!secret) {
  console.error("error: TANWORDS_SQLD_AUTH_KEY is not set in deploy/.env");
  console.error("Run deploy/build-and-deploy.sh (or deploy/deploy-server.sh) once — it generates one.");
  process.exit(1);
}

const { privateKey, publicKey } = deriveKeysFromSecret(secret);

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Empty claims + a far-future exp = full read-write access to the default
// namespace (see sqld's auth/user_auth_strategies/jwt.rs: no `a`/`p` claim
// defaults to Permission::Write). exp is a raw unix timestamp per sqld's
// custom jwt_time (de)serializer, not an RFC string. Pass "ro" as argv[2] for
// a read-only token instead.
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
