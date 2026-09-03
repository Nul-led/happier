import * as React from 'react';

import type { Command } from '@/components/appShell/commandPalette/types';

export type UniversalSearchScopeSeed = Readonly<{
    accountId: string | null;
    serverId: string | null;
    sessionId: string | null;
    machineId: string | null;
    rootPath: string | null;
}>;

export function resolveUniversalSearchInvocationScope(input: Readonly<{
    requestedScope?: UniversalSearchScopeSeed;
    ambientScope: UniversalSearchScopeSeed;
}>): UniversalSearchScopeSeed {
    return input.requestedScope ?? input.ambientScope;
}

export type UniversalSearchRuntime = Readonly<{
    open(query?: string, scope?: UniversalSearchScopeSeed): void;
    buildCommands(): readonly Command[];
}>;

const UniversalSearchRuntimeContext = React.createContext<UniversalSearchRuntime | null>(null);

export const UniversalSearchRuntimeProvider = UniversalSearchRuntimeContext.Provider;

export function useUniversalSearchRuntime(): UniversalSearchRuntime {
    const runtime = React.useContext(UniversalSearchRuntimeContext);
    if (!runtime) throw new Error('Universal Search runtime is not mounted');
    return runtime;
}
