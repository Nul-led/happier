import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  HomeConnectionDescriptorV1Schema,
  IrohEndpointDescriptorV1Schema,
  type HomeConnectionDescriptorV1,
  type IrohEndpointDescriptorV1,
} from '@happier-dev/protocol';

import { replacePersonalHomeFileDurably } from './durableFile.js';
import { withPersonalHomeOperationLock } from './lock.js';
import { createPersonalHomePathProtection } from './protection.js';
import type { PersonalHomeAuthenticatedReadiness } from './readiness.js';

export type PersonalHomeRelocationDestinationStatus =
  | 'absent'
  | 'receiving'
  | 'staged'
  | 'quarantined'
  | 'activating'
  | 'active'
  | 'aborted'
  | 'recovery_required';

export type PersonalHomeRelocationDestinationFacts = Readonly<{
  operationId: string;
  status: Exclude<PersonalHomeRelocationDestinationStatus, 'absent'>;
  bundleSha256: string;
  expectedHomeServerIdentityId: string;
  expectedCanonicalServerUrl: string;
  sourceDescriptorRevision: number;
  homeServerIdentityId?: string;
  canonicalServerUrl?: string;
  minimumOuterRevisionExclusive?: number;
  endpoint?: IrohEndpointDescriptorV1;
  authenticated?: true;
  accountCount?: number;
  sessionCount?: number;
  failureCode?: string;
  /** Source-side transfer staging succeeded, but its temporary remote upload
   * directory could not be removed. Destination authority remains valid. */
  transferCleanupNeedsAttention?: true;
}>;

export type PersonalHomeRelocationDestinationStageInput = Readonly<{
  operationId: string;
  archivePath: string;
  bundleSha256: string;
  expectedHomeServerIdentityId: string;
  expectedCanonicalServerUrl: string;
  sourceDescriptorRevision: number;
}>;

export type PersonalHomeRelocationDestinationCommitInput = Readonly<{
  operationId: string;
  publishedDescriptor: HomeConnectionDescriptorV1;
}>;

export type PersonalHomeRelocationDestinationOwner = Readonly<{
  stage(input: PersonalHomeRelocationDestinationStageInput): Promise<PersonalHomeRelocationDestinationFacts>;
  status(operationId: string): Promise<PersonalHomeRelocationDestinationFacts | Readonly<{ operationId: string; status: 'absent' }>>;
  commit(input: PersonalHomeRelocationDestinationCommitInput): Promise<PersonalHomeRelocationDestinationFacts>;
  abort(operationId: string): Promise<PersonalHomeRelocationDestinationFacts>;
}>;

export class PersonalHomeRelocationDestinationError extends Error {
  constructor(
    public readonly code:
      | 'invalid_relocation_operation'
      | 'relocation_operation_conflict'
      | 'relocation_bundle_mismatch'
      | 'relocation_destination_not_quarantined'
      | 'relocation_destination_recovery_required'
      | 'relocation_destination_not_staged'
      | 'relocation_destination_already_active',
    message: string,
  ) {
    super(message);
    this.name = 'PersonalHomeRelocationDestinationError';
  }
}

type Marker = PersonalHomeRelocationDestinationFacts & Readonly<{ version: 1 }>;

export type PersonalHomeRelocationDestinationDeps = Readonly<{
  dataDir: string;
  quarantine(): Promise<void>;
  readServiceStatus(): Promise<Readonly<{ running: boolean; quarantined: boolean }>>;
  /** Existing restore/verification owner. It must be retry-safe for this operation id. */
  stageCandidate(input: PersonalHomeRelocationDestinationStageInput): Promise<Readonly<{
    authenticated: true;
    homeServerIdentityId: string;
    accountCount: number;
    sessionCount: number;
    canonicalServerUrl?: string;
    minimumOuterRevisionExclusive?: number;
    endpoint?: IrohEndpointDescriptorV1;
  }>>;
  activate(): Promise<void>;
  attestActive(): Promise<PersonalHomeAuthenticatedReadiness>;
  abortCandidate(operationId: string): Promise<void>;
}>;

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const markerPath = (dataDir: string): string => join(dataDir, '.operations', 'relocation-destination.json');
const protectRelocationDestinationPath = createPersonalHomePathProtection();

