import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { configuration } from '@/configuration';
import type { createAccountArtifactStore } from '@/api/artifacts/accountArtifactStore';
import { createTransferSessionLifecycle } from '@/transfers/core/transferSessionLifecycle';
import { TransferSessionStore } from '@/transfers/core/transferSessionStore';
import { resolveWorkspaceFileDownloadSource } from '@/transfers/targets/resolveWorkspaceFileDownloadSource';

export type ArtifactWorkspaceCaller = Readonly<{ sessionId: string; machineId: string; directory: string; runId?: string }>;

/** Every Artifact file input uses the same confined workspace transfer owner and its byte budget. */
export async function readArtifactWorkspaceFile(params: Readonly<{
  caller: ArtifactWorkspaceCaller;
  path: string;
  signal?: AbortSignal;
}>) {
  params.signal?.throwIfAborted();
  if (!params.caller.sessionId || !params.caller.machineId || !isAbsolute(params.caller.directory)) {
    throw Object.assign(new Error('artifact_source_unavailable'), { code: 'artifact_source_unavailable' });
  }
  const resolved = await resolveWorkspaceFileDownloadSource({ workingDirectory: params.caller.directory,
    path: params.path, asZip: false, accessPolicy: { kind: 'restrictedRoots', roots: [params.caller.directory] } });
  if (!resolved.success) throw Object.assign(new Error('artifact_source_forbidden'), { code: 'artifact_source_forbidden' });
  params.signal?.throwIfAborted();
  const transfers = new TransferSessionStore({ ttlMs: configuration.filesTransferSessionTtlMs });
  const lifecycle = createTransferSessionLifecycle({ store: transfers, chunkSizeBytes: configuration.filesTransferChunkBytes });
  try {
    const session = await lifecycle.openDownloadTransferSession({ source: resolved.source });
    const chunks: Buffer[] = [];
    let index = 0;
    for (;;) {
      params.signal?.throwIfAborted();
      const chunk = await lifecycle.readDownloadTransferChunk({ downloadId: session.downloadId, index });
      if (!chunk.success || !('contentBase64' in chunk)) {
        throw Object.assign(new Error('artifact_source_transfer_failed'), { code: 'artifact_source_transfer_failed' });
      }
      chunks.push(Buffer.from(chunk.contentBase64, 'base64'));
      if (chunk.isLast) break;
      index += 1;
    }
    await lifecycle.finalizeDownloadTransferSession({ downloadId: session.downloadId });
    params.signal?.throwIfAborted();
    const bytes = Buffer.concat(chunks);
    return { bytes, name: resolved.source.name, path: relative(params.caller.directory, resolved.source.filePath) };
  } finally {
    await transfers.dispose();
  }
}

export async function publishArtifactFromWorkspaceFile(params: Readonly<{
  store: ReturnType<typeof createAccountArtifactStore>;
  caller: ArtifactWorkspaceCaller;
  input: Readonly<{ path: string; title?: string; mime?: string; kind?: string }>;
  signal?: AbortSignal;
}>) {
  const file = await readArtifactWorkspaceFile({ caller: params.caller, path: params.input.path, signal: params.signal });
  const declaredMime = params.input.mime?.split(';', 1)[0].trim().toLowerCase();
  const allowsText = !declaredMime || declaredMime.startsWith('text/')
    || ['application/json', 'application/javascript', 'application/xml'].includes(declaredMime);
  let body: string | undefined;
  if (allowsText) {
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes);
      if (!decoded.includes('\0')) body = decoded;
    } catch { /* Non-UTF8 content uses the binary body path. */ }
  }
  const mime = params.input.mime ?? (body === undefined ? 'application/octet-stream' : 'text/plain');
  return params.store.create({ header: {
    title: params.input.title ?? file.name, kind: params.input.kind ?? 'published.v1', mime, sizeBytes: file.bytes.length,
    source: { sessionId: params.caller.sessionId, ...(params.caller.runId ? { runId: params.caller.runId } : {}),
      machineId: params.caller.machineId, path: file.path, sha: createHash('sha256').update(file.bytes).digest('hex') },
  }, ...(body === undefined ? { binary: { bytes: file.bytes, mime } } : { body }), ...(params.signal ? { signal: params.signal } : {}) });
}
