import { createHash, timingSafeEqual } from "node:crypto";

/** Shared low-level secret storage primitive for Account and scoped credentials. */
export function createSha256SecretDigest(secret: string): Buffer {
    return createHash("sha256").update(secret, "utf8").digest();
}

/** Compares stored base64url digests without making malformed rows observable. */
export function sha256SecretDigestMatches(storedDigest: string, suppliedSecret: string): boolean {
    try {
        const stored = Buffer.from(storedDigest, "base64url");
        const supplied = createSha256SecretDigest(suppliedSecret);
        return stored.byteLength === supplied.byteLength && timingSafeEqual(stored, supplied);
    } catch {
        return false;
    }
}
