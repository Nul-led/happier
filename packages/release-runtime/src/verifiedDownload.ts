import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { requestBytes, requestText, type DownloadProgress } from './http.js';
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

export type ReleaseDownloadProgress = Readonly<{
  phase: 'downloading' | 'verifying';
  receivedBytes?: number;
  totalBytes?: number;
}>;

function sha256Hex(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function downloadVerifiedReleaseAssetBundle(params: Readonly<{
  bundle: ReleaseAssetBundle;
  destDir: string;
  pubkeyFile: string;
  userAgent?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ReleaseDownloadProgress) => void;
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
  params.signal?.throwIfAborted();

  await mkdir(destDir, { recursive: true });

  // Byte acquisition and the file sink are this adapter's job; the signature,
  // checksum and digest decision belongs to the shared cross-runtime core. The
  // trusted digest is established before the archive is fetched, so an unsigned
  // or unknown asset is never downloaded on an untrusted list's say-so.
  const requestOptions = { headers: { 'user-agent': userAgent }, signal: params.signal };
  params.onProgress?.({ phase: 'downloading' });
  const checksumsText = await requestText({ url: bundle.checksums.url, ...requestOptions });
  const sigFile = await requestText({ url: bundle.checksumsSig.url, ...requestOptions });
  params.signal?.throwIfAborted();
  params.onProgress?.({ phase: 'verifying' });
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

  params.onProgress?.({ phase: 'downloading' });
  const bytes = await requestBytes({
    url: bundle.archive.url,
    ...requestOptions,
    onProgress: (progress: DownloadProgress) => params.onProgress?.({ phase: 'downloading', ...progress }),
  });
  params.signal?.throwIfAborted();
  params.onProgress?.({ phase: 'verifying' });
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
