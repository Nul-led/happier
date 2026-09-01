import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HomeConnectionDescriptorV1Schema, type HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import { replacePersonalHomeFileDurably } from './durableFile.js';
import { createPersonalHomePathProtection } from './protection.js';
import type {
  PersonalHomeRelocationDestinationFacts,
  PersonalHomeRelocationDestinationOwner,
} from './relocationDestination.js';

export type PersonalHomeRelocationSourceResult = Readonly<{
  operationId: string;
  status: 'committed' | 'pending' | 'returned';
  destinationMachineId: string;
  sourceDescriptorRevision: number;
  publishedDescriptor?: HomeConnectionDescriptorV1;
  recoveryAction?: 'finish_move' | 'return_to_source';
}>;

export type PersonalHomeRelocationPublicationFacts = Readonly<{
  operationId: string;
  homeServerIdentityId: string;
  canonicalServerUrl: string;
  minimumOuterRevisionExclusive: number;
  endpoints: HomeConnectionDescriptorV1['endpoints'];
}>;

export type PersonalHomeRelocationSourceRecoveryFacts =
  | Readonly<{ status: 'none' }>
  | Readonly<{ status: 'ambiguous' }>
  | Readonly<{
      status: 'recovery_available';
      operationId: string;
      destinationMachineId: string;
      sourceDescriptorRevision: number;
      primaryAction: 'finish_move';
      secondaryAction: 'return_to_source';
    }>;

export type PersonalHomeRelocationSourceCoordinatorParams = Readonly<{
  sourceDataDir: string;
  operationId: string;
  homeServerIdentityId: string;
  sourceCanonicalServerUrl: string;
  sourceDescriptorRevision: number;
  destinationMachineId: string;
  recoveryAction?: 'finish_move' | 'return_to_source';
  stopSource(): Promise<void>;
  restoreSourceAfterFailedStage(): Promise<void>;
  quarantineSource(): Promise<void>;
  activateSource(): Promise<void>;
  readSourceServiceStatus(): Promise<Readonly<{ running: boolean; quarantined: boolean }>>;
  createFinalBackup(): Promise<Readonly<{ archivePath: string; bundleSha256: string }>>;
  destination: PersonalHomeRelocationDestinationOwner;
  publishDestination(facts: PersonalHomeRelocationPublicationFacts): Promise<HomeConnectionDescriptorV1>;
  readPublishedDescriptor(homeServerIdentityId: string): Promise<HomeConnectionDescriptorV1 | null>;
}>;

type SourceMarker = Readonly<{
  version: 1;
  operationId: string;
  phase: 'destination_staged' | 'source_quarantined' | 'pending' | 'committed' | 'returning_to_source' | 'returned_to_source';
  destinationMachineId: string;
  bundleSha256: string;
  homeServerIdentityId: string;
  sourceCanonicalServerUrl: string;
  sourceDescriptorRevision: number;
  sourceDescriptor: HomeConnectionDescriptorV1;
}>;

export class PersonalHomeRelocationSourceActivationBlockedError extends Error {
  readonly code = 'PERSONAL_HOME_RELOCATION_SOURCE_ACTIVATION_BLOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'PersonalHomeRelocationSourceActivationBlockedError';
  }
}

const protectRelocationSourcePath = createPersonalHomePathProtection();
const sourceMarkerPath = (dataDir: string): string => join(dataDir, '.operations', 'relocation-source.json');

function parseSourceMarker(raw: string): SourceMarker {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid marker');
  const marker = value as Record<string, unknown>;
  const sourceDescriptor = HomeConnectionDescriptorV1Schema.safeParse(marker.sourceDescriptor);
  if (Object.keys(marker).some((key) => !['version', 'operationId', 'phase', 'destinationMachineId', 'bundleSha256', 'homeServerIdentityId', 'sourceCanonicalServerUrl', 'sourceDescriptorRevision', 'sourceDescriptor'].includes(key))
    || marker.version !== 1
    || typeof marker.operationId !== 'string' || !marker.operationId
    || typeof marker.destinationMachineId !== 'string' || !marker.destinationMachineId
    || typeof marker.bundleSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(marker.bundleSha256)
    || typeof marker.homeServerIdentityId !== 'string' || !marker.homeServerIdentityId
    || typeof marker.sourceCanonicalServerUrl !== 'string' || !marker.sourceCanonicalServerUrl
    || typeof marker.sourceDescriptorRevision !== 'number' || !Number.isSafeInteger(marker.sourceDescriptorRevision) || marker.sourceDescriptorRevision < 1
    || !sourceDescriptor.success
    || sourceDescriptor.data.homeServerIdentityId !== marker.homeServerIdentityId
    || sourceDescriptor.data.canonicalServerUrl !== marker.sourceCanonicalServerUrl
    || sourceDescriptor.data.revision !== marker.sourceDescriptorRevision
    || typeof marker.phase !== 'string' || !['destination_staged', 'source_quarantined', 'pending', 'committed', 'returning_to_source', 'returned_to_source'].includes(marker.phase)) {
    throw new Error('invalid marker');
  }
  return marker as SourceMarker;
}

