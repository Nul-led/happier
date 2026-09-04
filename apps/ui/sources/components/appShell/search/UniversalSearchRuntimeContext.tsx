import * as React from 'react';

import type { Command } from '@/components/appShell/commandPalette/types';
import { resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';

export type UniversalSearchScopeSeed = Readonly<{
    accountId: string | null;
    serverId: string | null;
    sessionId: string | null;
    machineId: string | null;
    rootPath: string | null;
}>;

/** Canonicalize the one portable Home identity at Search ingress. */
export function canonicalizeUniversalSearchScopeSeed(
    scope: UniversalSearchScopeSeed,
): UniversalSearchScopeSeed {
    const serverId = resolveServerProfileScopeIdForIdentifier(scope.serverId) || null;
    return serverId === scope.serverId ? scope : { ...scope, serverId };
}

export function resolveUniversalSearchInvocationScope(input: Readonly<{
    requestedScope?: UniversalSearchScopeSeed;
    ambientScope: UniversalSearchScopeSeed;
}>): UniversalSearchScopeSeed {
    return canonicalizeUniversalSearchScopeSeed(input.requestedScope ?? input.ambientScope);
}

export type UniversalSearchRuntime = Readonly<{
    open(query?: string, scope?: UniversalSearchScopeSeed): void;
    buildCommands(activeSessionId?: string | null, scope?: UniversalSearchScopeSeed): readonly Command[];
}>;

const UniversalSearchRuntimeContext = React.createContext<UniversalSearchRuntime | null>(null);

export const UniversalSearchRuntimeProvider = UniversalSearchRuntimeContext.Provider;

export function useUniversalSearchRuntime(): UniversalSearchRuntime {
    const runtime = React.useContext(UniversalSearchRuntimeContext);
    if (!runtime) throw new Error('Universal Search runtime is not mounted');
    return runtime;
}