function assertOperationId(operationId: string): void {
  if (!OPERATION_ID.test(operationId)) {
    throw new PersonalHomeRelocationDestinationError('invalid_relocation_operation', 'Invalid Personal Home relocation operation id.');
  }
}

function assertStageInput(input: PersonalHomeRelocationDestinationStageInput): void {
  assertOperationId(input.operationId);
  if (!input.archivePath.trim() || !SHA256.test(input.bundleSha256)
    || !input.expectedHomeServerIdentityId.trim()
    || !input.expectedCanonicalServerUrl.trim()
    || !Number.isSafeInteger(input.sourceDescriptorRevision) || input.sourceDescriptorRevision < 1) {
    throw new PersonalHomeRelocationDestinationError('invalid_relocation_operation', 'Invalid Personal Home relocation stage input.');
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: Buffer) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

function parseMarker(raw: string): Marker {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid marker');
  const value = parsed as Record<string, unknown>;
  const allowed = new Set(['version', 'operationId', 'status', 'bundleSha256', 'expectedHomeServerIdentityId', 'expectedCanonicalServerUrl', 'sourceDescriptorRevision', 'homeServerIdentityId', 'canonicalServerUrl', 'minimumOuterRevisionExclusive', 'endpoint', 'authenticated', 'accountCount', 'sessionCount', 'failureCode']);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || value.version !== 1
    || typeof value.operationId !== 'string' || !OPERATION_ID.test(value.operationId)
    || typeof value.bundleSha256 !== 'string' || !SHA256.test(value.bundleSha256)
    || typeof value.expectedHomeServerIdentityId !== 'string' || !value.expectedHomeServerIdentityId
    || typeof value.expectedCanonicalServerUrl !== 'string' || !value.expectedCanonicalServerUrl
    || typeof value.sourceDescriptorRevision !== 'number' || !Number.isSafeInteger(value.sourceDescriptorRevision) || value.sourceDescriptorRevision < 1
    || typeof value.status !== 'string' || !['receiving', 'staged', 'quarantined', 'activating', 'active', 'aborted', 'recovery_required'].includes(value.status)
    || (value.homeServerIdentityId !== undefined && (typeof value.homeServerIdentityId !== 'string' || !value.homeServerIdentityId))
    || (value.canonicalServerUrl !== undefined && (typeof value.canonicalServerUrl !== 'string' || !value.canonicalServerUrl))
    || (value.minimumOuterRevisionExclusive !== undefined && (typeof value.minimumOuterRevisionExclusive !== 'number' || !Number.isSafeInteger(value.minimumOuterRevisionExclusive) || value.minimumOuterRevisionExclusive < value.sourceDescriptorRevision))
    || (value.authenticated !== undefined && value.authenticated !== true)
    || (value.accountCount !== undefined && (typeof value.accountCount !== 'number' || !Number.isSafeInteger(value.accountCount) || value.accountCount < 1))
    || (value.sessionCount !== undefined && (typeof value.sessionCount !== 'number' || !Number.isSafeInteger(value.sessionCount) || value.sessionCount < 0))
    || (value.failureCode !== undefined && (typeof value.failureCode !== 'string' || !value.failureCode))) {
    throw new Error('invalid marker');
  }
  if ((value.status === 'quarantined' || value.status === 'activating' || value.status === 'active')
    && (value.authenticated !== true || typeof value.accountCount !== 'number' || typeof value.sessionCount !== 'number')) {
    throw new Error('invalid marker');
  }
  const parsedEndpoint = value.endpoint === undefined ? undefined : IrohEndpointDescriptorV1Schema.safeParse(value.endpoint);
  if (parsedEndpoint && !parsedEndpoint.success) throw new Error('invalid marker');
  return {
    version: 1,
    operationId: value.operationId,
    status: value.status as Marker['status'],
    bundleSha256: value.bundleSha256,
    expectedHomeServerIdentityId: value.expectedHomeServerIdentityId,
    expectedCanonicalServerUrl: value.expectedCanonicalServerUrl,
    sourceDescriptorRevision: value.sourceDescriptorRevision,
    ...(value.homeServerIdentityId === undefined ? {} : { homeServerIdentityId: value.homeServerIdentityId as string }),
    ...(value.canonicalServerUrl === undefined ? {} : { canonicalServerUrl: value.canonicalServerUrl as string }),
    ...(value.minimumOuterRevisionExclusive === undefined ? {} : { minimumOuterRevisionExclusive: value.minimumOuterRevisionExclusive as number }),
    ...(parsedEndpoint?.success ? { endpoint: parsedEndpoint.data } : {}),
    ...(value.authenticated === true ? { authenticated: true as const } : {}),
    ...(typeof value.accountCount === 'number' ? { accountCount: value.accountCount } : {}),
    ...(typeof value.sessionCount === 'number' ? { sessionCount: value.sessionCount } : {}),
    ...(value.failureCode === undefined ? {} : { failureCode: value.failureCode as string }),
  };
}

