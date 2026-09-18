import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { requestBytes, requestText } from './http.js';
import {
  resolveVerifiedReleaseArtifactDigest,
  verifyReleaseArtifactDigest,
} from './releaseArtifactVerification.js';

type ReleaseAsset = Readonly<{ name: string; url: string }>;

export type ReleaseAssetBundle = Readonly<{
  version: string;
  archive: ReleaseAsset;
  checksums: ReleaseAsset;
  checksumsSig: ReleaseAsset;
}>;

async function fetchText(url: string, { userAgent = 'happier-release-runtime' } = {}) {
  return await requestText({ url, headers: { 'user-agent': userAgent } });
}

async function fetchBytes(url: string, { userAgent = 'happier-release-runtime' } = {}) {
  return await requestBytes({ url, headers: { 'user-agent': userAgent } });
}

function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function downloadVerifiedReleaseAssetBundle(params: Readonly<{
  bundle: ReleaseAssetBundle;
  destDir: string;
  pubkeyFile: string;
  userAgent?: string;
}>): Promise<Readonly<{
  version: string;
  archiveName: string;
  archivePath: string;
  source: { archiveUrl: string; checksumsUrl: string };
}>> {
  const bundle = params.bundle;
  const destDir = String(params.destDir ?? '').trim();
  const pubkeyFile = String(params.pubkeyFile ?? '');
  const userAgent = String(params.userAgent ?? '').trim() || 'happier-release-runtime';
  if (!destDir) throw new Error('[download] destDir is required');
  if (!pubkeyFile.trim()) throw new Error('[download] pubkeyFile is required');

  await mkdir(destDir, { recursive: true });

  // Byte acquisition and the file sink are this adapter's job; the signature,
  // checksum and digest decision belongs to the shared cross-runtime core. The
  // trusted digest is established before the archive is fetched, so an unsigned
  // or unknown asset is never downloaded on an untrusted list's say-so.
  const checksumsText = await fetchText(bundle.checksums.url, { userAgent });
  const sigFile = await fetchText(bundle.checksumsSig.url, { userAgent });
  const resolved = resolveVerifiedReleaseArtifactDigest({
    artifactName: bundle.archive.name,
    checksumsText,
    checksumsSignatureFile: sigFile,
    minisignPublicKeyFile: pubkeyFile,
  });
  if (!resolved.ok) {
    if (resolved.reason === 'checksums_signature_invalid') {
      throw new Error('[download] signature verification failed for checksums file');
    }
    throw new Error(`[checksums] sha256 not found for ${resolved.artifactName}`);
  }

  const bytes = await fetchBytes(bundle.archive.url, { userAgent });
  const verified = verifyReleaseArtifactDigest({
    artifactName: resolved.artifactName,
    expectedSha256: resolved.sha256,
    artifactBytes: bytes,
    computeSha256Hex: sha256Hex,
  });
  if (!verified.ok) {
    throw new Error(`[download] checksum verification failed for ${verified.artifactName}`);
  }

  const archivePath = join(destDir, bundle.archive.name);
  await writeFile(archivePath, bytes);
  return {
    version: String(bundle.version ?? ''),
    archiveName: bundle.archive.name,
    archivePath,
    source: { archiveUrl: bundle.archive.url, checksumsUrl: bundle.checksums.url },
  };
}
