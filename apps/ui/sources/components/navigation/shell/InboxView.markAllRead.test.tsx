import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture, renderScreen } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from './navigationShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type MarkReadCall = Readonly<{ sessionId: string; readState: string; serverId: string | null }>;

const markRead = vi.hoisted(() => ({
    calls: [] as MarkReadCall[],
    deferred: [] as ((result: { success: boolean }) => void)[],
    mode: 'immediate' as 'immediate' | 'deferred' | 'failure',
}));
const alerts = vi.hoisted(() => ({ titles: [] as string[] }));

function unreadSession(serverId: string) {
    return createSessionFixture({
        id: 'session-x',
        serverId,
        encryptionMode: 'plain',
        active: false,
        presence: 1,
        seq: 2,
        latestReadyEventSeq: 2,
        metadata: {
            name: `Session on ${serverId}`,
            host: 'tester.local',
            path: '/Users/leeroy/repo',
            homeDir: '/Users/leeroy',
            machineId: 'machine-1',
        },
        viewer: {
            readState: { state: 'tracking', lastViewedSessionSeq: 1, unreadSince: 2 },
            relevance: { relevant: true, reasons: ['owned_by_me'] },
            follow: { follows: false, notificationLevel: null },
            notification: { level: 'important', source: 'owner' },
            attention: {
                needsAttention: true,
                reasons: ['unread'],
                primary: 'unread',
                presentation: 'full',
            },
        },
    });
}

const storageState = {
    profile: { id: 'me' },
    settings: { workspacePathDisplayModeV1: 'name', workspaceRefsV1: [] },
    sessionMessages: {},
    // Only one Home can own the hydrated entry for a shared session id, so this
    // fixture exercises the hydrated path and the list-renderable path at once.
    get sessions() {
        return { 'session-x': unreadSession('server-a') };
    },
    get sessionListRowsByServerId() {
        return {
            'server-a': { 'session-x': unreadSession('server-a') },
            'server-b': { 'session-x': unreadSession('server-b') },
        };
    },
    ordinarySessionListMembershipByServerId: {
        'server-a': ['session-x'],
        'server-b': ['session-x'],
    },
    sessionListIndexByServerId: {},
    concurrentSessionListCacheByServerId: {},
    isDataReady: true,
    machines: {},
    getProjectForSession: () => null,
};

installNavigationShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Text: 'Text',
            ScrollView: 'ScrollView',
            Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
            ActivityIndicator: 'ActivityIndicator',
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: (title: string) => {
                    alerts.titles.push(title);
                },
            },
        }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        const storage = Object.assign(
            (selector: (value: typeof storageState) => unknown) => selector(storageState),
            { getState: () => storageState },
        );
        return createStorageModuleStub({
            useArtifacts: () => [],
            useFriendRequests: () => [],
            useRequestedFriends: () => [],
            useFeedItems: () => [],
            useFeedLoaded: () => true,
            useFriendsLoaded: () => true,
            useAllSessions: () => [],
            useAllSessionsForAttention: () => [],
            useAllSessionListRenderables: () => [],
            useAllSessionListRenderablesForAttention: () => [],
            useAllSessionListAttentionRows: () => [],
            storage,
            getStorage: () => storage,
        });
    },
});

vi.mock('@/sync/domains/state/storageStore', () => {
    const storage = Object.assign(
        (selector: (value: typeof storageState) => unknown) => selector(storageState),
        { getState: () => storageState },
    );
    return { storage, getStorage: () => storage };
});

vi.mock('@/sync/ops', async (importOriginal) => {
    const { installSyncOpsModuleMock } = await import('@/dev/testkit/mocks/syncOps');
    return installSyncOpsModuleMock({
        sessionSetManualReadStateWithServerScope: (async (
            sessionId: string,
            readState: string,
            options?: { serverId?: string | null },
        ) => {
            markRead.calls.push({ sessionId, readState, serverId: options?.serverId ?? null });
            if (markRead.mode === 'failure') return { success: false, message: 'nope' };
            if (markRead.mode === 'immediate') return { success: true };
            return await new Promise<{ success: boolean }>((resolve) => {
                markRead.deferred.push(resolve);
            });
        }) as never,
    })(importOriginal as <T>() => Promise<T>);
});

vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons', Octicons: 'Octicons' }));
vi.mock('@/track', () => ({ trackFriendsProfileView: vi.fn() }));
vi.mock('@/components/ui/text/Text', () => ({ Text: 'Text' }));
vi.mock('@/components/ui/icons/Icon', () => ({ Icon: 'Icon' }));
vi.mock('@/components/ui/feedback/ActivitySpinner', () => ({
    ActivitySpinner: 'ActivitySpinner',
    iconMatchedSpinnerSize: () => 'small',
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children, title }: any) => React.createElement('ItemGroup', { title }, children),
}));
// Accessory slots must render: the per-row mark-read control lives in
// `rightElement`, and a passthrough would leave it as an inert prop.
vi.mock('@/components/ui/lists/Item', () => ({
    Item: ({ children, leftElement, rightElement, ...props }: any) => React.createElement(
        'Item',
        props,
        leftElement,
        rightElement,
        children,
    ),
}));
vi.mock('@/components/ui/cards/UserCard', () => ({ UserCard: 'UserCard' }));
vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({
    RecoveryKeyReminderBanner: 'RecoveryKeyReminderBanner',
}));
// Rendered, not stubbed away: the mark-all action lives in the header slot and
// this suite is about that action.
vi.mock('@/components/navigation/Header', () => ({
    Header: ({ title, headerLeft, headerRight }: any) => React.createElement(
        'Header',
        null,
        title,
        headerLeft?.(),
        headerRight?.(),
    ),
}));
vi.mock('@/components/inbox/cards/ApprovalInboxCard', () => ({ ApprovalInboxCard: 'ApprovalInboxCard' }));
vi.mock('@/components/inbox/actionOperations/ActionOperationLedger', () => ({
    ActionOperationLedger: 'ActionOperationLedger',
}));
vi.mock('@/hooks/server/useFriendsIdentityReadiness', () => ({
    useFriendsIdentityReadiness: () => ({ isReady: true }),
}));
vi.mock('@/hooks/server/useFriendsEnabled', () => ({ useFriendsEnabled: () => false }));
vi.mock('@/utils/platform/responsive', () => ({ useIsTablet: () => false }));
vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 960 },
    useLayoutMaxWidthStyle: () => ({ maxWidth: 960 }),
    useLayoutMaxWidth: () => 960,
}));

/** Module init for the whole Inbox tree is the cost here, not the assertions. */
const SLOW_RENDER_TIMEOUT_MS = 240_000;

/** Host nodes only: a composite and the host it renders both carry `testID`. */
function nodesByTestId(tree: renderer.ReactTestRenderer, testID: string) {
    return tree.root.findAll((node) => (
        typeof node.type === 'string'
        && (node.props as { testID?: string } | undefined)?.testID === testID
    ));
}

async function press(node: { props: { onPress?: () => void } }): Promise<void> {
    await act(async () => {
        node.props.onPress?.();
    });
}

describe('InboxView mark as read', () => {
    beforeEach(() => {
        markRead.calls = [];
        markRead.deferred = [];
        markRead.mode = 'immediate';
        alerts.titles = [];
    });

    it('acknowledges every ready-for-review Home at its own exact server-scoped address', async () => {
        const { InboxView } = await import('./InboxView');
        const tree = (await renderScreen(<InboxView />)).tree;

        expect(nodesByTestId(tree, 'inbox.ready_session.server-a.session-x')).toHaveLength(1);
        expect(nodesByTestId(tree, 'inbox.ready_session.server-b.session-x')).toHaveLength(1);

        const [markAll] = nodesByTestId(tree, 'inbox.mark_all_read');
        expect(markAll).toBeDefined();
        await press(markAll);

        expect(markRead.calls).toEqual(expect.arrayContaining([
            { sessionId: 'session-x', readState: 'read', serverId: 'server-a' },
            { sessionId: 'session-x', readState: 'read', serverId: 'server-b' },
        ]));
        expect(markRead.calls).toHaveLength(2);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('keeps mark-all truthful and non-duplicating while one row is still settling', async () => {
        markRead.mode = 'deferred';
        const { InboxView } = await import('./InboxView');
        const tree = (await renderScreen(<InboxView />)).tree;

        const [rowAction] = nodesByTestId(tree, 'inbox.ready_session.server-a.session-x.mark_read');
        await press(rowAction);
        expect(markRead.calls).toEqual([
            { sessionId: 'session-x', readState: 'read', serverId: 'server-a' },
        ]);

        // One row in flight is not "the whole Inbox is being cleared": the header
        // action stays available and must only submit what is not already going.
        const [markAll] = nodesByTestId(tree, 'inbox.mark_all_read');
        expect(markAll.findAll((node) => String(node.type) === 'ActivitySpinner')).toHaveLength(0);

        await press(markAll);
        expect(markRead.calls).toHaveLength(2);
        expect(markRead.calls[1]).toEqual({
            sessionId: 'session-x',
            readState: 'read',
            serverId: 'server-b',
        });

        await act(async () => {
            for (const resolve of markRead.deferred) resolve({ success: true });
            markRead.deferred = [];
        });
    }, SLOW_RENDER_TIMEOUT_MS);

    it('reports a failed acknowledgement instead of silently leaving the ready row pending', async () => {
        markRead.mode = 'failure';
        const { InboxView } = await import('./InboxView');
        const tree = (await renderScreen(<InboxView />)).tree;

        const [markAll] = nodesByTestId(tree, 'inbox.mark_all_read');
        await press(markAll);

        expect(alerts.titles).toEqual(['common.error']);
    }, SLOW_RENDER_TIMEOUT_MS);
});
