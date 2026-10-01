import * as React from 'react';

import { Redirect, useLocalSearchParams } from '@/components/appShell/workspace/destinationRoute';

const EXACT_TURN_PARAM_KEYS = ['sourceSessionId', 'sourceTurnId', 'sourceServerId', 'sessionLifecycleEvents'] as const;

/**
 * A retired `/session/[id]/automations/**` route (FIN 04 §3.2): it lands on the session's Triggers
 * section, the one place session triggers are listed and written, keeping the session's Home.
 */
export function SessionTriggersRedirect(): React.ReactElement {
    const params = useLocalSearchParams<Record<string, string | string[]>>();
    const sessionId = typeof params.id === 'string' && params.id.length > 0 ? params.id : null;
    if (sessionId === null) return <Redirect href="/workflows" />;
    // The Home and an exact-turn binding ("When this turn finishes…") travel on.
    const forwarded: Record<string, string> = {};
    for (const key of ['serverId', ...EXACT_TURN_PARAM_KEYS]) {
        const value = params[key];
        if (typeof value === 'string' && value.length > 0) forwarded[key] = value;
    }
    return <Redirect href={{ pathname: '/session/[id]/triggers', params: { id: sessionId, ...forwarded } } as never} />;
}
