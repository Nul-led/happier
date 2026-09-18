import * as React from 'react';

import {
    useFocusedSessionAddress,
    useFocusedSessionId,
} from '@/sync/domains/session/sessionSurfaceVisibility';

import { resolveSelectedSessionIdForList } from '@/sync/domains/session/listing/resolveSelectedSessionIdForList';

export type SessionCanvasSelection = Readonly<{
    sessionId: string;
    serverId: string | null;
}>;

export function useSessionCanvasSelection(params: Readonly<{
    selectable: boolean;
    pathname: string;
}>): SessionCanvasSelection | null {
    const focusedSessionId = useFocusedSessionId();
    const focusedSessionAddress = useFocusedSessionAddress();

    return React.useMemo(() => {
        const sessionId = resolveSelectedSessionIdForList({
            selectable: params.selectable,
            pathname: params.pathname,
            focusedSessionId,
        });
        if (!sessionId) return null;
        return {
            sessionId,
            serverId: focusedSessionAddress?.sessionId === sessionId
                ? focusedSessionAddress.serverId
                : null,
        };
    }, [focusedSessionAddress, focusedSessionId, params.pathname, params.selectable]);
}
