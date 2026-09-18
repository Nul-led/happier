import { getActiveServerAccountScope } from '@/sync/domains/scope/activeServerAccountScope';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import {
    arePendingTerminalConnectRecordsSameRequest,
    parsePendingTerminalConnectPreAuthEnvelope,
    parsePendingTerminalConnectRecord,
    pendingTerminalConnectFromParsedRecord,
    toRecord,
    type PendingTerminalConnect,
    type PendingTerminalConnectPreAuthEnvelope,
    type PendingTerminalConnectRecord,
} from './pendingTerminalConnect.shared';
import { isPendingServerUrlActive, normalizePendingServerUrl } from './pendingServerScopedKeys';

export type PendingTerminalConnectPersistence = Readonly<{
    readPreAuth: () => string | null | undefined;
    writePreAuth: (value: string) => boolean;
    clearPreAuth: () => void;
    readScoped: (scope: ServerAccountScope) => string | null | undefined;
    writeScoped: (scope: ServerAccountScope, value: string) => boolean;
    clearScoped: (scope: ServerAccountScope) => void;
    readLegacy: () => string | null | undefined;
    clearLegacy: () => void;
}>;

function parseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

export function createPendingTerminalConnectOwner(persistence: PendingTerminalConnectPersistence) {
    let memoryPreAuthEnvelope: PendingTerminalConnectPreAuthEnvelope | null = null;
    let preAuthStorageSuppressed = false;

    const readStoredRecord = (scope: ServerAccountScope): PendingTerminalConnectRecord | null => {
        const raw = persistence.readScoped(scope);
        if (!raw) return null;
        const record = parsePendingTerminalConnectRecord(parseJson(raw));
        if (!record) persistence.clearScoped(scope);
        return record;
    };

    const readPreAuthEnvelope = (): PendingTerminalConnectPreAuthEnvelope | null => {
        if (preAuthStorageSuppressed) {
            memoryPreAuthEnvelope = parsePendingTerminalConnectPreAuthEnvelope(memoryPreAuthEnvelope);
            return memoryPreAuthEnvelope;
        }
        const raw = persistence.readPreAuth();
        if (!raw) {
            memoryPreAuthEnvelope = parsePendingTerminalConnectPreAuthEnvelope(memoryPreAuthEnvelope);
            return memoryPreAuthEnvelope;
        }
        const envelope = parsePendingTerminalConnectPreAuthEnvelope(parseJson(raw));
        if (!envelope) {
            persistence.clearPreAuth();
            memoryPreAuthEnvelope = null;
            return null;
        }
        memoryPreAuthEnvelope = envelope;
        return envelope;
    };

    const writePreAuthEnvelope = (envelope: PendingTerminalConnectPreAuthEnvelope): void => {
        memoryPreAuthEnvelope = envelope;
        if (persistence.writePreAuth(JSON.stringify(envelope))) {
            preAuthStorageSuppressed = false;
            return;
        }
        // Keep this runtime's custody while ensuring an older unclaimed disk copy cannot be claimed after reload.
        preAuthStorageSuppressed = true;
        persistence.clearPreAuth();
    };

    const clearPreAuthEnvelope = (): void => {
        memoryPreAuthEnvelope = null;
        preAuthStorageSuppressed = true;
        persistence.clearPreAuth();
    };

    const setPendingTerminalConnect = (value: PendingTerminalConnect): void => {
        const activeScope = getActiveServerAccountScope();
        const serverUrl = normalizePendingServerUrl(value.serverUrl);
        if (!serverUrl) return;
        let record = toRecord({ ...value, serverUrl });
        if (!record) return;
        const existingPreAuth = readPreAuthEnvelope();
        if (existingPreAuth && arePendingTerminalConnectRecordsSameRequest(existingPreAuth.record, record)) {
            record = existingPreAuth.record;
        }
        if (activeScope && isPendingServerUrlActive(serverUrl)) {
            const existingScoped = readStoredRecord(activeScope);
            if (existingScoped && arePendingTerminalConnectRecordsSameRequest(existingScoped, record)) record = existingScoped;
            const claimed = { record, claimedScope: activeScope };
            if (persistence.writeScoped(activeScope, JSON.stringify(record))) {
                clearPreAuthEnvelope();
                return;
            }
            writePreAuthEnvelope(claimed);
            return;
        }
        writePreAuthEnvelope({ record });
    };

    const getPendingTerminalConnect = (): PendingTerminalConnect | null => {
        const activeScope = getActiveServerAccountScope();
        const envelope = readPreAuthEnvelope();
        const eligiblePreAuth = envelope && isPendingServerUrlActive(envelope.record.serverUrl) ? envelope : null;
        if (!activeScope) {
            return eligiblePreAuth && !eligiblePreAuth.claimedScope
                ? pendingTerminalConnectFromParsedRecord(eligiblePreAuth.record)
                : null;
        }
        const scopedRecord = readStoredRecord(activeScope);
        if (!eligiblePreAuth) return scopedRecord ? pendingTerminalConnectFromParsedRecord(scopedRecord) : null;
        if (eligiblePreAuth.claimedScope && !areServerAccountScopesEqual(eligiblePreAuth.claimedScope, activeScope)) {
            return scopedRecord ? pendingTerminalConnectFromParsedRecord(scopedRecord) : null;
        }
        if (scopedRecord && scopedRecord.createdAtMs > eligiblePreAuth.record.createdAtMs) {
            clearPreAuthEnvelope();
            return pendingTerminalConnectFromParsedRecord(scopedRecord);
        }
        const claimed = eligiblePreAuth.claimedScope ? eligiblePreAuth : { ...eligiblePreAuth, claimedScope: activeScope };
        writePreAuthEnvelope(claimed);
        if (persistence.writeScoped(activeScope, JSON.stringify(claimed.record))) clearPreAuthEnvelope();
        return pendingTerminalConnectFromParsedRecord(claimed.record);
    };

    const clearPendingTerminalConnect = (): void => {
        clearPreAuthEnvelope();
        const activeScope = getActiveServerAccountScope();
        if (activeScope) persistence.clearScoped(activeScope);
        const raw = persistence.readLegacy();
        if (!raw) return;
        const record = parsePendingTerminalConnectRecord(parseJson(raw));
        if (!record || isPendingServerUrlActive(record.serverUrl)) persistence.clearLegacy();
    };

    const retargetPendingTerminalConnectToServerUrl = (serverUrl: string): void => {
        const targetServerUrl = normalizePendingServerUrl(serverUrl);
        if (!targetServerUrl || !isPendingServerUrlActive(targetServerUrl)) return;
        const envelope = readPreAuthEnvelope();
        if (!envelope || envelope.claimedScope || envelope.record.homeConnectionDescriptor) return;
        if (normalizePendingServerUrl(envelope.record.serverUrl) === targetServerUrl) return;
        writePreAuthEnvelope({ record: { ...envelope.record, serverUrl: targetServerUrl } });
    };

    const migratePendingTerminalConnectScopes = (
        scope: ServerAccountScope,
        legacyScopes: readonly ServerAccountScope[],
    ): void => {
        let hasCanonicalRecord = readStoredRecord(scope) !== null;
        for (const legacyScope of legacyScopes) {
            if (legacyScope.serverId === scope.serverId && legacyScope.accountId === scope.accountId) continue;
            const legacyRecord = readStoredRecord(legacyScope);
            if (!hasCanonicalRecord && legacyRecord) {
                hasCanonicalRecord = persistence.writeScoped(scope, JSON.stringify(legacyRecord));
                if (!hasCanonicalRecord) continue;
            }
            persistence.clearScoped(legacyScope);
        }
    };

    return {
        setPendingTerminalConnect,
        getPendingTerminalConnect,
        clearPendingTerminalConnect,
        retargetPendingTerminalConnectToServerUrl,
        migratePendingTerminalConnectScopes,
    };
}