async function readSourceMarker(dataDir: string): Promise<SourceMarker | null> {
  try {
    return parseSourceMarker(await readFile(sourceMarkerPath(dataDir), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Personal Home relocation source state is invalid; the source must remain quarantined.');
  }
}

/** Stable recovery projection for settings/CLI inspection. Internal phases and
 * source-local paths remain private to the coordinator. */
export async function inspectPersonalHomeRelocationSourceRecovery(
  dataDir: string,
): Promise<PersonalHomeRelocationSourceRecoveryFacts> {
  let marker: SourceMarker | null;
  try {
    marker = await readSourceMarker(dataDir);
  } catch {
    return { status: 'ambiguous' };
  }
  if (!marker || marker.phase === 'committed' || marker.phase === 'returned_to_source') {
    return { status: 'none' };
  }
  return {
    status: 'recovery_available',
    operationId: marker.operationId,
    destinationMachineId: marker.destinationMachineId,
    sourceDescriptorRevision: marker.sourceDescriptorRevision,
    primaryAction: 'finish_move',
    secondaryAction: 'return_to_source',
  };
}

/** Ordinary lifecycle/start paths consult the source-local authority marker.
 * Destination activation uses the distinct destination `commit` authority and
 * therefore never needs a caller-controlled bypass flag. */
export async function assertPersonalHomeRelocationSourceAllowsActivation(dataDir: string): Promise<void> {
  let marker: SourceMarker | null;
  try {
    marker = await readSourceMarker(dataDir);
  } catch (error) {
    throw new PersonalHomeRelocationSourceActivationBlockedError(
      error instanceof Error ? error.message : 'Personal Home relocation source state is unreadable.',
    );
  }
  if (marker && marker.phase !== 'destination_staged' && marker.phase !== 'returning_to_source' && marker.phase !== 'returned_to_source') {
    throw new PersonalHomeRelocationSourceActivationBlockedError(
      'This Personal Home is a stopped relocation source. Finish or recover the move before starting it.',
    );
  }
}

async function writeSourceMarker(dataDir: string, marker: SourceMarker): Promise<void> {
  const directory = join(dataDir, '.operations');
  const target = sourceMarkerPath(dataDir);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await protectRelocationSourcePath(directory, 'directory');
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    await protectRelocationSourcePath(temporary, 'file');
    await replacePersonalHomeFileDurably(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function assertMarkerMatchesRequest(marker: SourceMarker, params: PersonalHomeRelocationSourceCoordinatorParams): void {
  if (marker.operationId !== params.operationId
    || marker.destinationMachineId !== params.destinationMachineId
    || marker.homeServerIdentityId !== params.homeServerIdentityId
    || marker.sourceCanonicalServerUrl !== params.sourceCanonicalServerUrl
    || marker.sourceDescriptorRevision !== params.sourceDescriptorRevision) {
    throw new Error('Another Personal Home relocation operation owns the source recovery state.');
  }
}

function descriptorMatchesDestination(
  descriptor: HomeConnectionDescriptorV1 | null,
  destination: PersonalHomeRelocationDestinationFacts,
): boolean {
  if (!descriptor || !destination.homeServerIdentityId || !destination.canonicalServerUrl) return false;
  const revisionFloor = destination.minimumOuterRevisionExclusive ?? destination.sourceDescriptorRevision;
  return descriptor.homeServerIdentityId === destination.homeServerIdentityId
    && descriptor.canonicalServerUrl === destination.canonicalServerUrl
    && descriptor.revision > revisionFloor;
}

function descriptorMatchesSource(
  descriptor: HomeConnectionDescriptorV1,
  source: HomeConnectionDescriptorV1,
): boolean {
  return descriptor.homeServerIdentityId === source.homeServerIdentityId
    && descriptor.canonicalServerUrl === source.canonicalServerUrl
    && JSON.stringify(descriptor.endpoints) === JSON.stringify(source.endpoints)
    && descriptor.revision >= source.revision;
}

function destinationPublicationFacts(
  operationId: string,
  destination: PersonalHomeRelocationDestinationFacts,
): PersonalHomeRelocationPublicationFacts {
  if (!destination.homeServerIdentityId || !destination.canonicalServerUrl) {
    throw new Error('Relocation destination did not provide a publishable connection endpoint.');
  }
  return {
    operationId,
    homeServerIdentityId: destination.homeServerIdentityId,
    canonicalServerUrl: destination.canonicalServerUrl,
    minimumOuterRevisionExclusive: destination.minimumOuterRevisionExclusive ?? destination.sourceDescriptorRevision,
    endpoints: destination.endpoint
      ? [{ kind: 'iroh', ...destination.endpoint }]
      : [{ kind: 'https', url: destination.canonicalServerUrl }],
  };
}

/**
 * Source-local cutover owner. The destination remains opaque: this coordinator
 * knows its stable machine identity and retry-safe operation contract, never a
 * remote filesystem path or service-manager command.
 */
export async function coordinatePersonalHomeRelocation(
  params: PersonalHomeRelocationSourceCoordinatorParams,
): Promise<PersonalHomeRelocationSourceResult> {
  let marker = await readSourceMarker(params.sourceDataDir);
  let staged: PersonalHomeRelocationDestinationFacts;
  if (!marker) {
    const sourceDescriptor = HomeConnectionDescriptorV1Schema.nullable().parse(
      await params.readPublishedDescriptor(params.homeServerIdentityId),
    );
    if (!sourceDescriptor
      || sourceDescriptor.homeServerIdentityId !== params.homeServerIdentityId
      || sourceDescriptor.canonicalServerUrl !== params.sourceCanonicalServerUrl
      || sourceDescriptor.revision !== params.sourceDescriptorRevision) {
      throw new Error('The current Personal Home source descriptor could not be authoritatively read before relocation.');
    }
    await params.stopSource();
    try {
      const backup = await params.createFinalBackup();
      staged = await params.destination.stage({
        operationId: params.operationId,
        archivePath: backup.archivePath,
        bundleSha256: backup.bundleSha256,
        expectedHomeServerIdentityId: params.homeServerIdentityId,
        expectedCanonicalServerUrl: params.sourceCanonicalServerUrl,
        sourceDescriptorRevision: params.sourceDescriptorRevision,
      });
      if (staged.status !== 'quarantined'
        || staged.homeServerIdentityId !== params.homeServerIdentityId
        || staged.bundleSha256 !== backup.bundleSha256
        || staged.authenticated !== true) {
        throw new Error('Relocation destination did not return verified quarantined facts for the transferred Home.');
      }
      marker = {
        version: 1,
        operationId: params.operationId,
        phase: 'destination_staged',
        destinationMachineId: params.destinationMachineId,
        bundleSha256: backup.bundleSha256,
        homeServerIdentityId: params.homeServerIdentityId,
        sourceCanonicalServerUrl: params.sourceCanonicalServerUrl,
        sourceDescriptorRevision: params.sourceDescriptorRevision,
        sourceDescriptor,
      };
      await writeSourceMarker(params.sourceDataDir, marker);
    } catch (error) {
      await params.restoreSourceAfterFailedStage();
      throw error;
    }
  } else {
    assertMarkerMatchesRequest(marker, params);
    const destinationStatus = await params.destination.status(params.operationId);
    const returnRecovery = params.recoveryAction === 'return_to_source';
    if (destinationStatus.status !== 'quarantined'
      && destinationStatus.status !== 'active'
      && !(returnRecovery && destinationStatus.status === 'aborted')) {
      throw new Error('Relocation destination recovery state is not verified and quarantined.');
    }
    staged = destinationStatus;
    if (!returnRecovery && marker.phase === 'committed' && destinationStatus.status === 'active') {
      const descriptor = await params.readPublishedDescriptor(params.homeServerIdentityId);
      if (!descriptor || !descriptorMatchesDestination(descriptor, staged)) {
        throw new Error('Committed relocation descriptor is no longer authoritative.');
      }
      return {
        operationId: params.operationId,
        status: 'committed',
        destinationMachineId: params.destinationMachineId,
        sourceDescriptorRevision: params.sourceDescriptorRevision,
        publishedDescriptor: descriptor,
      };
    }
  }

  if (params.recoveryAction === 'return_to_source') {
    if (marker.phase === 'returned_to_source') {
      const current = HomeConnectionDescriptorV1Schema.nullable().parse(
        await params.readPublishedDescriptor(params.homeServerIdentityId),
      );
      if (!current || !descriptorMatchesSource(current, marker.sourceDescriptor)) {
        throw new Error('Returned Personal Home source descriptor is no longer authoritative.');
      }
      return {
        operationId: params.operationId,
        status: 'returned',
        destinationMachineId: params.destinationMachineId,
        sourceDescriptorRevision: params.sourceDescriptorRevision,
        publishedDescriptor: current,
      };
    }
    await params.destination.abort(params.operationId);
    let current = HomeConnectionDescriptorV1Schema.nullable().parse(
      await params.readPublishedDescriptor(params.homeServerIdentityId),
    );
    const currentRevision = current?.revision ?? 0;
    if (!current || !descriptorMatchesSource(current, marker.sourceDescriptor)) {
      const minimumOuterRevisionExclusive = Math.max(
        marker.sourceDescriptor.revision,
        currentRevision,
      );
      try {
        await params.publishDestination({
          operationId: params.operationId,
          homeServerIdentityId: marker.sourceDescriptor.homeServerIdentityId,
          canonicalServerUrl: marker.sourceDescriptor.canonicalServerUrl,
          minimumOuterRevisionExclusive,
          endpoints: marker.sourceDescriptor.endpoints,
        });
      } catch {
        // Publication response loss is reconciled through fresh readback.
      }
      current = HomeConnectionDescriptorV1Schema.nullable().parse(
        await params.readPublishedDescriptor(params.homeServerIdentityId),
      );
    }
    if (!current || !descriptorMatchesSource(current, marker.sourceDescriptor)) {
      return {
        operationId: params.operationId,
        status: 'pending',
        destinationMachineId: params.destinationMachineId,
        sourceDescriptorRevision: params.sourceDescriptorRevision,
        recoveryAction: 'return_to_source',
      };
    }
    await writeSourceMarker(params.sourceDataDir, { ...marker, phase: 'returning_to_source' });
    await params.activateSource();
    const sourceService = await params.readSourceServiceStatus();
    if (!sourceService.running || sourceService.quarantined) {
      throw new Error('Original Personal Home authority was published but the source could not be activated.');
    }
    await writeSourceMarker(params.sourceDataDir, { ...marker, phase: 'returned_to_source' });
    return {
      operationId: params.operationId,
      status: 'returned',
      destinationMachineId: params.destinationMachineId,
      sourceDescriptorRevision: params.sourceDescriptorRevision,
      publishedDescriptor: current,
    };
  }

  if (marker.phase === 'destination_staged') {
    await params.quarantineSource();
    const sourceService = await params.readSourceServiceStatus();
    if (sourceService.running || !sourceService.quarantined) {
      throw new Error('Personal Home source could not be left stopped and quarantined for relocation cutover.');
    }
    marker = { ...marker, phase: 'source_quarantined' };
    await writeSourceMarker(params.sourceDataDir, marker);
  }

  try {
    HomeConnectionDescriptorV1Schema.parse(await params.publishDestination(
      destinationPublicationFacts(params.operationId, staged),
    ));
  } catch {
    // The publication request may have committed while its response was lost.
    // Fresh readback below is the sole authority for deciding whether cutover
    // may continue; neither Home is activated from a missing response.
  }
  const readback = HomeConnectionDescriptorV1Schema.nullable().parse(
    await params.readPublishedDescriptor(params.homeServerIdentityId),
  );
  const authoritative = descriptorMatchesDestination(readback, staged) ? readback : null;
  if (!authoritative) {
    await writeSourceMarker(params.sourceDataDir, { ...marker, phase: 'pending' });
    return {
      operationId: params.operationId,
      status: 'pending',
      destinationMachineId: params.destinationMachineId,
      sourceDescriptorRevision: params.sourceDescriptorRevision,
      recoveryAction: 'finish_move',
    };
  }

  await params.destination.commit({ operationId: params.operationId, publishedDescriptor: authoritative });
  await writeSourceMarker(params.sourceDataDir, { ...marker, phase: 'committed' });
  return {
    operationId: params.operationId,
    status: 'committed',
    destinationMachineId: params.destinationMachineId,
    sourceDescriptorRevision: params.sourceDescriptorRevision,
    publishedDescriptor: authoritative,
  };
}
