import type { ApiChangeEntry } from '@/sync/api/types/apiTypes';
import { areServerAccountScopesEqual, type ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { SessionSystemRecordRepository } from './repository';

/** Called by the incumbent AccountChange publisher, outside its cursor work. */
export function invalidateSessionSystemRecordsFromChanges(params: Readonly<{
    scope: ServerAccountScope;
    changes: readonly ApiChangeEntry[];
    repository: SessionSystemRecordRepository;
}>): void {
    if (!areServerAccountScopesEqual(params.scope, params.repository.scope)) return;
    const sessionIds = new Set<string>();
    for (const change of params.changes) {
        if (change.kind !== 'session' && change.kind !== 'share') continue;
        const sessionId = typeof change.entityId === 'string' ? change.entityId.trim() : '';
        if (sessionId) sessionIds.add(sessionId);
    }
    // Hints coalesce. Every Session/share change is sufficient, including an
    // ordinary transcript change that replaced an earlier surface hint.
    for (const sessionId of sessionIds) params.repository.invalidate({ serverId: params.scope.serverId, sessionId });
}
