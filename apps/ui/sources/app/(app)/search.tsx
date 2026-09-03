import * as React from 'react';
import { useGlobalSearchParams, useRouter } from 'expo-router';

import { UniversalSearchController } from '@/components/appShell/search/UniversalSearchController';
import { useUniversalSearchRuntime, type UniversalSearchScopeSeed } from '@/components/appShell/search/UniversalSearchRuntimeContext';

export default function UniversalSearchRoute(): React.ReactElement {
    const router = useRouter();
    const params = useGlobalSearchParams<{ q?: string | string[]; sessionId?: string | string[]; accountId?: string | string[]; serverId?: string | string[]; machineId?: string | string[]; rootPath?: string | string[] }>();
    const runtime = useUniversalSearchRuntime();
    const commands = React.useMemo(() => runtime.buildCommands(), [runtime]);
    const initialQuery = typeof params.q === 'string' ? params.q : '';
    const activeSessionId = typeof params.sessionId === 'string' ? params.sessionId : null;
    const initialScope: UniversalSearchScopeSeed = React.useMemo(() => ({
        accountId: typeof params.accountId === 'string' ? params.accountId : null,
        serverId: typeof params.serverId === 'string' ? params.serverId : null,
        sessionId: activeSessionId,
        machineId: typeof params.machineId === 'string' ? params.machineId : null,
        rootPath: typeof params.rootPath === 'string' ? params.rootPath : null,
    }), [activeSessionId, params.accountId, params.machineId, params.rootPath, params.serverId]);
    const close = React.useCallback(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/' as never);
    }, [router]);
    return (
        <UniversalSearchController
            commands={commands}
            initialQuery={initialQuery}
            activeSessionId={activeSessionId}
            initialScope={initialScope}
            presentation="route"
            onRequestClose={close}
        />
    );
}
