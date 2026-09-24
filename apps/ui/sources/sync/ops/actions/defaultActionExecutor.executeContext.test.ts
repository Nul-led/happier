import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';

// Imported from their owning testkit modules, never the `@/dev/testkit` barrel:
// the harness installs its network boundaries with `vi.doMock`, which only
// reaches modules imported afterwards (see `installHomeGovernanceBoundaries`).
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import {
    createHomeGovernanceHarness,
    installHomeGovernanceBoundaries,
} from '@/dev/testkit/harness/homeGovernanceHarness';

/**
 * The Account context, its Artifact codec, the approval writer's
 * compare-and-set and the Home family transports all run for real. Only the
 * Home's network (including its stateful Artifact routes) and the device
 * credential store are replaced, by the Home governance harness.
 *
 * The one wrapper below observes — and does not replace — the real context's
 * lifetime: `withDefaultActionExecuteContext` owns releasing every captured
 * context, and a released context has no other observable surface.
 */
const lifetime = vi.hoisted(() => ({ disposed: 0, runPrepared: 0 }));

vi.mock('./actionAccountContext', async (importOriginal) => {
    const original = await importOriginal<typeof import('./actionAccountContext')>();
    return {
        ...original,
        captureActionAccountContext: (async (...args: Parameters<typeof original.captureActionAccountContext>) => {
            const context = await original.captureActionAccountContext(...args);
            return {
                ...context,
                dispose: () => {
                    lifetime.disposed += 1;
                    context.dispose();
                },
                runPrepared: async <T>(run: () => Promise<T>): Promise<T> => {
                    lifetime.runPrepared += 1;
                    return await context.runPrepared(run);
                },
            };
        }) as typeof original.captureActionAccountContext,
    };
});

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

const harness = createHomeGovernanceHarness();
installHomeGovernanceBoundaries(harness);

const ACCOUNT_ID = 'account-a';
// A Home publishes its portable identity in the canonical `srv_` grammar; the
// profile owner rejects any other shape, so no other value can reach an origin.
const SERVER_IDENTITY_ID = 'srv_stable-home-a';

const APPROVAL_REQUIRED_ACTIONS_SETTINGS = {
    actionsSettingsV1: {
        v: 1,
        actions: {
            'review.start': {
                enabledPlacements: [],
                disabledSurfaces: [],
                disabledPlacements: [],
                approvalRequiredSurfaces: ['ui', 'plugin'],
            },
            'identity.providers.secret.replace': {
                enabledPlacements: [],
                disabledSurfaces: [],
                disabledPlacements: [],
                approvalRequiredSurfaces: ['ui'],
            },
            'session.access.context.set': {
                enabledPlacements: [],
                disabledSurfaces: [],
                disabledPlacements: [],
                approvalRequiredSurfaces: ['ui'],
            },
            'session.discussion.archive': {
                enabledPlacements: [],
                disabledSurfaces: [],
                disabledPlacements: [],
                approvalRequiredSurfaces: ['ui'],
            },
        },
    },
} as const;

/**
 * One Home holding `account-a`, whose persisted Account settings require
 * approval for the Actions these cases defer. The settings are served at the
 * Home's real settings route, which the captured Account context reads.
 */
async function addHome(options: Readonly<{ collaboration?: boolean }> = {}): Promise<string> {
    const serverId = await harness.addHome({
        name: 'Home A',
        serverUrl: 'https://home-a.example',
        serverIdentityId: SERVER_IDENTITY_ID,
        accountId: ACCOUNT_ID,
    });
    harness.answer(serverId, '/v2/account/settings', {
        body: { content: { t: 'plain', v: APPROVAL_REQUIRED_ACTIONS_SETTINGS }, version: 1 },
    });
    if (options.collaboration) {
        const { createRootLayoutFeaturesResponse } = await import('@/dev/testkit/fixtures/featureFixtures');
        const features = createRootLayoutFeaturesResponse({
            features: {
                sharing: { session: { enabled: true } },
            } as never,
        });
        harness.answer(serverId, '/v1/features', { body: features });
        harness.answer(serverId, '/v1/features/authenticated', { body: features });
        const { primeServerFeaturesSnapshot } = await import('@/sync/api/capabilities/serverFeaturesClient');
        primeServerFeaturesSnapshot({ serverId, snapshot: { status: 'ready', features } });
    }
    return serverId;
}

