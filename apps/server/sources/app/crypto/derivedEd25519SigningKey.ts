import { createHash, createHmac } from "node:crypto";
import tweetnacl from "tweetnacl";

/**
 * Derives an Ed25519 seed in the server's established master-secret key tree.
 * Each caller owns a distinct domain; changing a domain changes persisted trust roots.
 */
export function deriveEd25519SigningSeed(masterSecret: string, domain: string): Uint8Array {
    return new Uint8Array(createHmac("sha512", `${domain} Master Seed`)
        .update(masterSecret, "utf8")
        .digest()
        .subarray(0, tweetnacl.sign.seedLength));
}

/** Stable identifier convention for server-derived Ed25519 public keys. */
export function createEd25519PublicKeyId(publicKey: Uint8Array): string {
    return createHash("sha256").update(publicKey).digest("hex");
}
