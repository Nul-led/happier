import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import {
    createSessionFixture,
    pressTestInstanceAsync,
    renderScreen,
} from '@/dev/testkit';
import { buildSessionListRenderableFromSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Session } from '@/sync/domains/state/storageTypes';
import { buildActivityOverviewFromSource } from '@/activity/source/buildActivityOverviewFromSource';
import type { ActivityAttentionSource } from '@/activity/source/activityAttentionSourceTypes';
import { buildInboxSessionPresentation } from '@/activity/presentation/buildInboxSessionPresentation';
import { InboxSessionAttentionGroupCard } from './InboxSessionAttentionGroupCard';

const NOW_MS = 1_000_000;
const SESSION_ID = 'global-voice-after-end';
const REQUEST_ID = 'permission-after-end';
const permissionRpc = vi.hoisted(() => vi.fn());
const storageState = vi.hoisted(() => ({
    sessions: {} as Record<string, unknown>,
    sessionListRowsByServerId: {} as Record<string, Record<string, unknown>>,
}));
const routerPush = vi.hoisted(() => vi.fn());

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: 'View',
        Text: 'Text',
        Pressable: 'Pressable',
        TouchableOpacity: 'TouchableOpacity',
        ActivityIndicator: 'ActivityIndicator',
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@expo/vector-icons', async () => {
    const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
    return createExpoVectorIconsMock();
});
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        router: {
            push: routerPush,
        },
    }).module;
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/sync/domains/state/storage', async () => {
    const {
        createStorageModuleStub,
        createUseSettingMock,
    } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useMachine: (machineId: string) => machineId === 'shared-machine'
            ? { id: machineId, metadata: { displayName: 'Home A machine' } }
            : null,
        useServerScopedMachine: (serverId: string | null | undefined, machineId: string) => (
            serverId === 'server-b' && machineId === 'shared-machine'
                ? { id: machineId, metadata: { displayName: 'Home B machine' } }
                : null
        ),
        useSetting: createUseSettingMock({
            values: {
                toolViewDetailLevelDefault: 'title',
            },
        }),
        storage: {
            getState: () => ({
                sessions: storageState.sessions,
                sessionListRowsByServerId: storageState.sessionListRowsByServerId,
                ordinarySessionListMembershipByServerId: {},
                sessionListIndexByServerId: {
                    // Hidden system sessions are intentionally absent from the ordinary list.
                    'server-a': [],
                },
                concurrentSessionListCacheByServerId: {},
                clearSessionOptimisticThinking: vi.fn(),
                clearSessionThinkingGrace: vi.fn(),
                applySessions: vi.fn(),
                updateSessionPermissionMode: vi.fn(),
            }),
        },
    });
});

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (args: unknown) => permissionRpc(args),
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({
        serverId: 'server-a',
        serverUrl: 'https://a.example.test',
        generation: 1,
    }),
}));

function createPendingPostEndSession(): Session {
    return createSessionFixture({
        id: SESSION_ID,
        encryptionMode: 'plain',
        serverId: 'server-a',
        seq: 4,
        lastViewedSessionSeq: 4,
        active: true,
        activeAt: NOW_MS - 100,
        updatedAt: NOW_MS - 10,
        presence: 'online',
        pendingPermissionRequestCount: 1,
        pendingRequestObservedAt: NOW_MS - 10,
        metadata: {
            name: 'Global Voice session',
            path: '/Users/tester/project',
            host: 'tester.local',
            homeDir: '/Users/tester',
            flavor: 'codex',
            systemSessionV1: {
                v: 1,
                key: 'voice_conversation',
                hidden: true,
            },
        },
        agentState: {
            controlledByUser: null,
            requests: {
                [REQUEST_ID]: {
                    tool: 'Bash',
                    kind: 'permission',
                    arguments: { command: 'git status' },
                    createdAt: NOW_MS - 10,
                },
            },
            completedRequests: {},
        },
    });
}

function createActivitySource(session: Session): ActivityAttentionSource {
    return {
        isDataReady: true,
        sessionsById: { [session.id]: session },
        sessionListRowsByServerId: {},
        ordinarySessionListMembershipByServerId: {},
        sessionListIndexByServerId: {
            // Hidden system sessions are intentionally absent from the ordinary list.
            'server-a': [],
        },
        concurrentSessionListCacheByServerId: {},
        serverProfilesById: {
            'server-a': {
                id: 'server-a',
                name: 'Server A',
                serverUrl: 'https://a.example.test',
                createdAt: 1,
                updatedAt: 1,
                lastUsedAt: 1,
                source: 'manual',
            },
        },
        activeServer: {
            serverId: 'server-a',
            serverUrl: 'https://a.example.test',
            generation: 1,
        },
    };
}

