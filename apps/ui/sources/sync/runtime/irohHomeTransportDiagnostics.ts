import type { DoctorSnapshotHomeTransportDiagnostics } from '@happier-dev/protocol';

type DiagnosticsProducerIdentity = Readonly<{
    producerId: string;
    leaseId: string;
    homeServerIdentityId: string;
}>;

type ActiveDiagnosticsObservation = Readonly<{
    generation: symbol;
    identity: DiagnosticsProducerIdentity;
    diagnostics: DoctorSnapshotHomeTransportDiagnostics;
}>;

type InactiveDiagnosticsObservation = Readonly<{
    producerId: string;
    diagnostics: DoctorSnapshotHomeTransportDiagnostics;
}>;

export type IrohHomeTransportDiagnosticsPublisher = DiagnosticsProducerIdentity & Readonly<{
    publish: (diagnostics: DoctorSnapshotHomeTransportDiagnostics) => void;
    release: (diagnostics: DoctorSnapshotHomeTransportDiagnostics) => void;
}>;

const activeObservationsByIdentity = new Map<string, ActiveDiagnosticsObservation>();
const currentGenerationByIdentity = new Map<string, symbol>();
const inactiveDiagnosticsByProducerAndHome = new Map<string, InactiveDiagnosticsObservation>();
const diagnosticsListeners = new Set<() => void>();
let diagnosticsRevision = 0;

function producerIdentityKey(identity: DiagnosticsProducerIdentity): string {
    return JSON.stringify([identity.producerId, identity.leaseId, identity.homeServerIdentityId]);
}

function producerHomeKey(producerId: string, homeServerIdentityId: string): string {
    return JSON.stringify([producerId, homeServerIdentityId]);
}

function notifyDiagnosticsListeners(): void {
    diagnosticsRevision += 1;
    for (const listener of diagnosticsListeners) listener();
}

function assertMatchingHome(
    identity: DiagnosticsProducerIdentity,
    diagnostics: DoctorSnapshotHomeTransportDiagnostics,
): void {
    if (diagnostics.homeServerIdentityId !== identity.homeServerIdentityId) {
        throw new Error('Iroh Home transport diagnostics publisher cannot change Home identity');
    }
}

function transitionAtMs(diagnostics: DoctorSnapshotHomeTransportDiagnostics): number {
    return diagnostics.lastTransitionAtMs ?? 0;
}

function retainInactiveDiagnostics(
    producerId: string,
    diagnostics: DoctorSnapshotHomeTransportDiagnostics,
): void {
    const retained = diagnostics.current
        ? {
            ...diagnostics,
            state: 'disconnected' as const,
            current: undefined,
            lastKnown: diagnostics.lastKnown ?? diagnostics.current,
        }
        : diagnostics;
    const key = producerHomeKey(producerId, diagnostics.homeServerIdentityId);
    const current = inactiveDiagnosticsByProducerAndHome.get(key)?.diagnostics;
    if (!current || transitionAtMs(current) <= transitionAtMs(retained)) {
        inactiveDiagnosticsByProducerAndHome.set(key, { producerId, diagnostics: retained });
    }
}

function isAuthoritativeCurrent(diagnostics: DoctorSnapshotHomeTransportDiagnostics): boolean {
    return diagnostics.state === 'connected' && diagnostics.current !== undefined;
}

function materializeActiveHome(
    observations: readonly ActiveDiagnosticsObservation[],
    inactiveDiagnostics: readonly DoctorSnapshotHomeTransportDiagnostics[],
): DoctorSnapshotHomeTransportDiagnostics {
    const ordered = [...observations].sort((left, right) => {
        const authorityDifference = Number(isAuthoritativeCurrent(right.diagnostics))
            - Number(isAuthoritativeCurrent(left.diagnostics));
        if (authorityDifference !== 0) return authorityDifference;
        const currentDifference = Number(right.diagnostics.current !== undefined)
            - Number(left.diagnostics.current !== undefined);
        if (currentDifference !== 0) return currentDifference;
        return transitionAtMs(right.diagnostics) - transitionAtMs(left.diagnostics);
    });
    const selected = ordered[0].diagnostics;
    const lastKnown = [
        ...ordered.map((observation) => observation.diagnostics),
        ...inactiveDiagnostics,
    ]
        .filter((candidate): candidate is DoctorSnapshotHomeTransportDiagnostics => candidate !== undefined)
        .filter((candidate) => candidate.lastKnown !== undefined)
        .sort((left, right) => transitionAtMs(right) - transitionAtMs(left))[0]?.lastKnown;
    return { ...selected, ...(lastKnown ? { lastKnown } : {}) };
}

/**
 * Creates one lease-scoped diagnostics authority. Reusing a producer/lease
 * identity replaces its older generation, and late calls from that generation
 * are ignored. Releasing this publisher removes only its own observation.
 */
