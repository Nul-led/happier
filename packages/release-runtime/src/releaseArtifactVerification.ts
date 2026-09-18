import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';

import { findSha256, findSignedArtifactArchiveMetadataV1, type SignedArtifactArchiveMetadataV1 } from './checksums.js';
import { verifyMinisign } from './minisign.js';

export { DEFAULT_MINISIGN_PUBLIC_KEY, verifyMinisign } from './minisign.js';
export { lookupSha256 } from './checksums.js';

/**
 * Narrow cross-runtime release-verification entrypoint.
 *
 * Node, web, native and desktop callers share this one signature/digest
 * decision; platform adapters own byte acquisition, file sinks and — where the
 * platform offers a faster primitive — digest computation. Nothing here touches
 * the filesystem, the network, Node crypto or the Node `Buffer` global.
 */

export type ReleaseArtifactDigestResolution =
  | Readonly<{ ok: true; artifactName: string; sha256: string; archiveMetadata?: SignedArtifactArchiveMetadataV1 }>
  | Readonly<{ ok: false; reason: 'checksums_signature_invalid' }>
  | Readonly<{ ok: false; reason: 'checksum_entry_missing'; artifactName: string }>;

export type ReleaseArtifactDigestVerification =
  | Readonly<{ ok: true; artifactName: string; sha256: string }>
  | Readonly<{
    ok: false;
    reason: 'artifact_digest_mismatch';
    artifactName: string;
    expectedSha256: string;
    actualSha256: string;
  }>;

export type ReleaseArtifactVerification =
  | ReleaseArtifactDigestResolution
  | ReleaseArtifactDigestVerification;

/**
 * Optional platform digest primitive. The pure default hashes roughly 5x slower
 * than a native SHA-256 (measured in this repository: 64 MiB in 1521 ms with
 * `@noble/hashes` versus 278 ms with `node:crypto`), which matters for the
 * hundred-megabyte archives the Node downloader verifies. Supplying it moves
 * byte hashing to the platform, never the trust decision.
 */
type ComputeSha256Hex = (bytes: Uint8Array) => string;

export function sha256HexOfBytes(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

/**
 * Establish the trusted SHA-256 for one artifact from a signed checksums file.
 * Callers that stream or download the artifact separately run this first so
 * untrusted bytes are never fetched on the strength of an unsigned list.
 */
export function resolveVerifiedReleaseArtifactDigest(params: Readonly<{
  artifactName: string;
  checksumsText: string;
  checksumsSignatureFile: string;
  minisignPublicKeyFile: string;
}>): ReleaseArtifactDigestResolution {
  const artifactName = String(params.artifactName ?? '').trim();

  const signatureOk = verifyMinisign({
    message: params.checksumsText,
    pubkeyFile: params.minisignPublicKeyFile,
    sigFile: params.checksumsSignatureFile,
  });
  if (!signatureOk) {
    return { ok: false, reason: 'checksums_signature_invalid' };
  }

  const expectedSha256 = findSha256({ checksumsText: params.checksumsText, filename: artifactName });
  if (expectedSha256 == null) {
    return { ok: false, reason: 'checksum_entry_missing', artifactName };
  }

  let archiveMetadata: SignedArtifactArchiveMetadataV1 | null;
  try {
    archiveMetadata = findSignedArtifactArchiveMetadataV1({ checksumsText: params.checksumsText, filename: artifactName });
  } catch {
    return { ok: false, reason: 'checksum_entry_missing', artifactName };
  }
  return { ok: true, artifactName, sha256: expectedSha256, ...(archiveMetadata ? { archiveMetadata } : {}) };
}

export function verifyReleaseArtifactDigest(params: Readonly<{
  artifactName: string;
  expectedSha256: string;
} & (
  | { artifactBytes: Uint8Array; computeSha256Hex?: ComputeSha256Hex }
  | { actualSha256: string }
)>): ReleaseArtifactDigestVerification {
  const artifactName = String(params.artifactName ?? '').trim();
  const expectedSha256 = String(params.expectedSha256 ?? '');
  // Bounded platform file readers may compute the hash incrementally. Both
  // byte acquisition paths still use this one final verification decision.
  const actualSha256 = 'actualSha256' in params
    ? params.actualSha256
    : (params.computeSha256Hex ?? sha256HexOfBytes)(params.artifactBytes);

  if (!/^[a-f0-9]{64}$/i.test(expectedSha256)
      || !/^[a-f0-9]{64}$/i.test(actualSha256)
      || actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    return { ok: false, reason: 'artifact_digest_mismatch', artifactName, expectedSha256, actualSha256 };
  }
  return { ok: true, artifactName, sha256: expectedSha256 };
}

/** The whole decision for callers that already hold the artifact bytes. */
export function verifyReleaseArtifactBytes(params: Readonly<{
  artifactName: string;
  artifactBytes: Uint8Array;
  checksumsText: string;
  checksumsSignatureFile: string;
  minisignPublicKeyFile: string;
  computeSha256Hex?: ComputeSha256Hex;
}>): ReleaseArtifactVerification {
  const resolved = resolveVerifiedReleaseArtifactDigest(params);
  if (!resolved.ok) return resolved;

  return verifyReleaseArtifactDigest({
    artifactName: resolved.artifactName,
    expectedSha256: resolved.sha256,
    artifactBytes: params.artifactBytes,
    computeSha256Hex: params.computeSha256Hex,
  });
}