/** The approval request exactly as the Home persisted it. */
function storedApproval(serverId: string, artifactId: string): Readonly<{ json: string; request: unknown }> {
    const json = harness.artifacts(serverId).readPlainBody(artifactId);
    if (json === null) throw new Error(`approval_artifact_missing:${artifactId}`);
    return { json, request: JSON.parse(json) };
}

function createdArtifactId(result: unknown): string {
    const artifactId = (result as { result?: { artifactId?: unknown } } | null)?.result?.artifactId;
    if (typeof artifactId !== 'string') throw new Error('approval_artifact_not_created');
    return artifactId;
}

async function loadExecutor() {
    return await import('./defaultActionExecutor');
}

describe('withDefaultActionExecuteContext', () => {
    beforeEach(async () => {
        await harness.reset();
        lifetime.disposed = 0;
        lifetime.runPrepared = 0;
        follow.execute.mockReset();
        follow.prepareSourceKey.mockReset();
        rpc.machine.mockReset();
    });

    afterEach(() => standardCleanup());

    it('replays an approved Home-family mutation from the Inbox through the captured Home scope', async () => {
        const provider = {
            v: 1,
            owner: { kind: 'home' },
            id: 'provider-1',
            kind: 'oidc',
            displayName: 'Corporate OIDC',
            enabled: false,
            firstEnabledAt: null,
            securityRevision: 1,
            revision: 4,
            lastSuccessfulTest: null,
            createdByAccountId: 'account-a',
            createdAt: 1,
            updatedAt: 4,
            config: {
                v: 1,
                kind: 'oidc',
                issuer: 'https://id.example',
                clientId: 'client',
                clientAuthenticationMethod: 'client_secret_post',
                scopes: 'openid',
                httpTimeoutSeconds: 15,
                claims: { login: 'preferred_username', email: 'email', groups: 'groups' },
                allow: { usersAllowlist: [], emailDomains: [], groupsAny: [], groupsAll: [] },
                fetchUserInfo: true,
                storeRefreshToken: false,
                ui: { buttonColor: null, iconHint: null },
            },
            secret: { configured: true, health: 'configured' },
        };
        const serverId = await addHome();
        const replacePath = '/v1/identity/providers/secret/replace';
        harness.answer(serverId, replacePath, { body: provider });
        const input = { owner: { kind: 'home' }, id: 'provider-1', expectedRevision: 3, clientSecret: 'rotated-client-secret' };
        const { createDefaultActionExecutor } = await loadExecutor();
        const { createHomeDomainActionExecutorForScope } = await import('@/sync/api/home/homeDomainActions');
        // The mounted provider editor owns its Home family port.
        const mounted = createDefaultActionExecutor({
            homeDomainAction: createHomeDomainActionExecutorForScope({ serverId, accountId: ACCOUNT_ID }),
        });
        const created = await mounted.execute('identity.providers.secret.replace', input, {
            serverId,
            surface: 'ui',
            authority: 'present_user',
            actionRequestId: 'provider-secret-request-1',
        });
        expect(created).toMatchObject({ ok: true, result: { kind: 'approval_request_created' } });
        const artifactId = createdArtifactId(created);
        expect(harness.requestsFor(replacePath)).toHaveLength(0);

        // Approval Detail / Inbox decides through a generic executor with no mounted port.
        const inbox = createDefaultActionExecutor();
        await expect(inbox.execute(
            'approval.request.decide',
            { artifactId, decision: 'approve' },
            { serverId, surface: 'ui', authority: 'present_user' },
        )).resolves.toMatchObject({ ok: true, result: { status: 'executed' } });

        expect(harness.requestsFor(replacePath)).toHaveLength(1);
        expect(harness.requestsFor(replacePath)[0]).toMatchObject({
            serverId,
            input: { id: 'provider-1', expectedRevision: 3, clientSecret: 'rotated-client-secret' },
        });
        const stored = storedApproval(serverId, artifactId);
        expect(stored.request).toMatchObject({
            status: 'executed',
            actionArgs: { owner: { kind: 'home' }, id: 'provider-1', expectedRevision: 3 },
        });
        expect(stored.json).not.toContain('rotated-client-secret');
    });

    it('replays an approved Session-access mutation from the Inbox through the captured Home scope', async () => {
        const serverId = await addHome({ collaboration: true });
        const contextPath = '/v2/sessions/access-context/set';
        harness.answer(serverId, contextPath, { body: { changed: true, primaryTeamId: 'team-1' } });
        const input = { sessionId: 'session-1', primaryTeamId: 'team-1' };
        const { createDefaultActionExecutor } = await loadExecutor();
        const { executeSessionAccessHttpAction } = await import('@/sync/api/session/sessionAccessApi');
        // The mounted Session access editor owns its family port.
        const mounted = createDefaultActionExecutor({
            sessionAccessAction: async (args) => await executeSessionAccessHttpAction({
                scope: { serverId, accountId: ACCOUNT_ID },
                availability: 'available',
                actionId: args.actionId,
                input: args.input,
            }),
        });
        const created = await mounted.execute('session.access.context.set', input, {
            serverId,
            surface: 'ui',
            authority: 'present_user',
            defaultSessionId: 'session-1',
            actionRequestId: 'session-context-request-1',
        });
        expect(created).toMatchObject({ ok: true, result: { kind: 'approval_request_created' } });
        const artifactId = createdArtifactId(created);
        expect(harness.requestsFor(contextPath)).toHaveLength(0);

        // Approval Detail / Inbox decides through a generic executor with no mounted port.
        const inbox = createDefaultActionExecutor();
        await expect(inbox.execute(
            'approval.request.decide',
            { artifactId, decision: 'approve' },
            { serverId, surface: 'ui', authority: 'present_user' },
        )).resolves.toMatchObject({ ok: true, result: { status: 'executed' } });

        expect(harness.requestsFor(contextPath)).toHaveLength(1);
        expect(harness.requestsFor(contextPath)[0]).toMatchObject({ serverId, input });
        expect(storedApproval(serverId, artifactId).request).toMatchObject({
            status: 'executed',
            execution: { ok: true, result: { changed: true, primaryTeamId: 'team-1' } },
        });
    });

    it('replays an approved Session-discussion mutation from the Inbox through the captured Home scope', async () => {
        const serverId = await addHome({ collaboration: true });
        const { createDefaultActionExecutor } = await loadExecutor();
        const archivedDiscussion = {
            id: 'discussion-a',
            sessionId: 'session-1',
            creationLocalId: 'create-local-a',
            titleContent: { t: 'plain', v: { v: 1, title: 'Release readiness' } },
            latestMessage: {
                id: 'message-a',
                localId: 'message-local-a',
                seq: 1,
                authorAccountId: 'account-a',
                accountActor: { v: 1, accountId: 'account-a', profile: null },
                producerV1: null,
                createdAt: 10,
            },
            messageSeq: 1,
            lastReadSeq: 1,
            unreadCount: 0,
            unreadMentionCount: 0,
            recentAuthorAccountIds: ['account-a'],
            archivedAt: 20,
            capabilities: {
                postMessages: false,
                rename: false,
                archive: false,
                restore: true,
                askAgent: false,
                sendToSession: false,
            },
        };
        // The Session system-record runtime is the Home request authority plus the
        // Session's stored-content context; its HTTP request is the boundary. The
        // captured-scope port, its Account check and the real Discussion adapter
        // run beneath it.
        const discussionHttp: Array<{ path: string; method: string | undefined }> = [];
        const runtimeAddresses: unknown[] = [];
        const { sync } = await import('@/sync/sync');
        const runtime = vi.spyOn(sync, 'withSessionSystemRecordRuntime').mockImplementation((async (
            address: unknown,
            operation: (runtime: unknown) => Promise<unknown>,
        ) => {
            runtimeAddresses.push(address);
            return {
                status: 'ok',
                value: await operation({
                    scope: { serverId, accountId: ACCOUNT_ID },
                    contentContext: { mode: 'plain' },
                    request: async (path: string, init?: RequestInit) => {
                        discussionHttp.push({ path, method: init?.method });
                        return new Response(JSON.stringify({ discussion: archivedDiscussion }), { status: 200 });
                    },
                }),
            };
        }) as unknown as typeof sync.withSessionSystemRecordRuntime);
        try {
            const input = { sessionId: 'session-1', discussionId: 'discussion-a' };
            // The mounted Discussion surface owns its family port; approval defers it.
            const mountedPort = vi.fn();
            const mounted = createDefaultActionExecutor({ sessionDiscussionAction: mountedPort });
            const created = await mounted.execute('session.discussion.archive', input, {
                serverId,
                surface: 'ui',
                authority: 'present_user',
                defaultSessionId: 'session-1',
                actionRequestId: 'discussion-archive-request-1',
            });
            expect(created).toMatchObject({ ok: true, result: { kind: 'approval_request_created' } });
            const artifactId = createdArtifactId(created);
            expect(mountedPort).not.toHaveBeenCalled();
            expect(discussionHttp).toHaveLength(0);

            // Approval Detail / Inbox decides through a generic executor with no mounted port.
            const inbox = createDefaultActionExecutor();
            const decided = await inbox.execute(
                'approval.request.decide',
                { artifactId, decision: 'approve' },
                { serverId, surface: 'ui', authority: 'present_user' },
            );
            expect(decided, storedApproval(serverId, artifactId).json).toMatchObject({ ok: true, result: { status: 'executed' } });

            // The captured scope addresses the Session by the Home's canonical
            // scope id (its published identity), not the device-local profile id.
            const { resolveServerProfileScopeIdForIdentifier } = await import('@/sync/domains/server/serverProfiles');
            expect(runtimeAddresses).toEqual([{
                serverId: resolveServerProfileScopeIdForIdentifier(serverId),
                sessionId: 'session-1',
            }]);
            expect(discussionHttp).toEqual([{
                path: '/v2/sessions/session-1/discussions/discussion-a/archive',
                method: 'POST',
            }]);
            expect(storedApproval(serverId, artifactId).request).toMatchObject({
                status: 'executed',
                execution: {
                    ok: true,
                    result: { sessionId: 'session-1', discussion: { id: 'discussion-a', archivedAt: 20 } },
                },
            });
        } finally {
            runtime.mockRestore();
        }
    });

    it('stamps the captured stable Home identity into a prepared UI approval artifact', async () => {
        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();
        const prepared = await createDefaultActionExecutor().prepare(
            'review.start',
            { sessionId: 'session-1', engineIds: ['codex'], instructions: 'Review this change.' },
            {
                serverId,
                surface: 'ui',
                authority: 'present_user',
                actionRequestId: 'review-request-1',
            },
        );

        expect(prepared).toMatchObject({
            kind: 'settled',
            result: { ok: true, result: { kind: 'approval_request_created' } },
        });
        const artifactId = createdArtifactId(prepared.kind === 'settled' ? prepared.result : null);
        expect(storedApproval(serverId, artifactId).request).toMatchObject({
            v: 2,
            executionOriginV1: {
                serverId,
                serverIdentityId: SERVER_IDENTITY_ID,
                accountId: ACCOUNT_ID,
            },
        });
    });

    it('routes a created trusted-plugin approval to exact-daemon generation validation without local fallback', async () => {
        rpc.machine.mockResolvedValueOnce({
            ok: false,
            errorCode: 'approval_stale',
            error: 'approval_stale',
        });

        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();
        const executor = createDefaultActionExecutor();
        const created = await executor.execute(
            'review.start',
            { sessionId: 'session-1', engineIds: ['codex'], instructions: 'Review this change.' },
            {
                serverId,
                serverIdentityId: 'caller-supplied-identity-is-not-authority',
                surface: 'plugin',
                authority: 'account_automation',
                actionRequestId: 'plugin-review-request-1',
                defaultSessionMachineId: 'machine-1',
                // What the host stamps on a trusted plugin's Action edge: its
                // live occurrence plus the durable source custody an approval
                // freezes as replay provenance. Without custody the approval
                // origin fails closed (`approval_origin_unavailable`).
                actionCaller: {
                    kind: 'plugin',
                    pluginId: 'acme.reviewer',
                    contributionLocalId: 'review',
                    occurrenceId: 'occurrence-1',
                    sourceCustody: { kind: 'managed', immutableGenerationId: 'generation-1', installSource: 'npm' },
                },
            },
        );
        expect(created, JSON.stringify(created)).toMatchObject({ ok: true, result: { kind: 'approval_request_created' } });
        const artifactId = createdArtifactId(created);
        // The durable origin keeps the plugin's source custody, never its
        // process-local occurrence, so replay can revalidate the exact generation.
        expect(storedApproval(serverId, artifactId).request).toMatchObject({
            executionOriginV1: {
                caller: {
                    kind: 'plugin',
                    pluginId: 'acme.reviewer',
                    contributionLocalId: 'review',
                    sourceCustody: { kind: 'managed', immutableGenerationId: 'generation-1', installSource: 'npm' },
                },
                machineId: 'machine-1',
            },
        });

        await expect(executor.execute(
            'approval.request.decide',
            { artifactId, decision: 'approve' },
            { serverId, surface: 'ui', authority: 'present_user' },
        )).resolves.toMatchObject({ ok: false, errorCode: 'approval_stale' });

        expect(rpc.machine).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            serverId,
            machineId: 'machine-1',
            method: RPC_METHODS.APPROVAL_REQUEST_REPLAY_APPROVED,
            payload: { artifactId },
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
        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();

        const result = await createDefaultActionExecutor().execute(
            'session.follow.sources.set',
            {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
            },
            {
                serverId,
                surface: 'ui',
                authority: 'present_user',
                presentUserConfirmation: { actionId: 'session.follow.sources.set' },
            },
        );

        expect(result).toMatchObject({ ok: true });
        expect(follow.prepareSourceKey).toHaveBeenCalledWith({
            serverId,
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
        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();

        await expect(createDefaultActionExecutor().execute(
            'session.follow.sources.set',
            {
                sourceSessionId: 'source-session',
                destinationSessionId: 'destination-session',
            },
            {
                serverId,
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
        const serverId = await addHome();
        const { withDefaultActionExecuteContext } = await loadExecutor();
        let published = false;
        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId },
            async (_executor, account) => {
                account.assertCurrent();
                published = true;
                expect(lifetime.disposed).toBe(0);
                return 'published';
            },
        )).resolves.toBe('published');

        expect(published).toBe(true);
        expect(lifetime.disposed).toBe(1);
    });

    it('rejects an Account-owned projection before admission when its credential Account changed', async () => {
        const serverId = await addHome();
        const { withDefaultActionExecuteContext } = await loadExecutor();
        const work = vi.fn();

        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId, expectedAccountId: 'account-before' },
            work,
        )).rejects.toMatchObject({ code: 'action_account_scope_changed' });

        expect(work).not.toHaveBeenCalled();
        expect(lifetime.disposed).toBe(1);
    });

    it('asserts currentness again after the scoped callback and always disposes', async () => {
        const serverId = await addHome();
        const { withDefaultActionExecuteContext } = await loadExecutor();
        // The caller's cancellation retires the captured Account scope, exactly
        // as it does when the invoking surface goes away mid-callback.
        const caller = new AbortController();
        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId, signal: caller.signal },
            async () => {
                caller.abort();
                return 'stale';
            },
        )).rejects.toMatchObject({ code: 'action_account_scope_changed' });

        expect(lifetime.disposed).toBe(1);
    });

    it('publishes a current failure before the captured Account lifetime is disposed', async () => {
        const serverId = await addHome();
        const { withDefaultActionExecuteContext } = await loadExecutor();
        const onCurrentError = vi.fn((error: unknown) => {
            expect(error).toMatchObject({ message: 'transport_failed' });
            expect(lifetime.disposed).toBe(0);
        });

        await expect(withDefaultActionExecuteContext(
            undefined,
            { serverId, onCurrentError },
            async () => { throw new Error('transport_failed'); },
        )).rejects.toThrow('transport_failed');

        expect(onCurrentError).toHaveBeenCalledOnce();
        expect(lifetime.disposed).toBe(1);
    });

    it('keeps ordinary non-Pool immediate execution on the shared context path', async () => {
        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();
        const openSession = vi.fn();

        await expect(createDefaultActionExecutor({ openSession }).execute(
            'session.open',
            { sessionId: 'session-a' },
            { serverId },
        )).resolves.toMatchObject({ ok: true });

        expect(openSession).toHaveBeenCalledWith('session-a', { serverId });
        expect(lifetime.disposed).toBe(1);
    });

    it('lets a mounted host supply one complete-corpus resolver and carries its exact address to open', async () => {
        const { createDefaultActionExecutor } = await loadExecutor();
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
        const serverId = await addHome();
        const { createDefaultActionExecutor } = await loadExecutor();
        const openSession = vi.fn();
        const prepared = await createDefaultActionExecutor({ openSession }).prepare(
            'session.open',
            { sessionId: 'session-a' },
            { serverId },
        );

        expect(prepared.kind).toBe('ready');
        expect(lifetime.disposed).toBe(1);
        if (prepared.kind !== 'ready') return;

        await prepared.invocation.run();

        expect(lifetime.runPrepared).toBe(1);
        expect(openSession).toHaveBeenCalledWith('session-a', { serverId });
    });
});
