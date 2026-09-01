import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';

import { WorkspaceManifestSchema } from '@happier-dev/protocol';
import type { ScmBackendRegistry } from '@/scm/registry';
import { buildWorkspaceExportArtifactsWithBlobProviderFromWorkspaceIntegration } from '@/scm/workspace/workspaceTransferResolution';
import type { ScmWorkspaceIntegrationWorkspaceExportArtifacts } from '@/scm/workspace/workspaceExportArtifacts';
import type { ScmWorkspaceIntegrationWorkspaceTransferRequestInput } from '@/scm/workspace/workspaceTransfer';
import type { WorkspaceExportBlobProvider } from '@/scm/workspace/workspaceExportStaging/stageWorkspaceEntries';
import type { WorkspaceExportMaterializationCustody } from '@/scm/workspace/workspaceExportMaterialization';
import { materializeWorkspaceExportArtifactsWithScmWorkspace } from '@/scm/workspace/workspaceExportMaterialization';
import type { DirectPeerOnDemandTransferScope } from '@/machines/transfer/directPeerTransport';
import { connectWorkspaceSyncMachineTunnel, type WorkspaceSyncMachineTunnel } from './workspaceSyncMachineCarrierStream';
import {
  createBufferTransferPayloadSource,
  createFileTransferPayloadSource,
  type TransferPayloadSource,
} from '@/machines/transfer/transferPayloadSource';

type WorkspaceSyncSeedEnvelopeV1 = Readonly<{
  v: 1;
  workspaceExportArtifacts: ScmWorkspaceIntegrationWorkspaceExportArtifacts;
  blobTransferIds: Readonly<Record<string, string>>;
}>;

const MACHINE_LOCAL_CAPABILITY_HEADER = 'X-Happier-Machine-Local-Capability';
const WORKSPACE_SYNC_SEED_MATERIALIZATION_NAMING = {
  siblingCopySuffixBase: 'happier-sync-seed',
  backupDirectoryPrefix: '.happier-sync-backup',
  stagingIdPrefix: 'workspace-sync-seed',
} as const;

function sanitizeMachineLocalCapabilityHeader(
  request: Buffer,
  headerEnd: number,
  expectedCapability: Buffer,
): Buffer | null {
  const requestLineEnd = request.indexOf('\r\n');
  if (requestLineEnd < 0 || requestLineEnd >= headerEnd) return null;
  let capabilityLine: Readonly<{ start: number; end: number }> | null = null;
  let lineStart = requestLineEnd + 2;
  while (lineStart <= headerEnd) {
    const lineEnd = request.indexOf('\r\n', lineStart);
    if (lineEnd < 0 || lineEnd > headerEnd) return null;
    const line = request.subarray(lineStart, lineEnd);
    const colon = line.indexOf(':');
    if (colon >= 0
      && line.subarray(0, colon).toString('ascii').trim().toLowerCase() === MACHINE_LOCAL_CAPABILITY_HEADER.toLowerCase()) {
      if (capabilityLine) return null;
      const supplied = Buffer.from(line.subarray(colon + 1).toString('ascii').trim(), 'ascii');
      if (supplied.byteLength !== expectedCapability.byteLength
        || !timingSafeEqual(supplied, expectedCapability)) return null;
      capabilityLine = { start: lineStart, end: lineEnd + 2 };
    }
    lineStart = lineEnd + 2;
  }
  if (!capabilityLine) return null;
  return Buffer.concat([
    request.subarray(0, capabilityLine.start),
    request.subarray(capabilityLine.end),
  ]);
}

