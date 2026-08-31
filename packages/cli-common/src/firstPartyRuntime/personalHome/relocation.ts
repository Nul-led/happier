import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';

import { normalizePersonalHomeLockOrder, withPersonalHomeOperationLocks } from './lock.js';

export type PersonalHomeBundleTransfer = Readonly<{
    send(input: Readonly<{
        sourcePath: string;
        expectedBytes: number;
        expectedSha256: string;
        destination: unknown;
    }>): Promise<Readonly<{
        receivedPath: string;
        bytes: number;
        sha256: string;
    }>>;
}>;

export type PersonalHomeRelocationPhase = 'staged' | 'verified' | 'pending' | 'committed';

export type PersonalHomeRelocationMarker = Readonly<{
    version: 1;
    phase: PersonalHomeRelocationPhase;
    sourceDataDir: string;
    destinationDataDir: string;
    homeServerIdentityId: string;
    bundleSha256: string;
    priorSourceRunning: boolean;
}>;

export type PersonalHomeRelocationResult = Readonly<{
    homeServerIdentityId: string;
    destinationVerified: boolean;
    sourceStopped: boolean;
    sourceRollbackPath?: string;
    locationUpdateRequired: boolean;
    publicIntegrationsNeedAttention: string[];
    followerAction: 'none' | 'reconnect' | 'reenroll';
}>;

export class PersonalHomeRelocationActivationBlockedError extends Error {
    readonly code = 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' as const;

    constructor(message: string) {
        super(message);
        this.name = 'PersonalHomeRelocationActivationBlockedError';
    }
}

const relocationActivationContext = new AsyncLocalStorage<ReadonlySet<string>>();

async function withRelocationOwnedActivation<T>(dataDir: string, operation: () => Promise<T>): Promise<T> {
    const canonicalDataDir = resolve(dataDir);
    const inherited = relocationActivationContext.getStore();
    const allowed = new Set(inherited ?? []);
    allowed.add(canonicalDataDir);
    return await relocationActivationContext.run(allowed, operation);
}

function markerPath(dataDir: string): string {
    return join(resolve(dataDir), '.operations', 'relocation.json');
}

