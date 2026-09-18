import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequestV1, ApprovalRequestV2 } from '@happier-dev/protocol';

import { collectRenderedTestIds } from '@/dev/testkit/render/collectRenderedTestIds';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import type { DecryptedArtifact } from '@/sync/domains/artifacts/artifactTypes';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const executeSpy = vi.fn(async () => ({ ok: true as const, result: {} }));
const replayApprovalRequestAtExactDaemonSpy = vi.fn(async (): Promise<unknown> => ({ ok: true, result: {} }));
const createDefaultActionExecutorSpy = vi.fn((_opts?: unknown) => ({ execute: executeSpy }));
const sessionAllowSpy = vi.fn(async (..._args: unknown[]) => {});
const sessionDenySpy = vi.fn(async (..._args: unknown[]) => {});
const routerPushSpy = vi.fn();
let portableProfileResolution: any = {
    kind: 'resolved',
    serverIdentityId: 'stable-home-a',
    profile: { id: 'ui-A', serverIdentityId: 'stable-home-a' },
};

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        View: (props: any) => React.createElement('View', props, props.children),
        Pressable: (props: any) => React.createElement('Pressable', props, props.children),
        ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props, null),
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: any) => React.createElement('Ionicons', props, null),
}));

vi.mock('expo-router', () => ({
    useRouter: () => ({ push: routerPushSpy }),
}));

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: (props: any) => React.createElement('Text', props, props.children),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock().module;
});

vi.mock('@/sync/ops/actions/defaultActionExecutor', () => ({
    createDefaultActionExecutor: (opts?: unknown) => createDefaultActionExecutorSpy(opts),
    requiresExactDaemonApprovalReplay: (approval: ApprovalRequestV2 | ApprovalRequestV1) => approval.v === 2
        && approval.executionOriginV1.surface !== 'ui',
    resolveApprovalReplayRoute: (approval: ApprovalRequestV2 | ApprovalRequestV1) => approval.v === 2
        && portableProfileResolution.kind === 'resolved'
        && portableProfileResolution.profile.serverIdentityId === approval.executionOriginV1.serverIdentityId
        ? {
            serverId: portableProfileResolution.profile.id,
            serverIdentityId: approval.executionOriginV1.serverIdentityId,
            originServerId: approval.executionOriginV1.serverId,
        }
        : null,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
    resolvePreferredServerIdForSessionId: () => 'server-from-session',
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    resolveServerProfileForPortableIdentity: () => portableProfileResolution,
}));

vi.mock('@/hooks/server/useServerProfilesGeneration', () => ({
    useServerProfilesGeneration: () => 1,
}));

vi.mock('@/sync/ops', () => ({
    sessionAllow: (...args: unknown[]) => sessionAllowSpy(...args),
    sessionDeny: (...args: unknown[]) => sessionDenySpy(...args),
}));

function approvalRequest(): ApprovalRequestV1 {
    return {
        v: 1,
        status: 'open',
        createdAtMs: 1,
        updatedAtMs: 1,
        createdBy: { surface: 'agent' as const, sessionId: 'session-1' },
        requestedSurface: 'agent',
        actionId: 'session.list',
        actionArgs: {},
        summary: 'List sessions before continuing',
        preview: { summary: 'Agent wants to inspect active sessions' },
    };
}

function invitationApprovalRequest(preview?: ApprovalRequestV2['preview']): ApprovalRequestV2 {
    const request = daemonApprovalRequest();
    return {
        ...request,
        actionId: 'teams.invitations.accept',
        actionArgs: { v: 1, token: 'a'.repeat(43) },
        summary: 'Accept invitation',
        executionOriginV1: {
            ...request.executionOriginV1,
            actionId: 'teams.invitations.accept',
        },
        ...(preview === undefined ? {} : { preview }),
    };
}

function daemonApprovalRequest(): ApprovalRequestV2 {
    return {
        v: 2,
        status: 'open',
        createdAtMs: 1,
        updatedAtMs: 1,
        createdBy: { surface: 'system', sessionId: 'session-1' },
        requestedSurface: 'api',
        executionOriginV1: {
            v: 1,
            authority: 'account_automation',
            surface: 'api',
            caller: { kind: 'host' },
            serverId: 'local-A',
            serverIdentityId: 'stable-home-a',
            accountId: 'account-1',
            principalId: 'principal-1',
            credentialId: 'credential-1',
            sessionId: 'session-1',
            machineId: 'machine-exact',
            target: { kind: 'session', sessionId: 'session-1' },
            actionId: 'session.title.set',
            requestId: 'request-1',
        },
        actionId: 'session.title.set',
        actionArgs: { sessionId: 'session-1', title: 'Current title' },
        summary: 'Set session title',
    };
}