describe('global Voice post-End permission custody', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storageState.sessions = {};
        storageState.sessionListRowsByServerId = {};
        permissionRpc.mockResolvedValue(undefined);
        routerPush.mockResolvedValue(undefined);
    });

    it.each([
        {
            decision: 'approve',
            actionTestId: 'permission-footer.allow',
            approved: true,
            rpcDecision: 'approved',
        },
        {
            decision: 'deny',
            actionTestId: 'permission-footer.deny',
            approved: false,
            rpcDecision: 'denied',
        },
    ] as const)(
        'keeps the post-End hidden-session permission actionable for $decision',
        async ({ actionTestId, approved, rpcDecision }) => {
            const session = createPendingPostEndSession();
            storageState.sessions = { [session.id]: session };
            storageState.sessionListRowsByServerId = {
                'server-a': { [session.id]: buildSessionListRenderableFromSession(session) },
            };
            const activity = buildActivityOverviewFromSource({
                source: createActivitySource(session),
                nowMs: NOW_MS,
                directActionsEnabled: true,
            });
            const inbox = buildInboxSessionPresentation({ overview: activity });

            expect(activity.candidates).toEqual([
                expect.objectContaining({
                    sessionId: SESSION_ID,
                    route: `/session/${SESSION_ID}?serverId=server-a`,
                }),
            ]);
            expect(inbox.sessionsNeedingAttention).toHaveLength(1);

            const attention = inbox.sessionsNeedingAttention[0]!;
            const screen = await renderScreen(
                <InboxSessionAttentionGroupCard
                    identityDisplay="none"
                    connected={false}
                    session={attention.candidate.session}
                    serverId={attention.candidate.address?.serverId ?? null}
                    permissionRequests={attention.pendingPermissions}
                    userActionRequests={attention.pendingUserActions}
                />,
            );

            await pressTestInstanceAsync(
                screen.find((node) => node.props.accessibilityLabel === 'inbox.openSession'),
                'post-End hidden Voice session open action',
            );

            expect(routerPush).toHaveBeenCalledTimes(1);
            expect(routerPush).toHaveBeenCalledWith(
                `/session/${SESSION_ID}?serverId=server-a`,
            );

            await screen.pressByTestIdAsync(actionTestId);

            expect(screen.findByTestId('permission-footer.action-error')).toBeNull();
            expect(permissionRpc).toHaveBeenCalledTimes(1);
            expect(permissionRpc).toHaveBeenCalledWith({
                sessionId: SESSION_ID,
                serverId: 'server-a',
                method: RPC_METHODS.SESSION_PERMISSION_RESPOND,
                payload: {
                    id: REQUEST_ID,
                    approved,
                    decision: rpcDecision,
                },
            });
            expect(routerPush).toHaveBeenCalledTimes(1);
        },
    );

    it('sends a secondary Home approval with its qualified scope when the active Home has the same session id', async () => {
        const activeSession = createPendingPostEndSession();
        const secondarySession = { ...activeSession, serverId: 'server-b' };
        storageState.sessions = { [activeSession.id]: activeSession };
        storageState.sessionListRowsByServerId = {
            'server-a': { [activeSession.id]: buildSessionListRenderableFromSession(activeSession) },
            'server-b': { [secondarySession.id]: buildSessionListRenderableFromSession(secondarySession) },
        };
        const activity = buildActivityOverviewFromSource({
            source: createActivitySource(secondarySession),
            nowMs: NOW_MS,
            directActionsEnabled: true,
        });
        const inbox = buildInboxSessionPresentation({ overview: activity });
        const attention = inbox.sessionsNeedingAttention[0]!;
        const screen = await renderScreen(
            <InboxSessionAttentionGroupCard
                identityDisplay="none"
                connected={false}
                session={attention.candidate.session}
                serverId="server-b"
                permissionRequests={attention.pendingPermissions}
                userActionRequests={attention.pendingUserActions}
            />,
        );

        await screen.pressByTestIdAsync('permission-footer.allow');

        expect(permissionRpc).toHaveBeenCalledWith(expect.objectContaining({
            sessionId: SESSION_ID,
            serverId: 'server-b',
            method: RPC_METHODS.SESSION_PERMISSION_RESPOND,
            payload: { id: REQUEST_ID, approved: true, decision: 'approved' },
        }));
    });

    it('uses the qualified Home when resolving Inbox machine context', async () => {
        const session = createSessionFixture({
            id: 'same-session',
            encryptionMode: 'plain',
            serverId: 'server-b',
            metadata: {
                name: 'Secondary Home session',
                host: 'home-b-host',
                path: '/Users/tester/project',
                homeDir: '/Users/tester',
                machineId: 'shared-machine',
            },
        });

        const screen = await renderScreen(
            <InboxSessionAttentionGroupCard
                identityDisplay="none"
                connected={false}
                session={session}
                serverId="server-b"
                contextLine="Home B"
                permissionRequests={[]}
                userActionRequests={[]}
            />,
        );

        expect(screen.getTextContent()).toContain('Home B machine');
        expect(screen.getTextContent()).not.toContain('Home A machine');
    });

    it('does not invent raw path context when Activity supplies no resolved context line', async () => {
        const session = createSessionFixture({
            id: 'session-without-context',
            encryptionMode: 'plain',
            serverId: 'server-b',
            metadata: {
                name: 'Secondary Home session',
                path: '/Users/tester/private-project',
                homeDir: '/Users/tester',
                machineId: 'shared-machine',
            },
        });

        const screen = await renderScreen(
            <InboxSessionAttentionGroupCard
                identityDisplay="none"
                connected={false}
                session={session}
                serverId="server-b"
                contextLine={null}
                permissionRequests={[]}
                userActionRequests={[]}
            />,
        );

        expect(screen.getTextContent()).not.toContain('private-project');
        expect(screen.getTextContent()).not.toContain('/Users/tester/private-project');
    });
});
