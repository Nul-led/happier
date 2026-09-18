import { describe, expect, it } from 'vitest';

import { admitSessionPaneSurfaceScopeForAddress, type SessionPaneSurfaceScope } from './useSessionPluginRuntime';

function scope(input: Readonly<{ sessionId: string; serverId?: string | null }>): SessionPaneSurfaceScope {
    const base = {
        targetKind: 'session',
        sessionId: input.sessionId,
        projectionPhase: 'current',
        machineId: 'machine-a',
        interactionEnabled: true,
    } satisfies SessionPaneSurfaceScope;
    return input.serverId === undefined
        ? base
        : { ...base, serverId: input.serverId };
}

describe('exact Session pane scope admission', () => {
    const address = { serverId: 'home-a', sessionId: 'session-1' } as const;

    it('admits only a scope that names the same Home and the same Session', () => {
        expect(admitSessionPaneSurfaceScopeForAddress(address, scope({ sessionId: 'session-1', serverId: 'home-a' })))
            .not.toBeNull();
    });

    it('rejects the same Session id registered against another Home', () => {
        // Two Homes can hold the same Session id: matching the id alone would
        // let another Home's retained pane supply this Session's machine and
        // projection facts.
        expect(admitSessionPaneSurfaceScopeForAddress(address, scope({ sessionId: 'session-1', serverId: 'home-b' })))
            .toBeNull();
    });

    it('rejects an unqualified scope instead of borrowing the requested Home', () => {
        expect(admitSessionPaneSurfaceScopeForAddress(address, scope({ sessionId: 'session-1', serverId: null })))
            .toBeNull();
        expect(admitSessionPaneSurfaceScopeForAddress(address, scope({ sessionId: 'session-1' })))
            .toBeNull();
    });

    it('rejects a stale scope for another Session and an unqualifiable address', () => {
        expect(admitSessionPaneSurfaceScopeForAddress(address, scope({ sessionId: 'session-2', serverId: 'home-a' })))
            .toBeNull();
        expect(admitSessionPaneSurfaceScopeForAddress(null, scope({ sessionId: 'session-1', serverId: 'home-a' })))
            .toBeNull();
        expect(admitSessionPaneSurfaceScopeForAddress(address, undefined)).toBeNull();
    });
});
