import type { DoctorSnapshotHomeTransportDiagnostics } from '@happier-dev/protocol';

const MAX_HOME_TRANSPORT_DIAGNOSTICS = 64;
const diagnosticsByHomeIdentity = new Map<string, DoctorSnapshotHomeTransportDiagnostics>();
const diagnosticsListeners = new Set<() => void>();

function notifyDiagnosticsListeners(): void {
    for (const listener of diagnosticsListeners) listener();
}

/** Materializes a carrier owner's Home-scoped facts for diagnostics consumers. */
export function publishIrohHomeTransportDiagnostics(
    diagnostics: DoctorSnapshotHomeTransportDiagnostics,
): void {
    const current = diagnosticsByHomeIdentity.get(diagnostics.homeServerIdentityId);
    if (current && (current.lastTransitionAtMs ?? 0) > (diagnostics.lastTransitionAtMs ?? 0)) return;
    diagnosticsByHomeIdentity.set(diagnostics.homeServerIdentityId, diagnostics);
    if (diagnosticsByHomeIdentity.size > MAX_HOME_TRANSPORT_DIAGNOSTICS) {
        const oldest = [...diagnosticsByHomeIdentity.values()]
            .sort((left, right) => (left.lastTransitionAtMs ?? 0) - (right.lastTransitionAtMs ?? 0))[0];
        if (oldest) diagnosticsByHomeIdentity.delete(oldest.homeServerIdentityId);
    }
    notifyDiagnosticsListeners();
}

export function readIrohHomeTransportDiagnostics(): readonly DoctorSnapshotHomeTransportDiagnostics[] {
    return [...diagnosticsByHomeIdentity.values()]
        .sort((left, right) => left.homeServerIdentityId.localeCompare(right.homeServerIdentityId));
}

export function subscribeIrohHomeTransportDiagnostics(listener: () => void): () => void {
    diagnosticsListeners.add(listener);
    return () => {
        diagnosticsListeners.delete(listener);
    };
}
