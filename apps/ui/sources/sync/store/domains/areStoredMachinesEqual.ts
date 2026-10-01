import type { Machine } from '../../domains/state/storageTypes';
import { areSessionValuesDeepEqual } from './areStoredSessionsEqual';

export function hasMachineDaemonStateAdvanced(
    previous: Machine | null | undefined,
    next: Machine,
): boolean {
    return typeof next.daemonStateVersion === 'number'
        && next.daemonStateVersion > (previous?.daemonStateVersion ?? 0);
}

/**
 * A machine this store already knew now reports a newer daemon: the daemon was
 * replaced or restarted, so it is a different endpoint. The first observation
 * of a machine is not a replacement: a reader that already asked the machine
 * asked the daemon this observation reports.
 */
export function hasMachineDaemonBeenReplaced(
    previous: Machine | null | undefined,
    next: Machine,
): boolean {
    return previous != null && hasMachineDaemonStateAdvanced(previous, next);
}

export function areStoredMachinesEqual(
    previous: Machine | null | undefined,
    next: Machine | null | undefined,
): boolean {
    if (previous === next) return true;
    if (!previous || !next) return previous === next;
    return previous.id === next.id
        && previous.kind === next.kind
        && previous.seq === next.seq
        && previous.createdAt === next.createdAt
        && previous.updatedAt === next.updatedAt
        && previous.active === next.active
        && previous.activeAt === next.activeAt
        && (previous.revokedAt ?? null) === (next.revokedAt ?? null)
        && previous.metadataVersion === next.metadataVersion
        && previous.daemonStateVersion === next.daemonStateVersion
        && (previous.replacedByMachineId ?? null) === (next.replacedByMachineId ?? null)
        && (previous.replacedAt ?? null) === (next.replacedAt ?? null)
        && (previous.replacementReason ?? null) === (next.replacementReason ?? null)
        && (previous.replacementSource ?? null) === (next.replacementSource ?? null)
        && (previous.replacementActorUserId ?? null) === (next.replacementActorUserId ?? null)
        && (previous.installationId ?? null) === (next.installationId ?? null)
        && (previous.contentPublicKeyFingerprint ?? null) === (next.contentPublicKeyFingerprint ?? null)
        && (previous.operationProtocolCapabilitiesRevision ?? null) === (next.operationProtocolCapabilitiesRevision ?? null)
        && areSessionValuesDeepEqual(previous.operationProtocolCapabilities ?? null, next.operationProtocolCapabilities ?? null)
        && (previous.storageMode ?? null) === (next.storageMode ?? null)
        && areSessionValuesDeepEqual(previous.availability ?? null, next.availability ?? null)
        && areSessionValuesDeepEqual(previous.metadata ?? null, next.metadata ?? null)
        && areSessionValuesDeepEqual(previous.daemonState ?? null, next.daemonState ?? null);
}
