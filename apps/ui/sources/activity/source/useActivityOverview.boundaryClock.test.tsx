import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture, renderScreen } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from '@/components/navigation/shell/navigationShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** The pre-viewer freshness budget that retires an idle pending request. */
const STALE_SIGNAL_MS = 120_000;
const NOW_MS = 1_700_000_000_000;

const fixture = vi.hoisted(() => ({
    kind: 'idle_user_action' as
        | 'idle_user_action'
        | 'message_user_action'
        | 'completed_message_user_action'
        | 'permission'
        | 'working_user_action',
}));

/**
 * A pre-viewer Home row: no `viewer` projection, so attention is derived locally
 * from runtime freshness and can retire with nothing but the clock.
 */
function legacySession() {
    const requestCreatedAt = NOW_MS - 1_000;
    const userActionRequest = {
        tool: 'AskUserQuestion',
        kind: 'user_action',
        arguments: {
            questions: [{ question: 'Continue?', header: 'Confirm', options: [{ label: 'Yes', description: 'Proceed' }] }],
        },
        createdAt: requestCreatedAt,
    };
    const permissionRequest = {
        tool: 'Bash',
        kind: 'permission',
        arguments: { command: 'pwd' },
        createdAt: requestCreatedAt,
    };
    return createSessionFixture({
        id: 'legacy-session',
        serverId: 'server-a',
        encryptionMode: 'plain',
        active: true,
        presence: 'online',
        createdAt: requestCreatedAt,
        updatedAt: requestCreatedAt,
        activeAt: requestCreatedAt,
        // Only a projected in-progress turn keeps `working` true across the
        // budget; it is cleared by turn settlement, never by elapsed time.
        latestTurnStatus: fixture.kind === 'working_user_action' ? 'in_progress' : undefined,
        latestTurnStatusObservedAt: fixture.kind === 'working_user_action' ? requestCreatedAt : undefined,
        metadata: {
            name: 'Legacy Home session',
            path: '/Users/leeroy/repo',
            homeDir: '/Users/leeroy',
            machineId: 'machine-1',
        },
        agentState: {
            controlledByUser: null,
            requests: fixture.kind === 'permission'
                ? { perm_1: permissionRequest }
                : fixture.kind === 'message_user_action'
                    ? {}
                    : { ask_1: userActionRequest },
            completedRequests: {},
        },
    } as any);
}

function messageBackedUserAction() {
    const createdAt = NOW_MS - 1_000;
    const completed = fixture.kind === 'completed_message_user_action';
    return {
        id: 'message-ask-1',
        localId: null,
        kind: 'tool-call',
        createdAt,
        tool: {
            id: 'ask_1',
            name: 'AskUserQuestion',
            state: completed ? 'completed' : 'running',
            input: {
                questions: [{ question: 'Continue?', header: 'Confirm', options: [{ label: 'Yes', description: 'Proceed' }] }],
            },
            createdAt,
            startedAt: createdAt,
            completedAt: completed ? createdAt + 1 : null,
            description: null,
            permission: {
                id: 'ask_1',
                kind: 'user_action',
                status: completed ? 'approved' : 'pending',
            },
        },
        children: [],
    } as any;
}

const storageState = {
    profile: { id: 'me' },
    get sessionMessages() {
        return fixture.kind === 'message_user_action' || fixture.kind === 'completed_message_user_action'
            ? { 'legacy-session': { messages: [messageBackedUserAction()] } }
            : {};
    },
    get sessions() {
        return { 'legacy-session': legacySession() };
    },
    get sessionListRowsByServerId() {
        return { 'server-a': { 'legacy-session': legacySession() } };
    },
    ordinarySessionListMembershipByServerId: { 'server-a': ['legacy-session'] },
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
vi.mock('@/components/navigation/Header', () => ({ Header: 'Header' }));
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

const SLOW_RENDER_TIMEOUT_MS = 240_000;

async function crossTheFreshnessBoundary(): Promise<void> {
    await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_SIGNAL_MS + 1_000);
    });
}

async function renderNavigationDot(
    which: 'inbox' | 'sessions' = 'inbox',
): Promise<{ read: () => boolean | null }> {
    const inboxModule = which === 'inbox'
        ? await import('@/hooks/inbox/useInboxModel')
        : null;
    const useDot = inboxModule
        ? (await import('@/hooks/inbox/useInboxHasContent')).useInboxHasContent
        : (await import('@/hooks/session/useSessionsHaveAttention')).useSessionsHaveAttention;
    let latest: boolean | null = null;
    function Probe() {
        latest = useDot();
        return React.createElement('View');
    }
    await renderScreen(inboxModule
        ? React.createElement(inboxModule.InboxModelProvider, null, React.createElement(Probe))
        : React.createElement(Probe));
    return { read: () => latest };
}

function attentionRowCount(tree: renderer.ReactTestRenderer): number {
    return tree.root.findAll((node) => (
        typeof node.type === 'string'
        && String((node.props as { testID?: string } | undefined)?.testID ?? '').startsWith('inbox.session_attention.')
    )).length;
}

describe('mounted Activity overview boundary clock', () => {
    beforeEach(() => {
        fixture.kind = 'idle_user_action';
        vi.useFakeTimers();
        vi.setSystemTime(NOW_MS);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('retires an idle pre-viewer action request from the navigation dot when its budget elapses', async () => {
        const dot = await renderNavigationDot();
        expect(dot.read()).toBe(true);

        await crossTheFreshnessBoundary();

        expect(dot.read()).toBe(false);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('retires the same request from the Inbox row without any store change', async () => {
        const { InboxView } = await import('@/components/navigation/shell/InboxView');
        const tree = (await renderScreen(<InboxView />)).tree;
        expect(attentionRowCount(tree)).toBe(1);

        await crossTheFreshnessBoundary();

        expect(attentionRowCount(tree)).toBe(0);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('keeps an unresolved pre-viewer permission request, which is deliberately not time-gated', async () => {
        fixture.kind = 'permission';
        const dot = await renderNavigationDot();
        expect(dot.read()).toBe(true);

        await crossTheFreshnessBoundary();

        expect(dot.read()).toBe(true);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('keeps an action request while the turn is still projected in progress', async () => {
        fixture.kind = 'working_user_action';
        const dot = await renderNavigationDot();
        expect(dot.read()).toBe(true);

        await crossTheFreshnessBoundary();

        expect(dot.read()).toBe(true);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('uses the same message-backed pending request for the overview and its exact clock boundary', async () => {
        fixture.kind = 'message_user_action';
        const dot = await renderNavigationDot();
        expect(dot.read()).toBe(true);

        // The message was observed one second before NOW, so its canonical
        // 120-second freshness window ends after exactly 119 seconds.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(STALE_SIGNAL_MS - 1_000);
        });

        expect(dot.read()).toBe(false);
        // Advancing at the exact boundary must settle, not keep scheduling
        // zero-delay retries against the already-retired candidate.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(dot.read()).toBe(false);
    }, SLOW_RENDER_TIMEOUT_MS);

    it('lets a completed transcript request defeat a stale pending agent-state copy before scheduling', async () => {
        fixture.kind = 'completed_message_user_action';
        const dot = await renderNavigationDot();

        expect(dot.read()).toBe(false);
        await crossTheFreshnessBoundary();
        expect(dot.read()).toBe(false);
    }, SLOW_RENDER_TIMEOUT_MS);
});
