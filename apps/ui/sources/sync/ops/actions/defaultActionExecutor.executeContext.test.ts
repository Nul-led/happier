import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

import { createDefaultActionExecutor, withDefaultActionExecuteContext } from './defaultActionExecutor';

const lifecycle = vi.hoisted(() => ({
    current: true,
    disposed: false,
    published: false,
    runPreparedCalls: 0,
    createdArtifactBody: null as string | null,
    createdArtifactHeader: null as unknown,
}));

const follow = vi.hoisted(() => ({
    execute: vi.fn(),
    prepareSourceKey: vi.fn(),
}));

const rpc = vi.hoisted(() => ({
    machine: vi.fn(),
}));

vi.mock('@/sync/api/session/sessionFollowApi', () => ({
    sessionFollowAction: follow.execute,
}));

vi.mock('@/components/sessions/follow/prepareSessionFollowSourceKey', () => ({
    prepareSessionFollowSourceKey: follow.prepareSourceKey,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: rpc.machine,
}));

vi.mock('@/sync/domains/server/serverProfiles', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
    resolveServerProfileForPortableIdentity: (serverIdentityId: string) => serverIdentityId === 'stable-home-a'
        ? {
            kind: 'resolved' as const,
            serverIdentityId,
            profile: { id: 'home-a', serverIdentityId },
        }
        : { kind: 'missing' as const, serverIdentityId },
}));

vi.mock('./actionAccountContext', () => ({
    captureActionAccountContext: vi.fn(async () => ({
        serverId: 'home-a',
        serverIdentityId: 'stable-home-a',
        accountId: 'account-a',
        credentials: { token: 'unused' },
        accountMode: 'plain' as const,
        request: vi.fn(),
        assertCurrent: () => {
            if (!lifecycle.current) {
                throw Object.assign(new Error('action_account_scope_changed'), {
                    code: 'action_account_scope_changed',
                });
            }
        },
        dispose: () => { lifecycle.disposed = true; },
        readSettings: async () => ({
            actionsSettingsV1: {
                v: 1,
                actions: {
                    'review.start': {
                        enabledPlacements: [],
                        disabledSurfaces: [],
                        disabledPlacements: [],
                        approvalRequiredSurfaces: ['ui', 'plugin'],
                    },
                },
            },
        }),
        readLiveSettings: () => null,
        runPrepared: async <T>(run: () => Promise<T>) => {
            lifecycle.runPreparedCalls += 1;
            return await run();
        },
        fetchArtifact: vi.fn(async (artifactId: string) => lifecycle.createdArtifactBody
            ? {
                id: artifactId,
                header: lifecycle.createdArtifactHeader,
                body: lifecycle.createdArtifactBody,
            }
            : null),
        createArtifact: vi.fn(async (header: unknown, body: string) => {
            lifecycle.createdArtifactHeader = header;
            lifecycle.createdArtifactBody = body;
            return 'approval-artifact-1';
        }),
        updateArtifact: vi.fn(async (_artifactId: string, header: unknown, body: string) => {
            lifecycle.createdArtifactHeader = header;
            lifecycle.createdArtifactBody = body;
        }),
    })),
}));

