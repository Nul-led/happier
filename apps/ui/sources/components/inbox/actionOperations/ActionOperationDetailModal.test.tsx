import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { actionOperationStore } from '@/sync/domains/actionOperations/actionOperationStore';

const routerPush = vi.hoisted(() => vi.fn());
const storageFixtures = vi.hoisted(() => ({
    session: null as Record<string, unknown> | null,
    machine: null as Record<string, unknown> | null,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});
vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        useServerScopedMachine: (serverId: string | null, machineId: string) => (
            serverId === 'home-a' && machineId === 'machine-1' ? storageFixtures.machine : null
        ),
        useSessionListRenderableWithServerScope: (serverId: string | null, sessionId: string) => (
            serverId === 'home-a' && sessionId === 'session-1' ? storageFixtures.session : null
        ),
    });
});
vi.mock('@/hooks/teams/useSessionAudienceContext', () => ({
    useSessionAudienceContext: () => ({ scopes: new Map(), labelsVersion: '[]', labelsBySessionKey: new Map() }),
}));
vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({ useServerProfilesGeneration: () => 1 }));
vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    getServerProfileById: (serverId: string) => ({ id: serverId, name: serverId === 'home-a' ? 'Home A' : 'Home B' }),
}));
vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { push: routerPush } }).module;
});

afterEach(() => {
    routerPush.mockReset();
    storageFixtures.session = null;
    storageFixtures.machine = null;
    actionOperationStore.reset();
});

describe('ActionOperationDetailModal', () => {
    it('shows the preferred source session title when the full session is not loaded', async () => {
        storageFixtures.session = {
            id: 'session-1',
            encryptionMode: 'plain',
            path: '/workspace/dev',
            metadata: {
                path: '/workspace/dev',
                summary: { text: 'Stabilize CI and Nightly Releases', updatedAt: 123 },
            },
        };
        actionOperationStore.mergeSnapshots({ serverId: 'home-a', snapshots: [{
            version: 1,
            operationId: 'fork-operation',
            revision: 2,
            actionId: 'session.fork',
            state: 'succeeded',
            scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
            title: 'Fork session',
            createdAt: 1_000,
            settledAt: 2_000,
            cancellation: 'unsupported',
        }] });

        const { ActionOperationDetailModal } = await import('./ActionOperationDetailModal');
        const screen = await renderScreen(
            <ActionOperationDetailModal
                serverId="home-a"
                operationId="fork-operation"
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(screen.getTextContent()).toContain('Stabilize CI and Nightly Releases');
        expect(screen.getTextContent()).not.toContain('session-1');
    });

    it('renders the successful handoff cleanup warning and semantic phase', async () => {
        actionOperationStore.mergeSnapshots({ serverId: 'home-a', snapshots: [{
            version: 1,
            operationId: 'handoff-operation',
            revision: 3,
            actionId: 'session.handoff',
            state: 'succeeded',
            scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
            title: 'Hand off session',
            createdAt: 1_000,
            startedAt: 1_100,
            settledAt: 2_000,
            progress: { kind: 'phase', phase: 'cleaning_source', label: 'Cleaning up source' },
            result: {
                handoffId: 'handoff-1',
                status: 'completed',
                warning: { code: 'source_cleanup_failed', message: 'cleanup_failed' },
            },
            domainRef: { kind: 'handoff', id: 'handoff-1' },
            cancellation: 'unsupported',
        }] });

        const { ActionOperationDetailModal } = await import('./ActionOperationDetailModal');
        const screen = await renderScreen(
            <ActionOperationDetailModal
                serverId="home-a"
                operationId="handoff-operation"
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(screen.findByTestId('action-operation-warning')).not.toBeNull();
        expect(screen.findByTestId('action-operation-field.phase')).not.toBeNull();
        expect(screen.findByTestId('action-operation-cancel')).toBeNull();
    });

    it('renders the standard validated plugin result and error summaries', async () => {
        actionOperationStore.mergeSnapshots({ serverId: 'home-a', snapshots: [{
            version: 1,
            operationId: 'plugin-operation',
            revision: 2,
            actionId: 'acme.preview/deploy',
            state: 'succeeded',
            scope: { accountId: 'account-1', machineId: 'machine-1' },
            title: 'Deploy preview',
            createdAt: 1_000,
            startedAt: 1_100,
            settledAt: 2_000,
            result: { published: true, url: 'https://preview.example' },
            cancellation: 'unsupported',
        }] });

        const { ActionOperationDetailModal } = await import('./ActionOperationDetailModal');
        const screen = await renderScreen(
            <ActionOperationDetailModal
                serverId="home-a"
                operationId="plugin-operation"
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(screen.findByTestId('action-operation-result.published')).not.toBeNull();
        expect(screen.findByTestId('action-operation-result.url')).not.toBeNull();
    });

    it('opens the spawned session only through the explicit completion action', async () => {
        actionOperationStore.mergeSnapshots({ serverId: 'home-a', snapshots: [{
            version: 1,
            operationId: 'spawn-operation',
            revision: 2,
            actionId: 'session.spawn_new',
            state: 'succeeded',
            scope: { accountId: 'account-1', machineId: 'machine-1' },
            title: 'Create session',
            createdAt: 1_000,
            startedAt: 1_100,
            settledAt: 2_000,
            result: { type: 'success', disposition: 'created', sessionId: 'spawned-session' },
            domainRef: { kind: 'spawnAttempt', id: 'spawn-attempt-1' },
            cancellation: 'unsupported',
        }] });
        const onClose = vi.fn();

        const { ActionOperationDetailModal } = await import('./ActionOperationDetailModal');
        const screen = await renderScreen(
            <ActionOperationDetailModal
                serverId="home-a"
                operationId="spawn-operation"
                onClose={onClose}
                setChrome={vi.fn()}
            />,
        );

        expect(routerPush).not.toHaveBeenCalled();
        await pressTestInstanceAsync(screen.findByTestId('action-operation-open-session'));
        expect(routerPush).toHaveBeenCalledWith('/session/spawned-session?serverId=home-a');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not adopt active-Home context or navigation for an unqualified legacy operation', async () => {
        storageFixtures.session = {
            id: 'session-1',
            encryptionMode: 'plain',
            metadata: { summary: { text: 'Wrong active-Home session', updatedAt: 123 } },
        };
        actionOperationStore.mergeSnapshots({
            serverId: null,
            snapshots: [{
                version: 1,
                operationId: 'legacy-fork',
                revision: 2,
                actionId: 'session.fork',
                state: 'succeeded',
                scope: { accountId: 'account-1', machineId: 'machine-1', sessionId: 'session-1' },
                title: 'Fork session',
                createdAt: 1_000,
                startedAt: 1_100,
                settledAt: 2_000,
                result: { childSessionId: 'child-session' },
                cancellation: 'unsupported',
            }],
        });

        const { ActionOperationDetailModal } = await import('./ActionOperationDetailModal');
        const screen = await renderScreen(
            <ActionOperationDetailModal
                serverId={null}
                operationId="legacy-fork"
                onClose={vi.fn()}
                setChrome={vi.fn()}
            />,
        );

        expect(screen.getTextContent()).not.toContain('Wrong active-Home session');
        expect(screen.getTextContent()).not.toContain('session-1');
        expect(screen.findByTestId('action-operation-open-session')).toBeNull();
    });
});
