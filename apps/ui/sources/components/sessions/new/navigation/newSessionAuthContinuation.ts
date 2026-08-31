import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';

import {
    buildNewSessionPickerFallbackHref,
    pickNewSessionRouteParams,
    type NewSessionRouteParams,
} from './setNewSessionPickerReturnParams';

export const NEW_SESSION_AUTH_CONTINUATION_PARAM = 'newSessionAuthContinuation';

function firstNonEmptyString(value: unknown): string | null {
    const candidate = Array.isArray(value) ? value[0] : value;
    return typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate.trim()
        : null;
}

export function buildNewSessionAuthContinuationRootHref(params: Readonly<{
    currentRouteParams: Readonly<Record<string, unknown>>;
    targetServerId: string;
}>): Readonly<{
    pathname: '/';
    params: Readonly<NewSessionRouteParams>;
}> {
    const targetServerId = params.targetServerId.trim();
    const fallback = buildNewSessionPickerFallbackHref(params.currentRouteParams);
    return {
        pathname: '/',
        params: {
            ...fallback.params,
            spawnServerId: targetServerId,
            [NEW_SESSION_AUTH_CONTINUATION_PARAM]: '1',
        },
    };
}

export function resolveNewSessionAuthContinuation(params: Readonly<{
    activeServerId: string | null | undefined;
    routeParams: Readonly<Record<string, unknown>>;
}>): ReturnType<typeof buildNewSessionPickerFallbackHref> | null {
    const marker = firstNonEmptyString(
        params.routeParams[NEW_SESSION_AUTH_CONTINUATION_PARAM],
    );
    const targetServerId = firstNonEmptyString(params.routeParams.spawnServerId);
    if (marker !== '1' || !targetServerId) return null;
    if (!areServerProfileIdentifiersEquivalent(params.activeServerId, targetServerId)) {
        return null;
    }
    return buildNewSessionPickerFallbackHref({
        ...pickNewSessionRouteParams(params.routeParams),
        spawnServerId: targetServerId,
    });
}
