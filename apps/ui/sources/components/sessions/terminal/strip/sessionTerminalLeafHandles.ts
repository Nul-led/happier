import * as React from 'react';

/**
 * The verbs only a mounted terminal view can perform (copy its selection, paste, clear, restart). The
 * pane's tab menu reaches the visible tab's terminals through these; a tab that is not on screen has
 * no mounted view, so its menu offers only the layout verbs.
 */
export type SessionTerminalLeafHandle = Readonly<{
    copySelection: (() => void) | null;
    paste: () => void;
    clear: () => void;
    restart: () => void;
}>;

export type SessionTerminalLeafHandles = Readonly<{
    register: (terminalId: string, handle: SessionTerminalLeafHandle) => () => void;
    get: (terminalId: string) => SessionTerminalLeafHandle | null;
}>;

export function createSessionTerminalLeafHandles(): SessionTerminalLeafHandles {
    const handles = new Map<string, SessionTerminalLeafHandle>();
    return {
        register: (terminalId, handle) => {
            handles.set(terminalId, handle);
            return () => { if (handles.get(terminalId) === handle) handles.delete(terminalId); };
        },
        get: (terminalId) => handles.get(terminalId) ?? null,
    };
}

export const SessionTerminalLeafHandlesContext = React.createContext<SessionTerminalLeafHandles | null>(null);