function unplacedApiApprovalRequest(): ApprovalRequestV2 {
    const approval = daemonApprovalRequest();
    const { machineId: _machineId, ...executionOriginV1 } = approval.executionOriginV1;
    return { ...approval, executionOriginV1 };
}

function localUiApprovalRequest(): ApprovalRequestV2 {
    const approval = daemonApprovalRequest();
    return {
        ...approval,
        requestedSurface: 'ui',
        executionOriginV1: {
            v: 1,
            authority: 'present_user',
            surface: 'ui',
            caller: { kind: 'host' },
            serverId: 'local-A',
            sessionId: 'session-1',
            target: { kind: 'session', sessionId: 'session-1' },
            actionId: 'session.title.set',
            requestId: 'request-ui-1',
        },
    };
}

function approvalArtifact(serverId?: string): Pick<DecryptedArtifact, 'id' | 'header'> {
    return {
        id: 'approval-1',
        header: {
            title: null,
            ...(serverId ? { serverId } : {}),
        },
    };
}

describe('ApprovalPromptCard', () => {
    beforeEach(() => {
        portableProfileResolution = {
            kind: 'resolved',
            serverIdentityId: 'stable-home-a',
            profile: { id: 'ui-A', serverIdentityId: 'stable-home-a' },
        };
    });
    it('renders the action approval summary in inline chrome', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');

        const screen = await renderScreen(
            <ApprovalPromptCard
                chrome="inline"
                artifact={approvalArtifact('server-1')}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        expect(screen.findByTestId('approval-prompt-card')).toBeTruthy();
        expect(screen.getTextContent()).toContain('List sessions before continuing');
        expect(screen.getTextContent()).toContain('Agent wants to inspect active sessions');
    });

    it('withholds approve for a released V1 request while preserving rejection', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        expect(screen.findByTestId('approval-prompt-approve')?.props).toMatchObject({
            disabled: true,
            accessibilityHint: 'approvals.approveUnavailableHint',
        });
        expect(screen.findByTestId('approval-prompt-reject')?.props.disabled).toBe(false);

        await screen.pressByTestIdAsync('approval-prompt-approve');
        expect(executeSpy).not.toHaveBeenCalled();

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-reject');
        });
        expect(executeSpy).toHaveBeenCalledWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'reject' },
            expect.objectContaining({ surface: 'ui', serverId: 'server-1' }),
        );
    });

    it('renders canonical invitation context without revealing its bearer', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        const bearer = 'a'.repeat(43);
        const approval = invitationApprovalRequest({
            actionId: 'teams.invitations.accept',
            actionArgs: {
                homeServerId: 'srv-home-acme',
                continuation: { teamId: 'team-acme' },
                teamName: 'Acme Platform',
                role: 'member',
                historyAccess: 'from_membership',
                state: 'active',
                expiresAt: 1234,
                recipientEmailMask: 'a•••@example.com',
            },
        });

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={approval}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        expect(screen.getTextContent()).toContain('Acme Platform');
        expect(screen.getTextContent()).toContain('a•••@example.com');
        expect(screen.getTextContent()).not.toContain(bearer);
        expect(screen.findByTestId('approval-prompt-approve')?.props.disabled).toBe(false);
    });

    it('withholds approval when required invitation context is unavailable while preserving rejection', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={invitationApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        expect(screen.findByTestId('approvals.unrepresentable-details')).not.toBeNull();
        expect(screen.getTextContent()).toContain('approvals.unsafeDetailsTitle');
        expect(screen.getTextContent()).not.toContain('a'.repeat(43));
        expect(screen.findByTestId('approval-prompt-approve')?.props.disabled).toBe(true);
        expect(screen.findByTestId('approval-prompt-reject')?.props.disabled).toBe(false);

        await screen.pressByTestIdAsync('approval-prompt-approve');
        expect(executeSpy).not.toHaveBeenCalled();

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-reject');
        });
        expect(executeSpy).toHaveBeenCalledWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'reject' },
            expect.objectContaining({ surface: 'ui', serverId: 'ui-A' }),
        );
    });

    it('opens the originating transcript tool when a location is available', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        routerPushSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
                location={{ kind: 'top', messageId: 'tool:tool-1', seq: 10 }}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-view-tool');
        });

        expect(routerPushSpy).toHaveBeenCalledWith('/session/session-1?jumpSeq=10');
    });

    it('places the primary approve action before the reject action', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        const testIdOrder = collectRenderedTestIds(screen.tree.toJSON());

        expect(testIdOrder.indexOf('approval-prompt-approve')).toBeGreaterThanOrEqual(0);
        expect(testIdOrder.indexOf('approval-prompt-reject')).toBeGreaterThanOrEqual(0);
        expect(testIdOrder.indexOf('approval-prompt-approve')).toBeLessThan(
            testIdOrder.indexOf('approval-prompt-reject'),
        );
    });

    it('approves through approval.request.decide using the default action executor', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        createDefaultActionExecutorSpy.mockClear();
        sessionAllowSpy.mockClear();
        sessionDenySpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-1')}
                approval={localUiApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(createDefaultActionExecutorSpy).toHaveBeenCalled();
        expect(executeSpy).toHaveBeenCalledWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'approve' },
            expect.objectContaining({ surface: 'ui', serverId: 'server-1' }),
        );
        expect(sessionAllowSpy).not.toHaveBeenCalled();
        expect(sessionDenySpy).not.toHaveBeenCalled();
    });

    it('rejects through approval.request.decide using the default action executor', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        sessionAllowSpy.mockClear();
        sessionDenySpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact()}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-reject');
        });

        expect(executeSpy).toHaveBeenCalledWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'reject' },
            expect.objectContaining({ surface: 'ui', serverId: 'server-from-session' }),
        );
        expect(sessionAllowSpy).not.toHaveBeenCalled();
        expect(sessionDenySpy).not.toHaveBeenCalled();
    });

    it('routes a V2 durable approval through this device profile for the same stable Home', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-header')}
                approval={daemonApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(executeSpy).toHaveBeenCalledExactlyOnceWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'approve' },
            { surface: 'ui', serverId: 'ui-A' },
        );
    });

    it('does not locally replay a V2 approval when the exact daemon records approval_stale', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();
        executeSpy.mockResolvedValueOnce({
            ok: true,
            result: { ok: true, status: 'failed', execution: { ok: false, errorCode: 'approval_stale' } },
        });

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-header')}
                approval={daemonApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(executeSpy).toHaveBeenCalledExactlyOnceWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'approve' },
            { surface: 'ui', serverId: 'ui-A' },
        );
    });

    it('fails closed instead of locally replaying an API approval whose daemon placement is missing', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-header')}
                approval={unplacedApiApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(replayApprovalRequestAtExactDaemonSpy).not.toHaveBeenCalled();
        expect(executeSpy).not.toHaveBeenCalled();
    });

    it('fails closed when this device resolves the immutable Home identity to a different identity', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();
        portableProfileResolution = {
            kind: 'resolved',
            serverIdentityId: 'stable-home-a',
            profile: { id: 'ui-wrong', serverIdentityId: 'stable-home-b' },
        };

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('ui-wrong')}
                approval={daemonApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(replayApprovalRequestAtExactDaemonSpy).not.toHaveBeenCalled();
        expect(executeSpy).not.toHaveBeenCalled();
        expect(screen.findByTestId('approval-prompt-approve')?.props.disabled).toBe(true);
        expect(screen.findByTestId('approval-prompt-reject')?.props.disabled).toBe(true);
        expect(screen.getTextContent()).toContain('actionConfirmations.homeUnavailable');
    });

    it('retains exact-route execution for a V2 approval stamped by the UI/Home owner', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('server-header')}
                approval={localUiApprovalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );

        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-approve');
        });

        expect(replayApprovalRequestAtExactDaemonSpy).not.toHaveBeenCalled();
        expect(executeSpy).toHaveBeenCalledExactlyOnceWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'approve' },
            { surface: 'ui', serverId: 'server-header' },
        );
    });

    it('keeps V1 on its explicitly scoped route without attempting cross-device replay', async () => {
        const { ApprovalPromptCard } = await import('./ApprovalPromptCard');
        executeSpy.mockClear();
        replayApprovalRequestAtExactDaemonSpy.mockClear();

        const screen = await renderScreen(
            <ApprovalPromptCard
                artifact={approvalArtifact('v1-route')}
                approval={approvalRequest()}
                sessionId="session-1"
                canApprove={true}
            />,
        );
        await act(async () => {
            await screen.pressByTestIdAsync('approval-prompt-reject');
        });

        expect(executeSpy).toHaveBeenCalledWith(
            'approval.request.decide',
            { artifactId: 'approval-1', decision: 'reject' },
            { surface: 'ui', serverId: 'v1-route' },
        );
        expect(replayApprovalRequestAtExactDaemonSpy).not.toHaveBeenCalled();
    });
});