async function readMarker(dataDir: string): Promise<Marker | null> {
  try {
    return parseMarker(await readFile(markerPath(dataDir), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PersonalHomeRelocationDestinationError(
      'relocation_destination_recovery_required',
      'Personal Home relocation destination state is invalid; activation remains blocked.',
    );
  }
}

export class PersonalHomeRelocationDestinationActivationBlockedError extends Error {
  readonly code = 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'PersonalHomeRelocationDestinationActivationBlockedError';
  }
}

/** Ordinary lifecycle admission. Only a destination whose publication has
 * already been validated by commit may be started; pre-publication candidates
 * remain stopped even when a caller invokes the generic runtime controls. */
export async function assertPersonalHomeRelocationDestinationAllowsActivation(dataDir: string): Promise<void> {
  let marker: Marker | null;
  try {
    marker = await readMarker(dataDir);
  } catch (error) {
    throw new PersonalHomeRelocationDestinationActivationBlockedError(
      error instanceof Error ? error.message : 'Personal Home relocation destination state is unreadable.',
    );
  }
  if (marker && marker.status !== 'aborted' && marker.status !== 'activating' && marker.status !== 'active') {
    throw new PersonalHomeRelocationDestinationActivationBlockedError(
      'This Personal Home is a staged relocation destination. Finish or abort the move before starting it.',
    );
  }
}

async function writeMarker(dataDir: string, marker: Marker): Promise<void> {
  const path = markerPath(dataDir);
  await mkdir(join(dataDir, '.operations'), { recursive: true, mode: 0o700 });
  await protectRelocationDestinationPath(join(dataDir, '.operations'), 'directory');
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    await protectRelocationDestinationPath(temporary, 'file');
    await replacePersonalHomeFileDurably(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function publicFacts(marker: Marker): PersonalHomeRelocationDestinationFacts {
  const { version: _version, ...facts } = marker;
  return facts;
}

function assertSameOperation(marker: Marker, operationId: string): void {
  if (marker.operationId !== operationId) {
    throw new PersonalHomeRelocationDestinationError(
      'relocation_operation_conflict',
      'Another Personal Home relocation operation already owns this destination.',
    );
  }
}

function markerForStage(input: PersonalHomeRelocationDestinationStageInput, status: Marker['status']): Marker {
  return {
    version: 1,
    operationId: input.operationId,
    status,
    bundleSha256: input.bundleSha256,
    expectedHomeServerIdentityId: input.expectedHomeServerIdentityId,
    expectedCanonicalServerUrl: input.expectedCanonicalServerUrl,
    sourceDescriptorRevision: input.sourceDescriptorRevision,
  };
}

export function createPersonalHomeRelocationDestinationOwner(deps: PersonalHomeRelocationDestinationDeps): PersonalHomeRelocationDestinationOwner {
  const statusWithLease = async (operationId: string) => {
    assertOperationId(operationId);
    const marker = await readMarker(deps.dataDir);
    if (!marker) return { operationId, status: 'absent' as const };
    assertSameOperation(marker, operationId);
    return publicFacts(marker);
  };

  return Object.freeze({
    status: async (operationId) => await withPersonalHomeOperationLock(
      deps.dataDir,
      'relocate',
      () => statusWithLease(operationId),
    ),
    stage: async (input) => {
      assertStageInput(input);
      return await withPersonalHomeOperationLock(deps.dataDir, 'relocate', async () => {
        const existing = await readMarker(deps.dataDir);
        if (existing) {
          assertSameOperation(existing, input.operationId);
          if (existing.bundleSha256 !== input.bundleSha256
            || existing.expectedHomeServerIdentityId !== input.expectedHomeServerIdentityId
            || existing.expectedCanonicalServerUrl !== input.expectedCanonicalServerUrl
            || existing.sourceDescriptorRevision !== input.sourceDescriptorRevision) {
            throw new PersonalHomeRelocationDestinationError('relocation_operation_conflict', 'Relocation retry facts differ from the reserved destination operation.');
          }
          if (existing.status === 'quarantined' || existing.status === 'active') return publicFacts(existing);
          if (existing.status === 'staged' && existing.homeServerIdentityId) {
            await deps.quarantine();
            const service = await deps.readServiceStatus();
            if (service.running || !service.quarantined) {
              throw new PersonalHomeRelocationDestinationError('relocation_destination_not_quarantined', 'Verified destination could not be left stopped and quarantined.');
            }
            const quarantined: Marker = { ...existing, status: 'quarantined' };
            await writeMarker(deps.dataDir, quarantined);
            return publicFacts(quarantined);
          }
          if (existing.status === 'aborted') {
            throw new PersonalHomeRelocationDestinationError('relocation_operation_conflict', 'The relocation destination operation was already aborted.');
          }
          if (existing.status === 'recovery_required') {
            throw new PersonalHomeRelocationDestinationError('relocation_destination_recovery_required', 'The relocation destination requires explicit recovery.');
          }
        }
        if (await sha256File(input.archivePath) !== input.bundleSha256) {
          throw new PersonalHomeRelocationDestinationError('relocation_bundle_mismatch', 'Transferred Personal Home bundle digest does not match the source receipt.');
        }
        if (!existing) {
          await writeMarker(deps.dataDir, markerForStage(input, 'receiving'));
        }
        await deps.quarantine();
        const service = await deps.readServiceStatus();
        if (service.running || !service.quarantined) {
          throw new PersonalHomeRelocationDestinationError('relocation_destination_not_quarantined', 'Destination service is not durably stopped and quarantined.');
        }
        try {
          const candidate = await deps.stageCandidate(input);
          if (candidate.homeServerIdentityId !== input.expectedHomeServerIdentityId) {
            throw new PersonalHomeRelocationDestinationError('relocation_bundle_mismatch', 'Staged Personal Home identity does not match the relocation target.');
          }
          if (candidate.authenticated !== true
            || !Number.isSafeInteger(candidate.accountCount) || candidate.accountCount < 1
            || !Number.isSafeInteger(candidate.sessionCount) || candidate.sessionCount < 0) {
            throw new PersonalHomeRelocationDestinationError('relocation_bundle_mismatch', 'Staged Personal Home authentication facts are invalid.');
          }
          const staged: Marker = {
            ...markerForStage(input, 'staged'),
            homeServerIdentityId: candidate.homeServerIdentityId,
            authenticated: true,
            accountCount: candidate.accountCount,
            sessionCount: candidate.sessionCount,
            ...(candidate.canonicalServerUrl ? { canonicalServerUrl: candidate.canonicalServerUrl } : {}),
            ...(candidate.minimumOuterRevisionExclusive === undefined ? {} : { minimumOuterRevisionExclusive: candidate.minimumOuterRevisionExclusive }),
            ...(candidate.endpoint ? { endpoint: candidate.endpoint } : {}),
          };
          await writeMarker(deps.dataDir, staged);
          await deps.quarantine();
          const quarantinedStatus = await deps.readServiceStatus();
          if (quarantinedStatus.running || !quarantinedStatus.quarantined) {
            throw new PersonalHomeRelocationDestinationError('relocation_destination_not_quarantined', 'Verified destination could not be left stopped and quarantined.');
          }
          const quarantined: Marker = { ...staged, status: 'quarantined' };
          await writeMarker(deps.dataDir, quarantined);
          return publicFacts(quarantined);
        } catch (error) {
          await deps.quarantine().catch(() => undefined);
          const recovery: Marker = {
            ...markerForStage(input, 'recovery_required'),
            failureCode: error instanceof PersonalHomeRelocationDestinationError ? error.code : 'stage_failed',
          };
          await writeMarker(deps.dataDir, recovery).catch(() => undefined);
          throw error;
        }
      });
    },
    commit: async (input) => {
      assertOperationId(input.operationId);
      const publishedDescriptor = HomeConnectionDescriptorV1Schema.parse(input.publishedDescriptor);
      return await withPersonalHomeOperationLock(deps.dataDir, 'relocate', async () => {
        const marker = await readMarker(deps.dataDir);
        if (!marker) throw new PersonalHomeRelocationDestinationError('relocation_destination_not_staged', 'Relocation destination is not staged.');
        assertSameOperation(marker, input.operationId);
        if (marker.status === 'active') return publicFacts(marker);
        if ((marker.status !== 'quarantined' && marker.status !== 'activating' && marker.status !== 'recovery_required') || !marker.homeServerIdentityId) {
          throw new PersonalHomeRelocationDestinationError('relocation_destination_not_staged', 'Relocation destination is not verified and quarantined.');
        }
        const minimumOuterRevisionExclusive = marker.minimumOuterRevisionExclusive ?? marker.sourceDescriptorRevision;
        if (publishedDescriptor.homeServerIdentityId !== marker.homeServerIdentityId
          || publishedDescriptor.canonicalServerUrl !== marker.canonicalServerUrl
          || publishedDescriptor.revision <= minimumOuterRevisionExclusive) {
          throw new PersonalHomeRelocationDestinationError('invalid_relocation_operation', 'Published destination descriptor does not match the staged Home or advance its revision.');
        }
        try {
          const { failureCode: _failureCode, ...verifiedMarker } = marker;
          const activating: Marker = { ...verifiedMarker, status: 'activating' };
          await writeMarker(deps.dataDir, activating);
          await deps.activate();
          const attestation = await deps.attestActive();
          if (!attestation.authenticated || attestation.homeServerIdentityId !== marker.homeServerIdentityId) {
            throw new PersonalHomeRelocationDestinationError('relocation_destination_recovery_required', 'Activated relocation destination failed authenticated Home attestation.');
          }
          const active: Marker = { ...activating, status: 'active' };
          await writeMarker(deps.dataDir, active);
          return publicFacts(active);
        } catch (error) {
          await deps.quarantine().catch(() => undefined);
          const recovery: Marker = {
            ...marker,
            status: 'recovery_required',
            failureCode: error instanceof PersonalHomeRelocationDestinationError ? error.code : 'activation_failed',
          };
          await writeMarker(deps.dataDir, recovery).catch(() => undefined);
          throw error;
        }
      });
    },
    abort: async (operationId) => {
      assertOperationId(operationId);
      return await withPersonalHomeOperationLock(deps.dataDir, 'relocate', async () => {
        const marker = await readMarker(deps.dataDir);
        if (!marker) throw new PersonalHomeRelocationDestinationError('relocation_destination_not_staged', 'Relocation destination is not staged.');
        assertSameOperation(marker, operationId);
        if (marker.status === 'aborted') return publicFacts(marker);
        await deps.quarantine();
        const service = await deps.readServiceStatus();
        if (service.running || !service.quarantined) {
          throw new PersonalHomeRelocationDestinationError('relocation_destination_not_quarantined', 'Destination could not be quarantined before abort.');
        }
        await deps.abortCandidate(operationId);
        const aborted: Marker = { ...marker, status: 'aborted' };
        await writeMarker(deps.dataDir, aborted);
        return publicFacts(aborted);
      });
    },
  });
}
