import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { AppPaneProvider } from '@/components/appShell/panes/AppPaneProvider';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { createSessionDiscussionDetailsTab } from '@/components/sessions/panes/details/sessionDetailsTabBuilders';
import { createSessionPaneScopeId } from '@/components/sessions/panes/sessionPaneScopeId';
import {
    buildSessionDiscussionRouteHref,
    readOpenSessionDiscussionTargetKey,
    useOpenSessionDiscussion,
} from './useOpenSessionDiscussion';

const route = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const viewport = vi.hoisted(() => ({ width: 1440 }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: route }).module;
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({ width: viewport.width, height: 900, scale: 1, fontScale: 1 }),
    });
});

const address = { serverId: 'home-b', sessionId: 'same-id' } as const;
const paneScopeId = createSessionPaneScopeId(address.sessionId, address.serverId);
const discussionTabKey = (discussionId: string) => createSessionDiscussionDetailsTab({
    kind: 'discussion', address, discussionId,
}).key;
const newDiscussionTabKey = createSessionDiscussionDetailsTab({ kind: 'new', address }).key;

/** The provider is a memo component; the harness wrapper contract wants a plain one. */
function PaneWrapper(props: Readonly<{ children?: React.ReactNode }>) {
    return <AppPaneProvider>{props.children}</AppPaneProvider>;
}

describe('build Session discussion route href', () => {
    it('carries the exact Session address and source surface', () => {
        const href = buildSessionDiscussionRouteHref({
            target: { kind: 'new', address },
            sourceSurface: 'collaboration',
        });
        expect(href).toContain('/discussions/new');
        expect(href).toContain('serverId=home-b');
        expect(href).toContain('sourceSurface=collaboration');
    });

    it('encodes the discussion id', () => {
        expect(buildSessionDiscussionRouteHref({
            target: { kind: 'discussion', address, discussionId: 'a/b' },
            sourceSurface: 'collaboration',
        })).toContain('/discussions/a%2Fb');
    });
});

describe('open Session discussion', () => {
    beforeEach(() => {
        route.push.mockClear();
        route.replace.mockClear();
        viewport.width = 1440;
    });
    afterEach(standardCleanup);

    it('opens the typed Details resource beside the mounted Session on wide layouts', async () => {
        const hook = await renderHook(() => ({
            pane: useAppPaneScope(paneScopeId),
            open: useOpenSessionDiscussion({ address }),
        }), { wrapper: PaneWrapper });

        await act(async () => hook.getCurrent().open.openDiscussion('discussion-9', 'Release readiness'));

        expect(hook.getCurrent().pane.scopeState?.details.activeTabKey).toBe(discussionTabKey('discussion-9'));
        expect(route.push).not.toHaveBeenCalled();
    });

    it('pushes the thin route on phones instead of a Details resource', async () => {
        viewport.width = 390;
        const hook = await renderHook(() => ({
            pane: useAppPaneScope(paneScopeId),
            open: useOpenSessionDiscussion({ address }),
        }), { wrapper: PaneWrapper });
        const existingTabCount = hook.getCurrent().pane.scopeState?.details.tabs.length ?? 0;

        await act(async () => hook.getCurrent().open.openDiscussion('discussion-9'));

        expect(route.push).toHaveBeenCalledTimes(1);
        expect(String(route.push.mock.calls[0]?.[0])).toContain('/discussions/discussion-9');
        expect(hook.getCurrent().pane.scopeState?.details.tabs ?? []).toHaveLength(existingTabCount);
    });

    it('reports the open discussion so its list row stays selected', async () => {
        const hook = await renderHook(() => useOpenSessionDiscussion({ address }), { wrapper: PaneWrapper });

        await act(async () => hook.getCurrent().openDiscussion('discussion-9'));
        expect(hook.getCurrent().activeDiscussionKey).toBe('discussion-9');

        await act(async () => hook.getCurrent().openNewDiscussion());
        expect(hook.getCurrent().activeDiscussionKey).toBe('new');
    });
});

describe('read open Session discussion target key', () => {
    it('reads the open discussion for this exact Session address', () => {
        expect(readOpenSessionDiscussionTargetKey({
            activeTabKey: discussionTabKey('discussion-9'),
            address,
        })).toBe('discussion-9');
    });

    it('reads the open new-discussion draft', () => {
        expect(readOpenSessionDiscussionTargetKey({
            activeTabKey: newDiscussionTabKey,
            address,
        })).toBe('new');
    });

    it('ignores a discussion tab belonging to another Home or Session', () => {
        expect(readOpenSessionDiscussionTargetKey({
            activeTabKey: createSessionDiscussionDetailsTab({
                kind: 'discussion', address: { serverId: 'home-c', sessionId: 'same-id' }, discussionId: 'discussion-9',
            }).key,
            address,
        })).toBeNull();
        expect(readOpenSessionDiscussionTargetKey({
            activeTabKey: createSessionDiscussionDetailsTab({
                kind: 'discussion', address: { serverId: 'home-b', sessionId: 'other-id' }, discussionId: 'discussion-9',
            }).key,
            address,
        })).toBeNull();
    });

    it('ignores every other Details resource and an empty workspace', () => {
        expect(readOpenSessionDiscussionTargetKey({ activeTabKey: 'execution-run:run-1', address })).toBeNull();
        expect(readOpenSessionDiscussionTargetKey({ activeTabKey: null, address })).toBeNull();
    });
});
