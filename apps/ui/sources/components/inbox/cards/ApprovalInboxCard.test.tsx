import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createMachineFixture, createSessionFixture, renderScreen } from '@/dev/testkit';
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';
import type { Machine, Session } from '@/sync/domains/state/storageTypes';
import type { ServerAccountScope } from '@/sync/domains/scope/serverAccountScope';
import type { WorkspaceRefV1 } from '@/sync/domains/workspaces/workspaceRefModel';
import { installApprovalCommonModuleMocks } from '../../approvals/approvalsTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function createApprovalArtifact(): Extract<DecryptedArtifact, { isDecrypted: true }> {
    return {
        id: 'artifact-1',
        title: 'Approval',
        headerVersion: 1,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        isDecrypted: true,
        header: {
            title: 'Approve answering the user',
            actionId: 'session.user_action.answer',
            sessionId: 'session-1',
        },
    };
}

const sessionFixtures: Record<string, Session> = {
    'session-1': createSessionFixture({
        id: 'session-1',
        metadata: {
            name: 'Repo session',
            path: '/Users/leeroy/stale-repo',
            host: 'tester.local',
            homeDir: '/Users/leeroy',
            machineId: 'machine-stale',
        },
    }),
};

const scopedSessionFixtures: Record<string, Session> = {
    'server-b:session-1': createSessionFixture({
        id: 'session-1',
        serverId: 'server-b',
        metadata: {
            name: 'Secondary Home session',
            path: '/Users/secondary/repo',
            host: 'secondary.local',
            homeDir: '/Users/secondary',
            machineId: 'machine-secondary',
        },
    }),
};

const machineFixtures: Record<string, Machine> = {
    'machine-target': createMachineFixture({
        id: 'machine-target',
        metadata: {
            displayName: 'Rebound workstation',
            host: 'workstation.local',
            platform: 'darwin',
            happyCliVersion: '0.0.0-test',
            happyHomeDir: '/Users/leeroy/.happy-dev',
            homeDir: '/Users/leeroy',
        },
    }),
};

const scopedMachineFixtures: Record<string, Machine> = {
    'server-b:machine-secondary': createMachineFixture({
        id: 'machine-secondary',
        metadata: {
            displayName: 'Secondary workstation',
            host: 'secondary.local',
            platform: 'darwin',
            happyCliVersion: '0.0.0-test',
            happyHomeDir: '/Users/secondary/.happy-dev',
            homeDir: '/Users/secondary',
        },
    }),
};

const storageState = {
    sessions: {
        'session-1': sessionFixtures['session-1'],
    },
    machines: {
        'machine-target': machineFixtures['machine-target'],
    },
    getProjectForSession: (sessionId: string) =>
        sessionId === 'session-1'
            ? {
                key: {
                    machineId: 'machine-target',
                    rootPath: '/Volumes/target/repo',
                },
            }
            : null,
};

installApprovalCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Text: 'Text',
            Pressable: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
                React.createElement('Pressable', props, children),
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    status: { error: '#f00' },
                    text: '#fff',
                    textSecondary: '#999',
                    divider: '#333',
                    surfaceHighest: '#222',
                    surfacePressedOverlay: '#333',
                },
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({
            translate: (key: string) => key,
        });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSession: (sessionId: string) => sessionFixtures[sessionId] ?? null,
            useMachine: (machineId: string) => machineFixtures[machineId] ?? null,
            useSessionListRenderableWithServerScope: (serverId: string | null | undefined, sessionId: string) => (
                scopedSessionFixtures[`${serverId ?? ''}:${sessionId}`] ?? null
            ),
            useServerScopedMachine: (serverId: string | null | undefined, machineId: string) => (
                scopedMachineFixtures[`${serverId ?? ''}:${machineId}`] ?? null
            ),
            storage: {
                getState: () => storageState,
            },
        });
    },
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: ({ title, subtitle, ...props }: { title: React.ReactNode; subtitle?: React.ReactNode; onPress?: () => void }) => React.createElement(
        'View',
        { ...props, accessibilityRole: props.onPress ? 'button' : undefined },
        React.createElement('Text', null, title),
        subtitle ? React.createElement('Text', null, subtitle) : null,
    ),
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>()),
    areServerProfileIdentifiersEquivalent: (left: string, right: string) => left === right,
    getServerProfileById: (serverId: string) => serverId === 'server-b'
        ? { id: 'server-b', name: 'Home B', serverUrl: 'https://home-b.example.test' }
        : null,
}));