/** Adapts the carrier's capability-prefixed loopback socket to ordinary local HTTP. */
export async function createWorkspaceSyncSeedTunnelHttpProxy(
  tunnel: WorkspaceSyncMachineTunnel,
): Promise<Readonly<{ localPort: number; requestHeaders: Readonly<Record<string, string>>; close(): Promise<void> }>> {
  const expectedCapability = Buffer.from(tunnel.localCapability, 'ascii');
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer((client) => {
    sockets.add(client);
    client.once('close', () => sockets.delete(client));
    let request = Buffer.alloc(0);
    const admit = (chunk: Buffer): void => {
      request = Buffer.concat([request, chunk]);
      if (request.byteLength > 16 * 1024) {
        client.destroy();
        return;
      }
      const headerEnd = request.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      client.off('data', admit);
      client.pause();
      const sanitizedRequest = sanitizeMachineLocalCapabilityHeader(request, headerEnd, expectedCapability);
      if (!sanitizedRequest) {
        client.destroy();
        return;
      }
      void connectWorkspaceSyncMachineTunnel(tunnel).then((carrier) => {
        sockets.add(carrier);
        carrier.once('close', () => sockets.delete(carrier));
        carrier.write(sanitizedRequest);
        client.pipe(carrier).pipe(client);
        client.resume();
      }, () => client.destroy());
    };
    client.on('data', admit);
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Workspace sync seed proxy did not bind');
  return {
    localPort: address.port,
    requestHeaders: { [MACHINE_LOCAL_CAPABILITY_HEADER]: tunnel.localCapability },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

function blobTransferId(operationId: string, digest: string): string {
  return `${operationId}:blob:${createHash('sha256').update(digest).digest('hex')}`;
}

export async function createWorkspaceSyncSeedExport(input: Readonly<{
  operationId: string;
  activeServerDir: string;
  sourcePath: string;
  workspaceTransfer: ScmWorkspaceIntegrationWorkspaceTransferRequestInput;
  registry?: ScmBackendRegistry;
}>): Promise<Readonly<{
  payloadSource: TransferPayloadSource;
  onDemandScope: DirectPeerOnDemandTransferScope;
}>> {
  const built = await buildWorkspaceExportArtifactsWithBlobProviderFromWorkspaceIntegration(input);
  const digests = [...new Set(built.workspaceExportArtifacts.manifest.entries.flatMap((entry) => (
    entry.kind === 'file' ? [entry.digest] : []
  )))];
  const transferIdByDigest = new Map(digests.map((digest) => [digest, blobTransferId(input.operationId, digest)]));
  const digestByTransferId = new Map([...transferIdByDigest].map(([digest, transferId]) => [transferId, digest]));
  const envelope: WorkspaceSyncSeedEnvelopeV1 = {
    v: 1,
    workspaceExportArtifacts: built.workspaceExportArtifacts,
    blobTransferIds: Object.fromEntries(transferIdByDigest),
  };
  return {
    payloadSource: createBufferTransferPayloadSource(Buffer.from(JSON.stringify(envelope), 'utf8')),
    onDemandScope: {
      allowTransferId: (transferId) => digestByTransferId.has(transferId),
      maxResolvedTransfers: digests.length,
      resolvePayloadSourceOnOpen: async ({ transferId }) => {
        const digest = digestByTransferId.get(transferId);
        const filePath = digest ? built.blobProvider?.getBlobFilePath(digest) : null;
        if (!digest || !filePath) throw new Error('Workspace sync seed blob is not authorized');
        return createFileTransferPayloadSource({
          filePath,
          ...(built.blobProvider?.disposeBlobFilePath
            ? { dispose: async () => await built.blobProvider?.disposeBlobFilePath?.(digest) }
            : {}),
        });
      },
    },
  };
}

export async function materializeLocalWorkspaceSyncSeed(input: Readonly<{
  operationId: string;
  activeServerDir: string;
  sourcePath: string;
  targetPath: string;
  workspaceTransfer: ScmWorkspaceIntegrationWorkspaceTransferRequestInput;
  materializationReceiptPath?: string;
  originalTargetExists?: boolean;
  registry?: ScmBackendRegistry;
}>): Promise<WorkspaceExportMaterializationCustody> {
  const built = await buildWorkspaceExportArtifactsWithBlobProviderFromWorkspaceIntegration(input);
  try {
    const materialized = await materializeWorkspaceExportArtifactsWithScmWorkspace({
      workspaceExportArtifacts: built.workspaceExportArtifacts,
      targetPath: input.targetPath,
      conflictPolicy: 'replace_existing',
      blobProvider: built.blobProvider ?? { getBlobFilePath: () => undefined },
      naming: WORKSPACE_SYNC_SEED_MATERIALIZATION_NAMING,
      ...(input.registry ? { registry: input.registry } : {}),
      sourcePath: input.sourcePath,
      ...(input.materializationReceiptPath ? { materializationReceiptPath: input.materializationReceiptPath } : {}),
      ...(input.originalTargetExists === undefined ? {} : { originalTargetExists: input.originalTargetExists }),
    });
    return materialized.custody;
  } finally {
    await built.blobProvider?.dispose?.();
  }
}

function parseEnvelope(raw: Buffer, operationId: string): WorkspaceSyncSeedEnvelopeV1 {
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8')) as unknown; } catch { throw new Error('Workspace sync seed manifest is malformed'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Workspace sync seed manifest is malformed');
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || !record.workspaceExportArtifacts || typeof record.workspaceExportArtifacts !== 'object'
    || !record.blobTransferIds || typeof record.blobTransferIds !== 'object' || Array.isArray(record.blobTransferIds)) {
    throw new Error('Workspace sync seed manifest is malformed');
  }
  const artifacts = record.workspaceExportArtifacts as Record<string, unknown>;
  const manifest = WorkspaceManifestSchema.parse(artifacts.manifest);
  const metadata = artifacts.workspaceIntegrationMetadata;
  if (metadata !== undefined && (!metadata || typeof metadata !== 'object' || Array.isArray(metadata))) {
    throw new Error('Workspace sync seed metadata is malformed');
  }
  const allowedDigests = new Set(manifest.entries.flatMap((entry) => entry.kind === 'file' ? [entry.digest] : []));
  const ids = record.blobTransferIds as Record<string, unknown>;
  if (Object.keys(ids).length !== allowedDigests.size) throw new Error('Workspace sync seed blob index is incomplete');
  const parsedIds: Record<string, string> = {};
  for (const digest of allowedDigests) {
    const transferId = ids[digest];
    if (transferId !== blobTransferId(operationId, digest)) throw new Error('Workspace sync seed blob index is malformed');
    parsedIds[digest] = transferId;
  }
  return {
    v: 1,
    workspaceExportArtifacts: {
      manifest,
      ...(metadata ? { workspaceIntegrationMetadata: metadata as Readonly<Record<string, unknown>> } : {}),
    },
    blobTransferIds: parsedIds,
  };
}

export async function materializeWorkspaceSyncSeedExport(input: Readonly<{
  operationId: string;
  targetPath: string;
  stagingDirectory: string;
  materializationReceiptPath?: string;
  originalTargetExists?: boolean;
  requestPayload(request: Readonly<{
    transferId: string;
    destinationPath: string;
    expectedSizeBytes?: number;
    expectedManifestHash?: string;
  }>): Promise<void>;
  materializeWorkspaceExportArtifacts(request: Readonly<{
    workspaceExportArtifacts: ScmWorkspaceIntegrationWorkspaceExportArtifacts;
    targetPath: string;
    conflictPolicy: 'replace_existing';
    blobProvider: WorkspaceExportBlobProvider;
    naming: Readonly<{ siblingCopySuffixBase: string; backupDirectoryPrefix: string; stagingIdPrefix: string }>;
    materializationReceiptPath?: string;
    originalTargetExists?: boolean;
  }>): Promise<Readonly<{ targetPath: string; custody: WorkspaceExportMaterializationCustody }>>;
}>): Promise<WorkspaceExportMaterializationCustody> {
  const operationDirectory = resolve(input.stagingDirectory, `workspace-sync-seed-${createHash('sha256').update(input.operationId).digest('hex')}`);
  await mkdir(operationDirectory, { recursive: true });
  try {
    const manifestPath = join(operationDirectory, 'manifest.json');
    await input.requestPayload({ transferId: input.operationId, destinationPath: manifestPath });
    const envelope = parseEnvelope(await readFile(manifestPath), input.operationId);
    const blobPaths = new Map<string, string>();
    const sizeByDigest = new Map(envelope.workspaceExportArtifacts.manifest.entries.flatMap((entry) => (
      entry.kind === 'file' ? [[entry.digest, entry.sizeBytes] as const] : []
    )));
    for (const [digest, transferId] of Object.entries(envelope.blobTransferIds)) {
      const destinationPath = join(operationDirectory, createHash('sha256').update(digest).digest('hex'));
      await input.requestPayload({
        transferId,
        destinationPath,
        expectedSizeBytes: sizeByDigest.get(digest)!,
        expectedManifestHash: digest,
      });
      blobPaths.set(digest, destinationPath);
    }
    const materialized = await input.materializeWorkspaceExportArtifacts({
      workspaceExportArtifacts: envelope.workspaceExportArtifacts,
      targetPath: input.targetPath,
      conflictPolicy: 'replace_existing',
      blobProvider: { getBlobFilePath: (digest) => blobPaths.get(digest) },
      naming: WORKSPACE_SYNC_SEED_MATERIALIZATION_NAMING,
      ...(input.materializationReceiptPath ? { materializationReceiptPath: input.materializationReceiptPath } : {}),
      ...(input.originalTargetExists === undefined ? {} : { originalTargetExists: input.originalTargetExists }),
    });
    return materialized.custody;
  } finally {
    await rm(operationDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
