import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import type { ActiveServerAccountScopeLifetime } from '@/sync/domains/scope/activeServerAccountScope';

/**
 * The embedded Session controller is the app's whole Session implementation (`SessionView`), owned
 * and tested by `EmbeddedSession.test.tsx`. Here it is the boundary: the renderer's contract is what
 * it hands that controller, never what the controller then draws.
 */
const controllerMounts = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock('@/components/sessions/shell/embedded/EmbeddedSessionProvider', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/components/sessions/shell/embedded/EmbeddedSessionProvider')>(),
    EmbeddedSessionProvider: (props: Record<string, unknown> & { children?: React.ReactNode }) => {
        controllerMounts.push(props);
        return React.createElement('EmbeddedSessionProvider', null, props.children ?? null);
    },
}));

const { PluginSessionPartMountScope, renderPluginSessionPart } = await import('./PluginSessionPartHost');
const { useIsBeneathPluginSurfaceNestingBoundary } = await import('./pluginSurfaceNesting');
const { createPluginUiPrivatePresentationHost } = await import('./pluginUiPrivatePresentationHost');

function lifetime(serverId: string): ActiveServerAccountScopeLifetime {
    return {
        scope: { serverId, accountId: 'account-1' },
        isCurrent: () => true,
        onRetire: () => ({ dispose: () => undefined }),
    };
}

function NestingProbe() {
    return React.createElement('NestingProbe', { beneath: useIsBeneathPluginSurfaceNestingBoundary() });
}

async function mount(
    input: Parameters<typeof renderPluginSessionPart>[0],
    accountLifetime: ActiveServerAccountScopeLifetime | null,
) {
    return await renderScreen(
        <PluginSessionPartMountScope accountLifetime={accountLifetime} presented focusEligible>
            {renderPluginSessionPart(input)}
        </PluginSessionPartMountScope>,
    );
}

describe('renderPluginSessionPart (plan 05 U2P)', () => {
    afterEach(() => {
        standardCleanup();
        controllerMounts.length = 0;
    });

    it('resolves the Session only inside the mount account scope, with every arm option at its default', async () => {
        await mount({ part: 'provider', sessionId: 'lead-7', readOnly: false, children: <NestingProbe /> }, lifetime('server-a'));
        expect(controllerMounts.at(-1)).toMatchObject({
            target: { kind: 'session', sessionId: 'lead-7' },
            serverId: 'server-a',
            presentation: { kind: 'embedded', composer: 'auto' },
            surfaceFocused: true,
            surfaceVisible: true,
        });
        expect(Object.keys(controllerMounts.at(-1)!.presentation as object).sort()).toEqual(['composer', 'kind']);
    });

    it('maps read-only to a composer-less presentation and stops nested plugin surfaces beneath it', async () => {
        const screen = await mount(
            { part: 'provider', sessionId: 'lead-7', readOnly: true, children: <NestingProbe /> },
            lifetime('server-a'),
        );
        expect(controllerMounts.at(-1)).toMatchObject({ presentation: { kind: 'embedded', composer: 'none' } });
        expect(screen.find((node) => node.type === ('NestingProbe' as never)).props.beneath).toBe(true);
    });

    it('keeps a visible Session mounted without making an unfocused surface focused', async () => {
        await renderScreen(
            <PluginSessionPartMountScope accountLifetime={lifetime('server-a')} presented focusEligible={false}>
                {renderPluginSessionPart({ part: 'chat', sessionId: 'lead-7', readOnly: false })}
            </PluginSessionPartMountScope>,
        );
        expect(controllerMounts.at(-1)).toMatchObject({ surfaceFocused: false, surfaceVisible: true });
    });

    it('renders the neutral unavailable state and no controller without a mount account scope', async () => {
        const screen = await mount({ part: 'chat', sessionId: 'lead-7', readOnly: false }, null);
        expect(controllerMounts).toHaveLength(0);
        expect(screen.findByTestId('embedded-session-unavailable')).not.toBeNull();
    });

    it('is installed only where the host asks for it', () => {
        expect(createPluginUiPrivatePresentationHost(undefined, {}).renderSessionPart).toBeUndefined();
        expect(createPluginUiPrivatePresentationHost(undefined, {
            renderSessionPart: renderPluginSessionPart,
        }).renderSessionPart).toBe(renderPluginSessionPart);
    });
});
