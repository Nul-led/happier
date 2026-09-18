import { describe, expect, it } from 'vitest';

import { createSessionFixture } from '@/dev/testkit/fixtures/sessionFixtures';

import { resolveSessionViewHeaderProps } from './resolveSessionViewHeaderProps';

function createHeaderInput(session: ReturnType<typeof createSessionFixture> | null) {
    return {
        isDataReady: true,
        session,
        sessionId: 'blocked-session',
        sessionInfoHref: '/session/blocked-session/info',
        sessionRunsHref: '/session/blocked-session/runs',
        sessionAutomationsHref: '/session/blocked-session/automations',
        paneScopeId: 'pane-1',
        windowWidth: 1200,
        sessionAutomationsEnabledCount: 3,
        sessionExecutionRunsSupported: true,
        showAutomations: true,
        shouldShowSubagentsButton: true,
        subagentActiveCount: 2,
        navigateWithBlurOnWeb: (action: () => void) => action(),
        handleHeaderExtraItemSelect: () => false,
        router: { push: () => {}, navigate: () => {} },
        actionIconColor: '#000',
        headerTintColor: '#000',
        statusErrorColor: '#f00',
        externalSessionRuntime: null,
    } as const;
}

describe('resolveSessionViewHeaderProps blocked surfaces', () => {
    it('uses canonical awareness serviceability instead of re-deriving connectivity from presence', () => {
        const session = createSessionFixture({
            id: 'blocked-session',
            presence: 'online',
            metadata: {
                name: 'Unservable session',
                path: '/tmp/project',
                host: 'test-host',
                terminal: {
                    mode: 'plain',
                    controlServiceabilityV1: {
                        v: 1,
                        state: 'recoverable_unservable',
                        observedAt: 1,
                    },
                },
            },
        });

        expect(resolveSessionViewHeaderProps(createHeaderInput(session)).isConnected).toBe(false);
    });

    it('keeps the safe identity but drops content-derived actions for blocked content', () => {
        const session = createSessionFixture({
            id: 'blocked-session',
            metadata: { name: 'Payments refactor', path: '/tmp/project', host: 'test-host' },
        });

        const readable = resolveSessionViewHeaderProps(createHeaderInput(session));
        const blocked = resolveSessionViewHeaderProps({
            ...createHeaderInput(session),
            blockedSurface: 'content_blocked',
        });

        expect(readable.rightElement).toBeDefined();
        expect(blocked.title).toBe('Payments refactor');
        expect(blocked.rightElement).toBeUndefined();
    });

    it('names an encrypted Session that has no safe title yet', () => {
        const blocked = resolveSessionViewHeaderProps({
            ...createHeaderInput(createSessionFixture({ id: 'blocked-session', metadata: null })),
            blockedSurface: 'content_blocked',
        });

        expect(blocked.title).toBe('Encrypted session');
    });

    it('reports removed access instead of a deleted Session, with or without a cached row', () => {
        for (const session of [createSessionFixture({ id: 'blocked-session' }), null]) {
            const denied = resolveSessionViewHeaderProps({
                ...createHeaderInput(session),
                routeHydrationState: { kind: 'missing', sessionId: 'blocked-session', cause: 'forbidden' },
                blockedSurface: 'access_denied',
            });

            expect(denied.title).toBe('Access removed');
            expect(denied.rightElement).toBeUndefined();
        }
    });
});
