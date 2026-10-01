import { randomUUID } from '@/platform/randomUUID';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveNewSessionDraftRouteIdentity(params: Readonly<{
    routeDraftId: string | string[] | undefined;
    createDraftId?: () => string;
}>): Readonly<{
    draftId: string;
    shouldWriteRouteParam: boolean;
}> {
    const routeDraftId = typeof params.routeDraftId === 'string'
        ? params.routeDraftId.trim()
        : '';
    if (UUID_PATTERN.test(routeDraftId)) {
        return { draftId: routeDraftId, shouldWriteRouteParam: false };
    }
    return {
        draftId: (params.createDraftId ?? randomUUID)(),
        shouldWriteRouteParam: true,
    };
}

export function resolveNewSessionDraftRouteScope(input: Readonly<{
    activeScope: ServerAccountScope | null;
    hostScope?: ServerAccountScope;
    draftServerId: string | string[] | undefined;
    draftAccountId: string | string[] | undefined;
    requestedScopeResolution:
        | Readonly<{ kind: 'bound'; scope: ServerAccountScope }>
        | Readonly<{ kind: 'resolving' | 'unknown_home' | 'unavailable' | 'signed_out' }>;
}>): ServerAccountScope | null {
    if (input.hostScope) return input.hostScope;
    const draftServerId = typeof input.draftServerId === 'string' ? input.draftServerId.trim() : '';
    const draftAccountId = typeof input.draftAccountId === 'string' ? input.draftAccountId.trim() : '';
    if (!draftServerId) return input.activeScope;
    return input.requestedScopeResolution.kind === 'bound'
        && input.requestedScopeResolution.scope.serverId === draftServerId
        && input.requestedScopeResolution.scope.accountId === draftAccountId
        ? input.requestedScopeResolution.scope
        : null;
}