describe('withDefaultActionExecuteContext', () => {
    beforeEach(() => {
        lifecycle.current = true;
        lifecycle.disposed = false;
        lifecycle.published = false;
        lifecycle.runPreparedCalls = 0;
        lifecycle.createdArtifactBody = null;
        lifecycle.createdArtifactHeader = null;
        follow.execute.mockReset();
        follow.prepareSourceKey.mockReset();
        rpc.machine.mockReset();
    });

    it('stamps the captured stable Home identity into a prepared UI approval artifact', async () => {
        const prepared = await createDefaultActionExecutor().prepare(
            'review.start',
            { sessionId: 'session-1', engineIds: ['codex'], instructions: 'Review this change.' },
            {
                serverId: 'home-a',
                surface: 'ui',
                authority: 'present_user',
                actionRequestId: 'review-request-1',
            },
        );

        expect(prepared).toMatchObject({
            kind: 'settled',
            result: {
                ok: true,
                result: { kind: 'approval_request_created', artifactId: 'approval-artifact-1' },
            },
        });
        expect(JSON.parse(lifecycle.createdArtifactBody ?? 'null')).toMatchObject({
            v: 2,
            executionOriginV1: {
                serverId: 'home-a',
                serverIdentityId: 'stable-home-a',
                accountId: 'account-a',
            },
        });
    });

    it('routes a created trusted-plugin approval to exact-daemon generation validation without local fallback', async () => {
        rpc.machine.mockResolvedValueOnce({
            ok: false,
            errorCode: 'approval_stale',
            error: 'approval_stale',
        });

        const executor = createDefaultActionExecutor();
        await expect(executor.execute(
            'review.start',
            { sessionId: 'session-1', engineIds: ['codex'], instructions: 'Review this change.' },
            {
                serverId: 'home-a',
                serverIdentityId: 'caller-supplied-identity-is-not-authority',
                surface: 'plugin',
                authority: 'account_automation',
                actionRequestId: 'plugin-review-request-1',
                defaultSessionMachineId: 'machine-1',
                actionCaller: {
                    kind: 'plugin',
                    pluginId: 'acme.reviewer',
                    contributionLocalId: 'review',
                    immutableGenerationId: 'generation-1',
                },
            },
        )).resolves.toMatchObject({
            ok: true,
            result: { kind: 'approval_request_created', artifactId: 'approval-artifact-1' },
        });

        await expect(executor.execute(
            'approval.request.decide',
            { artifactId: 'approval-artifact-1', decision: 'approve' },
            { serverId: 'home-a', surface: 'ui', authority: 'present_user' },
        )).resolves.toMatchObject({ ok: false, errorCode: 'approval_stale' });

        expect(rpc.machine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            serverId: 'home-a',
            machineId: 'machine-1',
            method: RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED,
            payload: { artifactId: 'approval-artifact-1' },
        }));
    });

    it('prepares an E2EE Runner source key after the shared UI Action commits an edge', async () => {
        follow.execute.mockResolvedValue({
            changed: true,
            source: {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
                deliveryState: 'eligible',
                hasPendingUpdates: true,
            },
        });
        follow.prepareSourceKey.mockResolvedValue({ kind: 'prepared' });

        const result = await createDefaultActionExecutor().execute(
            'session.follow.sources.set',
            {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
            },
            {
                serverId: 'home-a',
                surface: 'ui',
                authority: 'present_user',
                presentUserConfirmation: { actionId: 'session.follow.sources.set' },
            },
        );

        expect(result).toMatchObject({ ok: true });
        expect(follow.prepareSourceKey).toHaveBeenCalledWith({
            serverId: 'home-a',
            sourceSessionId: 'source-session',
            destinationSessionId: 'destination-session',
        });
    });

    it('reports a committed edge as waiting when scoped Runner key preparation is unavailable', async () => {
        follow.execute.mockResolvedValue({
            changed: true,
            source: {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
                deliveryState: 'eligible',
                hasPendingUpdates: false,
            },
        });
        follow.prepareSourceKey.mockResolvedValue({
            kind: 'waiting',
            reason: 'runner_key_unavailable',
        });

        await expect(createDefaultActionExecutor().execute(
            'session.follow.sources.set',
            {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
            },
            {
                serverId: 'home-a',
                surface: 'ui',
                authority: 'present_user',
                presentUserConfirmation: { actionId: 'session.follow.sources.set' },
            },
        )).resolves.toMatchObject({
            ok: false,
            errorCode: 'session_follow_source_key_preparation_waiting',
            details: {
                status: 'waiting',
                reason: 'runner_key_unavailable',
                edgeCommitted: true,
                source: {
                    sourceSessionId: 'source-session',
                    destinationSessionId: 'destination-session',
                },
            },
        });
    });

    it('keeps the captured Action Account context alive through synchronous result publication', async () => {
        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId: 'home-a' },
            async (_executor, account) => {
                account.assertCurrent();
                lifecycle.published = true;
                expect(lifecycle.disposed).toBe(false);
                return 'published';
            },
        )).resolves.toBe('published');

        expect(lifecycle.published).toBe(true);
        expect(lifecycle.disposed).toBe(true);
    });

    it('rejects an Account-owned projection before admission when its credential Account changed', async () => {
        const work = vi.fn();

        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId: 'home-a', expectedAccountId: 'account-before' },
            work,
        )).rejects.toMatchObject({ code: 'action_account_scope_changed' });

        expect(work).not.toHaveBeenCalled();
        expect(lifecycle.disposed).toBe(true);
    });

    it('asserts currentness again after the scoped callback and always disposes', async () => {
        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId: 'home-a' },
            async () => {
                lifecycle.current = false;
                return 'stale';
            },
        )).rejects.toMatchObject({ code: 'action_account_scope_changed' });

        expect(lifecycle.disposed).toBe(true);
    });

    it('publishes a current failure before the captured Account lifetime is disposed', async () => {
        const onCurrentError = vi.fn((error: unknown) => {
            expect(error).toMatchObject({ message: 'transport_failed' });
            expect(lifecycle.disposed).toBe(false);
        });

        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId: 'home-a', onCurrentError },
            async () => { throw new Error('transport_failed'); },
        )).rejects.toThrow('transport_failed');

        expect(onCurrentError).toHaveBeenCalledOnce();
        expect(lifecycle.disposed).toBe(true);
    });

    it('keeps ordinary non-Pool immediate execution on the shared context path', async () => {
        const openSession = vi.fn();

        await expect(createDefaultActionExecutor({ openSession }).execute(
            'session.open',
            { sessionId: 'session-a' },
            { serverId: 'home-a' },
        )).resolves.toMatchObject({ ok: true });

        expect(openSession).toHaveBeenCalledWith('session-a', { serverId: 'home-a' });
        expect(lifecycle.disposed).toBe(true);
    });

    it('lets a mounted host supply one complete-corpus resolver and carries its exact address to open', async () => {
        const openSession = vi.fn();
        const resolveSessionReference = vi.fn(async () => ({
            kind: 'unique' as const,
            address: { serverId: 'home-b', sessionId: 'session-b' },
        }));

        await expect(createDefaultActionExecutor({ openSession, resolveSessionReference }).execute(
            'session.open',
            { sessionTitle: 'Release prep' },
            { surface: 'voice' },
        )).resolves.toMatchObject({ ok: true });

        expect(resolveSessionReference).toHaveBeenCalledOnce();
        expect(openSession).toHaveBeenCalledWith('session-b', { serverId: 'home-b' });
    });

    it('retains deferred prepare/runPrepared custody outside the immediate callback lifetime', async () => {
        const openSession = vi.fn();
        const prepared = await createDefaultActionExecutor({ openSession }).prepare(
            'session.open',
            { sessionId: 'session-a' },
            { serverId: 'home-a' },
        );

        expect(prepared.kind).toBe('ready');
        expect(lifecycle.disposed).toBe(true);
        if (prepared.kind !== 'ready') return;

        await prepared.invocation.run();

        expect(lifecycle.runPreparedCalls).toBe(1);
        expect(openSession).toHaveBeenCalledWith('session-a', { serverId: 'home-a' });
    });
});