describe('ApprovalInboxCard', () => {
    it('shows the qualified plugin action without interpreting it as a built-in action', async () => {
        const { ApprovalInboxCard } = await import('./ApprovalInboxCard');
        const artifact = {
            ...createApprovalArtifact(),
            header: {
                title: 'Publish release notes',
                kind: 'target_action_approval.v1',
                qualifiedActionId: 'acme.publisher/actions/releases/publish',
            },
        } satisfies DecryptedArtifact;
        const screen = await renderScreen(
            <ApprovalInboxCard artifact={artifact} onPress={() => {}} workspaceRefs={[]} />,
        );
        expect(screen.getTextContent()).toContain('acme.publisher/actions/releases/publish');
        expect(screen.findByTestId(`inbox.approval.${artifact.id}`)?.props).toMatchObject({
            accessibilityRole: 'button',
            accessibilityLabel: 'Publish release notes · acme.publisher/actions/releases/publish',
        });
    });

    it('shows the canonical workspace basename when the stored session machine id is stale', async () => {
        const { ApprovalInboxCard } = await import('./ApprovalInboxCard');
        const screen = await renderScreen(
            <ApprovalInboxCard
                artifact={createApprovalArtifact()}
                onPress={() => {}}
                workspaceRefs={[]}
            />,
        );

        expect(screen.getTextContent()).toContain('Rebound workstation');
        expect(screen.getTextContent()).toContain('repo');
        expect(screen.getTextContent()).not.toContain('/Volumes/target/repo');
    });

    it('uses the approval Home when another Home has the same Session id', async () => {
        const { ApprovalInboxCard } = await import('./ApprovalInboxCard');
        const artifact = {
            ...createApprovalArtifact(),
            header: {
                ...createApprovalArtifact().header,
                serverId: 'server-b',
            },
        } satisfies DecryptedArtifact;

        const audienceScope: ServerAccountScope = { serverId: 'server-b', accountId: 'account-b' };
        const workspaceRefs: readonly WorkspaceRefV1[] = [{
            id: 'workspace-ref-secondary',
            serverId: 'server-b',
            machineId: 'machine-secondary',
            rootPath: '/Users/secondary/repo',
            label: 'Secondary checkout',
            createdAtMs: 1,
            lastOpenedAtMs: null,
        }, {
            id: 'workspace-ref-collision',
            serverId: 'server-a',
            machineId: 'machine-secondary',
            rootPath: '/Users/secondary/repo',
            label: 'Wrong Home checkout',
            createdAtMs: 1,
            lastOpenedAtMs: null,
        }];
        const screen = await renderScreen(
            <ApprovalInboxCard
                artifact={artifact}
                onPress={() => {}}
                audienceScope={audienceScope}
                workspaceRefs={workspaceRefs}
            />,
        );

        expect(screen.getTextContent()).toContain('Secondary Home session');
        expect(screen.getTextContent()).toContain('Secondary workstation');
        expect(screen.getTextContent()).toContain('Secondary checkout');
        expect(screen.getTextContent()).not.toContain('Wrong Home checkout');
        expect(screen.getTextContent()).not.toContain('Repo session');
        expect(screen.getTextContent()).not.toContain('/Users/secondary/repo');
    });

    it('does not synthesize Home-wide freshness in approval context', async () => {
        const { ApprovalInboxCard } = await import('./ApprovalInboxCard');
        const screen = await renderScreen(
            <ApprovalInboxCard
                artifact={{
                    ...createApprovalArtifact(),
                    header: { ...createApprovalArtifact().header, serverId: 'server-b' },
                } satisfies DecryptedArtifact}
                onPress={() => {}}
                workspaceRefs={[]}
                nowMs={1_081_000}
            />,
        );

        expect(screen.getTextContent()).not.toContain('Offline');
        expect(screen.getTextContent()).not.toContain('Last updated');
    });

    it('keeps safe structural context for a locked qualified Session without exposing cached private metadata', async () => {
        const previous = scopedSessionFixtures['server-b:session-1'];
        scopedSessionFixtures['server-b:session-1'] = createSessionFixture({
            id: 'session-1',
            serverId: 'server-b',
            encryptionMode: 'e2ee',
            encryptedContentAvailability: 'encrypted_access_pending',
            metadata: {
                name: 'Private cached Inbox title',
                path: '/Users/private/inbox-secret',
                homeDir: '/Users/private',
                machineId: 'machine-secondary',
            },
        });
        try {
            const { ApprovalInboxCard } = await import('./ApprovalInboxCard');
            const screen = await renderScreen(
                <ApprovalInboxCard
                    artifact={{
                        ...createApprovalArtifact(),
                        header: { ...createApprovalArtifact().header, serverId: 'server-b' },
                    } satisfies DecryptedArtifact}
                    onPress={() => {}}
                    audienceScope={{ serverId: 'server-b', accountId: 'account-b' }}
                    workspaceRefs={[]}
                />,
            );

            expect(screen.getTextContent()).not.toContain('Private cached Inbox title');
            expect(screen.getTextContent()).not.toContain('inbox-secret');
            expect(screen.getTextContent()).toContain('Home B');
            expect(screen.getTextContent()).toContain('Secondary workstation');
        } finally {
            scopedSessionFixtures['server-b:session-1'] = previous;
        }
    });
});