export function createIrohHomeTransportDiagnosticsPublisher(
    identity: DiagnosticsProducerIdentity,
): IrohHomeTransportDiagnosticsPublisher {
    const normalizedIdentity = {
        producerId: identity.producerId.trim(),
        leaseId: identity.leaseId.trim(),
        homeServerIdentityId: identity.homeServerIdentityId.trim(),
    };
    if (!normalizedIdentity.producerId || !normalizedIdentity.leaseId || !normalizedIdentity.homeServerIdentityId) {
        throw new Error('Iroh Home transport diagnostics publisher identity must be non-empty');
    }
    const key = producerIdentityKey(normalizedIdentity);
    const generation = Symbol(key);
    currentGenerationByIdentity.set(key, generation);
    let released = false;

    const publish = (diagnostics: DoctorSnapshotHomeTransportDiagnostics): void => {
        assertMatchingHome(normalizedIdentity, diagnostics);
        if (released || currentGenerationByIdentity.get(key) !== generation) return;
        const superseded = activeObservationsByIdentity.get(key);
        if (superseded && superseded.generation !== generation) {
            retainInactiveDiagnostics(superseded.identity.producerId, superseded.diagnostics);
        }
        activeObservationsByIdentity.set(key, { generation, identity: normalizedIdentity, diagnostics });
        if (diagnostics.lastKnown) retainInactiveDiagnostics(normalizedIdentity.producerId, diagnostics);
        notifyDiagnosticsListeners();
    };

    return {
        ...normalizedIdentity,
        publish,
        release(diagnostics) {
            assertMatchingHome(normalizedIdentity, diagnostics);
            if (released) return;
            released = true;
            if (currentGenerationByIdentity.get(key) !== generation) return;
            const current = activeObservationsByIdentity.get(key);
            currentGenerationByIdentity.delete(key);
            if (current?.generation === generation) activeObservationsByIdentity.delete(key);
            const lastKnown = current?.diagnostics.lastKnown
                ?? current?.diagnostics.current
                ?? diagnostics.lastKnown
                ?? diagnostics.current;
            retainInactiveDiagnostics(normalizedIdentity.producerId, {
                ...diagnostics,
                current: undefined,
                ...(lastKnown ? { lastKnown } : {}),
            });
            notifyDiagnosticsListeners();
        },
    };
}

export function readIrohHomeTransportDiagnostics(
    filter: Readonly<{ producerId?: string }> = {},
): readonly DoctorSnapshotHomeTransportDiagnostics[] {
    const activeByHome = new Map<string, ActiveDiagnosticsObservation[]>();
    for (const observation of activeObservationsByIdentity.values()) {
        if (filter.producerId && observation.identity.producerId !== filter.producerId) continue;
        const homeServerIdentityId = observation.diagnostics.homeServerIdentityId;
        const observations = activeByHome.get(homeServerIdentityId) ?? [];
        observations.push(observation);
        activeByHome.set(homeServerIdentityId, observations);
    }
    const inactiveByHome = new Map<string, DoctorSnapshotHomeTransportDiagnostics[]>();
    for (const observation of inactiveDiagnosticsByProducerAndHome.values()) {
        if (filter.producerId && observation.producerId !== filter.producerId) continue;
        const homeServerIdentityId = observation.diagnostics.homeServerIdentityId;
        const observations = inactiveByHome.get(homeServerIdentityId) ?? [];
        observations.push(observation.diagnostics);
        inactiveByHome.set(homeServerIdentityId, observations);
    }
    const materialized = new Map<string, DoctorSnapshotHomeTransportDiagnostics>();
    for (const [homeServerIdentityId, observations] of inactiveByHome) {
        materialized.set(
            homeServerIdentityId,
            [...observations].sort((left, right) => transitionAtMs(right) - transitionAtMs(left))[0],
        );
    }
    for (const [homeServerIdentityId, observations] of activeByHome) {
        materialized.set(
            homeServerIdentityId,
            materializeActiveHome(observations, inactiveByHome.get(homeServerIdentityId) ?? []),
        );
    }
    const values = filter.producerId
        ? [
            ...[...activeByHome.keys()]
                .map((homeServerIdentityId) => materialized.get(homeServerIdentityId))
                .filter((diagnostics): diagnostics is DoctorSnapshotHomeTransportDiagnostics => diagnostics !== undefined),
            ...[...materialized.entries()]
                .filter(([homeServerIdentityId]) => !activeByHome.has(homeServerIdentityId))
                .map(([, diagnostics]) => diagnostics)
                .sort((left, right) => transitionAtMs(right) - transitionAtMs(left)),
        ]
        : [...materialized.values()];
    return values
        .sort((left, right) => left.homeServerIdentityId.localeCompare(right.homeServerIdentityId));
}

export function subscribeIrohHomeTransportDiagnostics(listener: () => void): () => void {
    diagnosticsListeners.add(listener);
    return () => {
        diagnosticsListeners.delete(listener);
    };
}

/** Stable external-store snapshot token for registry subscribers. */
export function readIrohHomeTransportDiagnosticsRevision(): number {
    return diagnosticsRevision;
}

/** Forget diagnostics only when the Home itself is explicitly forgotten. */
export function retireIrohHomeTransportDiagnostics(homeServerIdentityIdRaw: string): void {
    const homeServerIdentityId = homeServerIdentityIdRaw.trim();
    if (!homeServerIdentityId) return;
    let changed = false;
    for (const [key, observation] of activeObservationsByIdentity) {
        if (observation.identity.homeServerIdentityId !== homeServerIdentityId) continue;
        activeObservationsByIdentity.delete(key);
        currentGenerationByIdentity.delete(key);
        changed = true;
    }
    for (const [key, observation] of inactiveDiagnosticsByProducerAndHome) {
        if (observation.diagnostics.homeServerIdentityId !== homeServerIdentityId) continue;
        inactiveDiagnosticsByProducerAndHome.delete(key);
        changed = true;
    }
    if (changed) notifyDiagnosticsListeners();
}
