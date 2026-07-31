import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";

vi.mock("electron", () => ({
  app: { getVersion: () => "1.1.0", getPath: () => "/Applications/TanWords.app/Contents/MacOS/TanWords", quit: vi.fn() },
}));

import { __isNewerForTests as isNewer } from "./macUpdater";

describe("isNewer", () => {
  it("offers a genuinely newer version", () => {
    expect(isNewer("1.1.1", "1.1.0")).toBe(true);
    expect(isNewer("1.2.0", "1.1.9")).toBe(true);
    expect(isNewer("2.0.0", "1.9.9")).toBe(true);
  });

  it("does not offer the same version or an older one", () => {
    expect(isNewer("1.1.0", "1.1.0")).toBe(false);
    expect(isNewer("1.0.9", "1.1.0")).toBe(false);
    // A downgrade must never be offered: the feed always points at "latest",
    // so a rolled-back release would otherwise push everyone backwards.
    expect(isNewer("0.9.0", "1.1.0")).toBe(false);
  });

  // The reason this isn't a string compare: "1.10.0" < "1.9.0" lexically, so a
  // string compare silently stops offering updates after the ninth minor.
  it("compares segments numerically, not lexically", () => {
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("1.9.0", "1.10.0")).toBe(false);
    expect("1.10.0" > "1.9.0").toBe(false); // what the naive version would do
  });

  it("treats missing segments as zero", () => {
    expect(isNewer("1.2", "1.1.9")).toBe(true);
    expect(isNewer("1.1", "1.1.0")).toBe(false);
  });
});

/** The updater's whole security model is this signature: it is checked over the
 *  downloaded bytes before anything is written, so these assertions stand in
 *  for "a tampered download cannot be installed". Exercised against the real
 *  primitives the signing script and the updater both use. */
describe("ed25519 release signing", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const archive = Buffer.from("pretend this is a 130MB zip");

  const verifyAsUpdaterDoes = (bytes: Buffer, signatureB64: string) =>
    edVerify(
      null,
      bytes,
      createPublicKey({ key: Buffer.from(spki, "base64"), format: "der", type: "spki" }),
      Buffer.from(signatureB64, "base64"),
    );

  it("accepts an untampered archive", () => {
    const signature = edSign(null, archive, privateKey).toString("base64");
    expect(verifyAsUpdaterDoes(archive, signature)).toBe(true);
  });

  it("rejects an archive whose bytes changed", () => {
    const signature = edSign(null, archive, privateKey).toString("base64");
    expect(verifyAsUpdaterDoes(Buffer.from("something else entirely"), signature)).toBe(false);
    // Even a single flipped byte.
    const tampered = Buffer.from(archive);
    tampered[0] ^= 0x01;
    expect(verifyAsUpdaterDoes(tampered, signature)).toBe(false);
  });

  it("rejects a signature made with a different key", () => {
    const attacker = generateKeyPairSync("ed25519");
    const forged = edSign(null, archive, attacker.privateKey).toString("base64");
    expect(verifyAsUpdaterDoes(archive, forged)).toBe(false);
  });

  it("rejects a malformed signature instead of throwing", () => {
    expect(verifyAsUpdaterDoes(archive, "bm90LWEtc2lnbmF0dXJl")).toBe(false);
  });
});