async function writeMarker(dataDir: string, marker: PersonalHomeRelocationMarker): Promise<void> {
    const path = markerPath(dataDir);
    await mkdir(join(resolve(dataDir), '.operations'), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}

function verifyTransfer(params: Readonly<{
    expectedBytes: number;
    expectedSha256: string;
    actual: Readonly<{ bytes: number; sha256: string }>;
}>): void {
    if (params.actual.bytes !== params.expectedBytes || params.actual.sha256 !== params.expectedSha256) {
        throw new Error('Personal Home bundle transfer verification failed');
    }
}

/**
 * Owns the data cutover only. Carrier choice and directory/profile publication remain injected
 * seams, so this owner never creates another transfer protocol or location authority.
 */
export async function relocatePersonalHome(params: Readonly<{
    source: Readonly<{ dataDir: string; homeServerIdentityId: string }>;
    destination: Readonly<{ dataDir: string }>;
    platform?: NodeJS.Platform;
    /** Re-read the canonical source facts only after both ordered Home locks are held. */
    revalidateSourceUnderLocks(): Promise<void>;
    createFinalBackup(): Promise<Readonly<{ path: string; sha256: string; manifest: unknown }>>;
    prepareDestination(): Promise<void>;
    stopSource(): Promise<void>;
    startSource(): Promise<void>;
    transfer: PersonalHomeBundleTransfer;
    restoreDestination(receivedPath: string): Promise<void>;
    verifyDestination(): Promise<Readonly<{ homeServerIdentityId: string }>>;
    startDestination(): Promise<Readonly<{ healthy: boolean; homeServerIdentityId: string }>>;
    stopDestination(): Promise<void>;
    commitSameHomeRelocation(input: Readonly<{ homeServerIdentityId: string; newConnectionDescriptor: HomeConnectionDescriptorV1 }>): Promise<void>;
    destinationDescriptor: HomeConnectionDescriptorV1;
    priorSourceRunning?: boolean;
    checkCancelledBeforeCutover?(): void;
    quarantineDestination(): Promise<void>;
    publicIntegrationsNeedAttention?: readonly string[];
    followerAction?: 'none' | 'reconnect' | 'reenroll';
}>): Promise<PersonalHomeRelocationResult> {
    const sourceDataDir = resolve(params.source.dataDir);
    const destinationDataDir = resolve(params.destination.dataDir);
    const orderedDataDirs = normalizePersonalHomeLockOrder([sourceDataDir, destinationDataDir], params.platform);
    if (orderedDataDirs.length !== 2) throw new Error('Personal Home relocation source and destination must differ');
    return await withPersonalHomeOperationLocks([
        { dataDir: sourceDataDir, role: 'source' },
        { dataDir: destinationDataDir, role: 'destination' },
    ], 'relocate', async () => {
    let bundleSha256 = '';
    let sourceStopped = false;
    let destinationPrepared = false;
    let committed = false;
    let destinationStarted = false;
    let destinationStopped = false;
    let destinationQuarantined = false;
    let publicationAttempted = false;
    let publicationCommitted = false;

    const persist = async (phase: PersonalHomeRelocationPhase): Promise<void> => {
        const marker: PersonalHomeRelocationMarker = {
            version: 1,
            phase,
            sourceDataDir,
            destinationDataDir,
            homeServerIdentityId: params.source.homeServerIdentityId,
            bundleSha256,
            priorSourceRunning: params.priorSourceRunning ?? true,
        };
        await writeMarker(sourceDataDir, marker);
        await writeMarker(destinationDataDir, marker);
    };

    try {
        await params.revalidateSourceUnderLocks();
        await params.prepareDestination();
        destinationPrepared = true;
        await persist('staged');

        params.checkCancelledBeforeCutover?.();
        await params.stopSource();
        sourceStopped = true;
        const backup = await params.createFinalBackup();
        const expectedBytes = (await stat(backup.path)).size;
        bundleSha256 = backup.sha256;
        const received = await params.transfer.send({
            sourcePath: backup.path,
            expectedBytes,
            expectedSha256: backup.sha256,
            destination: { dataDir: destinationDataDir },
        });
        verifyTransfer({ expectedBytes, expectedSha256: backup.sha256, actual: received });
        await params.restoreDestination(received.receivedPath);
        const verified = await params.verifyDestination();
        if (verified.homeServerIdentityId !== params.source.homeServerIdentityId) {
            throw new Error('Restored Personal Home identity does not match source Home');
        }
        destinationStarted = true;
        const activation = await withRelocationOwnedActivation(destinationDataDir, params.startDestination);
        if (!activation.healthy || activation.homeServerIdentityId !== params.source.homeServerIdentityId) {
            throw new Error('Activated Personal Home destination failed health or identity attestation');
        }
        // The first activation is private attestation only. Stop and quarantine the destination
        // before recording a publishable phase so a crash or lost publication response cannot
        // leave an unpublished writable Home behind.
        await params.stopDestination();
        destinationStopped = true;
        await params.quarantineDestination();
        destinationQuarantined = true;
        await persist('verified');

        params.checkCancelledBeforeCutover?.();
        // Persist the fail-closed cutover state before publication begins. A process exit or
        // lost response from this point cannot be reconciled as merely `verified`: both Homes
        // must stay stopped until an explicit retry, rollback, or discard action.
        await persist('pending');
        publicationAttempted = true;
        await params.commitSameHomeRelocation({
            homeServerIdentityId: params.source.homeServerIdentityId,
            newConnectionDescriptor: params.destinationDescriptor,
        });
        publicationCommitted = true;
        // Record the known publication result before activation. A process exit from this point
        // leaves a committed but stopped destination which the ordinary destination lifecycle can
        // safely start; it can never leave a writable destination described as pending.
        await persist('committed');
        committed = true;
        destinationStopped = false;
        destinationQuarantined = false;
        try {
            const committedActivation = await withRelocationOwnedActivation(destinationDataDir, params.startDestination);
            if (!committedActivation.healthy || committedActivation.homeServerIdentityId !== params.source.homeServerIdentityId) {
                throw new Error('Committed Personal Home destination failed health or identity attestation');
            }
        } catch (activationError) {
            const recoveryErrors: unknown[] = [];
            try { await params.stopDestination(); destinationStopped = true; } catch (stopError) { recoveryErrors.push(stopError); }
            try { await params.quarantineDestination(); destinationQuarantined = true; } catch (quarantineError) { recoveryErrors.push(quarantineError); }
            if (recoveryErrors.length > 0) {
                throw new AggregateError([activationError, ...recoveryErrors], 'Committed Personal Home destination activation failed and recovery is incomplete');
            }
            throw activationError;
        }
        return {
            homeServerIdentityId: params.source.homeServerIdentityId,
            destinationVerified: true,
            sourceStopped: true,
            sourceRollbackPath: sourceDataDir,
            locationUpdateRequired: false,
            publicIntegrationsNeedAttention: [...(params.publicIntegrationsNeedAttention ?? [])],
            followerAction: params.followerAction ?? 'reconnect',
        };
    } catch (error) {
        // From the moment the destination is prepared (staged marker persisted) the source is the
        // sole writable authority, so every failure — including cancellation or a stop failure
        // before `sourceStopped` — must quarantine the destination. The source restart belongs
        // only to the pre-publication staged path: unknown publication failure leaves both Homes
        // stopped in pending state, while a known committed publication is never demoted.
        if (destinationPrepared && !committed) {
            const destinationRecoveryErrors: unknown[] = [];
            const markerRecoveryErrors: unknown[] = [];
            if (destinationStarted && !destinationStopped) {
                try {
                    await params.stopDestination();
                    destinationStopped = true;
                } catch (stopError) {
                    destinationRecoveryErrors.push(stopError);
                }
            }
            if (!destinationQuarantined) {
                try {
                    await params.quarantineDestination();
                    destinationQuarantined = true;
                } catch (quarantineError) {
                    destinationRecoveryErrors.push(quarantineError);
                }
            }
            if (publicationCommitted) {
                // Publication returned successfully. Never demote a known committed location or
                // restart the source merely because durable marker publication was interrupted.
            } else if (publicationAttempted) {
                try {
                    await persist('pending');
                } catch (markerError) {
                    markerRecoveryErrors.push(markerError);
                }
            } else {
                try {
                    await persist('staged');
                } catch (markerError) {
                    markerRecoveryErrors.push(markerError);
                }
                // Never reactivate the source while destination stop/quarantine is uncertain: that
                // would convert a recovery failure into two potentially writable authorities.
                if (destinationRecoveryErrors.length === 0 && sourceStopped && (params.priorSourceRunning ?? true)) {
                    try {
                        await withRelocationOwnedActivation(sourceDataDir, params.startSource);
                        sourceStopped = false;
                    } catch (startError) {
                        markerRecoveryErrors.push(startError);
                    }
                }
            }
            const recoveryErrors = [...destinationRecoveryErrors, ...markerRecoveryErrors];
            if (recoveryErrors.length > 0) {
                throw new AggregateError([error, ...recoveryErrors], 'Personal Home relocation failed and recovery is incomplete');
            }
        }
        throw error;
    }
    }, params.platform);
}

export type PersonalHomeRelocationRecoveryAction = 'retry_publication' | 'rollback' | 'discard';
export type PersonalHomeRelocationRecoveryResult = Readonly<{ action: PersonalHomeRelocationRecoveryAction; phase: PersonalHomeRelocationPhase; sourceRunning: boolean; destinationRunning: boolean }>;

const MISSING_OR_DIVERGENT_MARKERS = 'Personal Home relocation recovery markers are missing, malformed, or divergent';

const RELOCATION_PHASE_ORDER: Readonly<Record<PersonalHomeRelocationPhase, number>> = {
    staged: 0,
    verified: 1,
    pending: 2,
    committed: 3,
};

function markerMatchesRecoveryTarget(marker: PersonalHomeRelocationMarker, sourceDataDir: string, destinationDataDir: string): boolean {
    return resolve(marker.sourceDataDir) === resolve(sourceDataDir)
        && resolve(marker.destinationDataDir) === resolve(destinationDataDir);
}

function markersDescribeSameRelocation(source: PersonalHomeRelocationMarker, destination: PersonalHomeRelocationMarker): boolean {
    return source.version === destination.version
        && resolve(source.sourceDataDir) === resolve(destination.sourceDataDir)
        && resolve(source.destinationDataDir) === resolve(destination.destinationDataDir)
        && source.homeServerIdentityId === destination.homeServerIdentityId
        && source.bundleSha256 === destination.bundleSha256
        && source.priorSourceRunning === destination.priorSourceRunning;
}

async function markerFileExists(dataDir: string): Promise<boolean> {
    try {
        await stat(markerPath(dataDir));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

/**
 * Fail-closed activation gate consumed by the managed Personal Home lifecycle owner. The only
 * bypass is the relocation owner's async context around its private attestation/recovery calls;
 * no task parameter or public lifecycle flag can grant it.
 */
export async function assertPersonalHomeRelocationAllowsActivation(dataDir: string): Promise<void> {
    const canonicalDataDir = resolve(dataDir);
    let marker: PersonalHomeRelocationMarker | null;
    try {
        marker = await readPersonalHomeRelocationMarker(canonicalDataDir);
    } catch (error) {
        throw new PersonalHomeRelocationActivationBlockedError(
            `Personal Home relocation state cannot be read safely; activation is blocked until explicit recovery (${error instanceof Error ? error.message : 'unknown error'}).`,
        );
    }
    if (!marker) {
        if (await markerFileExists(canonicalDataDir)) {
            throw new PersonalHomeRelocationActivationBlockedError(
                'Personal Home relocation state is invalid or ambiguous; activation is blocked until explicit recovery.',
            );
        }
        return;
    }

    const sourceDataDir = resolve(marker.sourceDataDir);
    const destinationDataDir = resolve(marker.destinationDataDir);
    const isSource = canonicalDataDir === sourceDataDir;
    const isDestination = canonicalDataDir === destinationDataDir;
    if (sourceDataDir === destinationDataDir || isSource === isDestination) {
        throw new PersonalHomeRelocationActivationBlockedError(
            'Personal Home relocation state does not identify this canonical Home root unambiguously; activation is blocked until explicit recovery.',
        );
    }

    if (relocationActivationContext.getStore()?.has(canonicalDataDir) === true) return;
    if (marker.phase === 'committed' && isDestination) return;

    throw new PersonalHomeRelocationActivationBlockedError(
        `Personal Home relocation is ${marker.phase}; ordinary ${isSource ? 'source' : 'destination'} activation is blocked until explicit recovery.`,
    );
}

async function readAndReconcileMarkers(sourceDataDir: string, destinationDataDir: string): Promise<PersonalHomeRelocationMarker> {
    const [source, destination] = await Promise.all([
        readPersonalHomeRelocationMarker(sourceDataDir),
        readPersonalHomeRelocationMarker(destinationDataDir),
    ]);
    if (!source || !markerMatchesRecoveryTarget(source, sourceDataDir, destinationDataDir)) {
        throw new Error(MISSING_OR_DIVERGENT_MARKERS);
    }
    if (!destination) {
        // Marker persistence is deliberately source-first. A missing destination marker is
        // recoverable only when the file is genuinely absent; a present-but-invalid marker fails
        // closed rather than being overwritten as if it were an interrupted write.
        if (await markerFileExists(destinationDataDir)) throw new Error(MISSING_OR_DIVERGENT_MARKERS);
        await writeMarker(destinationDataDir, source);
        return source;
    }
    if (!markerMatchesRecoveryTarget(destination, sourceDataDir, destinationDataDir)
        || !markersDescribeSameRelocation(source, destination)) {
        throw new Error(MISSING_OR_DIVERGENT_MARKERS);
    }
    if (source.phase === destination.phase) return source;
    // Each phase is persisted source-first and then destination. The only valid torn pair is
    // therefore a source marker exactly one phase ahead. Destination-ahead, skipped phases, or
    // immutable-field drift cannot be produced by this owner and remain fail-closed.
    if (RELOCATION_PHASE_ORDER[source.phase] !== RELOCATION_PHASE_ORDER[destination.phase] + 1) {
        throw new Error(MISSING_OR_DIVERGENT_MARKERS);
    }
    await writeMarker(destinationDataDir, source);
    return source;
}

/**
 * Deterministic recovery for the §14.6 phase machine. Every phase accepts only its approved
 * actions: staged/verified/pending expose rollback and discard, verified/pending additionally
 * expose publication retry (re-attest, publish once, mark committed); committed rejects every
 * action because the destination is the sole writable authority. Nothing runs without an
 * explicit action and a usable marker pair.
 */
export async function recoverPersonalHomeRelocation(params: Readonly<{
    sourceDataDir: string;
    destinationDataDir: string;
    action: PersonalHomeRelocationRecoveryAction;
    destinationDescriptor?: HomeConnectionDescriptorV1;
    startSource(): Promise<void>;
    stopDestination(): Promise<void>;
    quarantineDestination(): Promise<void>;
    discardDestination?(): Promise<void>;
    activateDestination(): Promise<Readonly<{ healthy: boolean; homeServerIdentityId: string }>>;
    commitSameHomeRelocation(input: Readonly<{ homeServerIdentityId: string; newConnectionDescriptor: HomeConnectionDescriptorV1 }>): Promise<void>;
}>): Promise<PersonalHomeRelocationRecoveryResult> {
    return await withPersonalHomeOperationLocks([
        { dataDir: params.sourceDataDir, role: 'source' },
        { dataDir: params.destinationDataDir, role: 'destination' },
    ], 'relocate', async () => {
        const marker = await readAndReconcileMarkers(params.sourceDataDir, params.destinationDataDir);
        if (marker.phase === 'committed') {
            // The destination is the sole writable authority and the source is retained rollback
            // bytes: no action may replay publication, restart the source, or delete it.
            throw new Error(`Personal Home relocation is already committed; ${params.action} would replay publication, restart the source, or delete the active destination`);
        }
        if (params.action === 'retry_publication') {
            if (marker.phase === 'staged') throw new Error('Personal Home relocation publication cannot be retried from the staged phase; the destination was never verified; use rollback or discard');
            if (!params.destinationDescriptor) throw new Error('Personal Home relocation publication retry requires the destination connection descriptor');
            let destinationMayBeRunning = false;
            let destinationQuarantined = false;
            try {
                // Re-attest before publishing: the destination may have been left in any state by
                // the interrupted run, and health must be re-observed under the recovery locks.
                destinationMayBeRunning = true;
                const activation = await withRelocationOwnedActivation(marker.destinationDataDir, params.activateDestination);
                if (!activation.healthy || activation.homeServerIdentityId !== marker.homeServerIdentityId) throw new Error('Recovered destination failed health or identity attestation');
                await params.stopDestination();
                destinationMayBeRunning = false;
                await params.quarantineDestination();
                destinationQuarantined = true;
                await writeMarker(params.sourceDataDir, { ...marker, phase: 'pending' });
                await writeMarker(params.destinationDataDir, { ...marker, phase: 'pending' });
                await params.commitSameHomeRelocation({ homeServerIdentityId: marker.homeServerIdentityId, newConnectionDescriptor: params.destinationDescriptor });
            } catch (error) {
                // Publication failed or its outcome is unknown: leave both homes stopped, the
                // destination quarantined, and the marker pending for the next explicit action.
                const recoveryErrors: unknown[] = [];
                if (destinationMayBeRunning) {
                    try { await params.stopDestination(); destinationMayBeRunning = false; } catch (stopError) { recoveryErrors.push(stopError); }
                }
                if (!destinationQuarantined) {
                    try { await params.quarantineDestination(); destinationQuarantined = true; } catch (quarantineError) { recoveryErrors.push(quarantineError); }
                }
                try { await writeMarker(params.sourceDataDir, { ...marker, phase: 'pending' }); } catch (markerError) { recoveryErrors.push(markerError); }
                try { await writeMarker(params.destinationDataDir, { ...marker, phase: 'pending' }); } catch (markerError) { recoveryErrors.push(markerError); }
                if (recoveryErrors.length > 0) {
                    throw new AggregateError([error, ...recoveryErrors], 'Personal Home relocation publication failed and recovery is incomplete');
                }
                throw error;
            }
            await writeMarker(params.sourceDataDir, { ...marker, phase: 'committed' });
            await writeMarker(params.destinationDataDir, { ...marker, phase: 'committed' });
            destinationQuarantined = false;
            destinationMayBeRunning = true;
            try {
                const committedActivation = await withRelocationOwnedActivation(marker.destinationDataDir, params.activateDestination);
                if (!committedActivation.healthy || committedActivation.homeServerIdentityId !== marker.homeServerIdentityId) throw new Error('Committed recovered destination failed health or identity attestation');
            } catch (error) {
                const recoveryErrors: unknown[] = [];
                try { await params.stopDestination(); destinationMayBeRunning = false; } catch (stopError) { recoveryErrors.push(stopError); }
                try { await params.quarantineDestination(); destinationQuarantined = true; } catch (quarantineError) { recoveryErrors.push(quarantineError); }
                if (recoveryErrors.length > 0) {
                    throw new AggregateError([error, ...recoveryErrors], 'Committed Personal Home destination activation failed and recovery is incomplete');
                }
                throw error;
            }
            return { action: params.action, phase: 'committed', sourceRunning: false, destinationRunning: true };
        }
        if (!params.discardDestination) throw new Error('Personal Home destination discard is unavailable');
        const destinationRecoveryErrors: unknown[] = [];
        try { await params.stopDestination(); } catch (stopError) { destinationRecoveryErrors.push(stopError); }
        try { await params.quarantineDestination(); } catch (quarantineError) { destinationRecoveryErrors.push(quarantineError); }
        if (destinationRecoveryErrors.length > 0) {
            throw new AggregateError(destinationRecoveryErrors, 'Personal Home destination could not be stopped and quarantined');
        }
        await params.discardDestination();
        if (marker.priorSourceRunning) await withRelocationOwnedActivation(marker.sourceDataDir, params.startSource);
        await unlink(markerPath(params.sourceDataDir)).catch(() => undefined);
        await unlink(markerPath(params.destinationDataDir)).catch(() => undefined);
        return { action: params.action, phase: marker.phase, sourceRunning: marker.priorSourceRunning, destinationRunning: false };
    });
}

export async function readPersonalHomeRelocationMarker(dataDir: string): Promise<PersonalHomeRelocationMarker | null> {
    try {
        const value: unknown = JSON.parse(await readFile(markerPath(dataDir), 'utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const parsed = value as Partial<PersonalHomeRelocationMarker>;
        const keys = Object.keys(value).sort();
        const expectedKeys = [
            'bundleSha256',
            'destinationDataDir',
            'homeServerIdentityId',
            'phase',
            'priorSourceRunning',
            'sourceDataDir',
            'version',
        ];
        if (
            keys.length !== expectedKeys.length
            || keys.some((key, index) => key !== expectedKeys[index])
            || parsed.version !== 1
            || !['staged', 'verified', 'pending', 'committed'].includes(String(parsed.phase))
            || typeof parsed.sourceDataDir !== 'string'
            || typeof parsed.destinationDataDir !== 'string'
            || typeof parsed.homeServerIdentityId !== 'string'
            || typeof parsed.bundleSha256 !== 'string'
            || typeof parsed.priorSourceRunning !== 'boolean'
        ) return null;
        const sourceDataDir = resolve(parsed.sourceDataDir);
        const destinationDataDir = resolve(parsed.destinationDataDir);
        if (
            parsed.sourceDataDir !== sourceDataDir
            || parsed.destinationDataDir !== destinationDataDir
            || sourceDataDir === destinationDataDir
            || parsed.homeServerIdentityId.trim() === ''
            || (
                parsed.phase === 'staged'
                    ? parsed.bundleSha256 !== '' && !/^[a-f0-9]{64}$/u.test(parsed.bundleSha256)
                    : !/^[a-f0-9]{64}$/u.test(parsed.bundleSha256)
            )
        ) return null;
        return parsed as PersonalHomeRelocationMarker;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
    }
}
