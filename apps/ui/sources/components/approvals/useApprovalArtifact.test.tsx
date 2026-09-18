import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createDeferred, renderHook, standardCleanup } from '@/dev/testkit';

const boundary = vi.hoisted(() => ({
    artifact: null as any,
    resolution: { kind: 'bound', scope: { serverId: 'ui-home-b', accountId: 'account-1' } } as any,
    fetchArtifact: vi.fn(),
    captureContext: vi.fn(),
    profileGeneration: 0,
    portableProfileId: 'ui-home-b' as string | null,
    profileListeners: new Set<(generation: number) => void>(),
}));

vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('@/sync/domains/state/storage', () => ({
    storage: { getState: () => ({ updateArtifact: vi.fn() }) },
    useArtifact: () => boundary.artifact,
}));
vi.mock('@/sync/store/hooks', () => ({
    useActiveServerAccountScope: () => ({ serverId: 'ui-home-b', accountId: 'account-1' }),
}));
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeResolution: () => boundary.resolution,
}));
vi.mock('@/sync/domains/scope/serverAccountScope', () => ({
    areServerAccountScopesEqual: (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right),
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    resolveServerProfileForPortableIdentity: (serverIdentityId: string) => serverIdentityId === 'stable-home-b' && boundary.portableProfileId
        ? {
            kind: 'resolved',
            serverIdentityId,
            profile: { id: boundary.portableProfileId, serverIdentityId },
        }
        : { kind: 'missing', serverIdentityId },
    listServerProfiles: () => [
        { id: 'legacy-local-home' },
        ...(boundary.portableProfileId ? [{ id: boundary.portableProfileId, serverIdentityId: 'stable-home-b' }] : []),
        { id: 'identified-local-home', serverIdentityId: 'stable-home-b' },
    ],
    getServerProfilesGeneration: () => boundary.profileGeneration,
    subscribeServerProfiles: (listener: (generation: number) => void) => {
        boundary.profileListeners.add(listener);
        return () => boundary.profileListeners.delete(listener);
    },
}));
vi.mock('@/sync/ops/actions/actionAccountContext', () => ({
    captureActionAccountContext: (...args: unknown[]) => boundary.captureContext(...args),
}));
vi.mock('@/sync/sync', () => ({ sync: { fetchArtifactWithBody: vi.fn() } }));

function v2Artifact(headerServerIdentityId: string | undefined, bodyServerIdentityId = 'stable-home-b') {
    return {
        id: 'approval-1',
        header: {
            v: 1,
            kind: 'approval_request.v1',
            title: 'Set session title',
            approvalStatus: 'open',
            actionId: 'session.title.set',
            serverId: 'creator-local-home',
            ...(headerServerIdentityId ? { serverIdentityId: headerServerIdentityId } : {}),
        },
        body: JSON.stringify({
            v: 2,
            status: 'open',
            createdAtMs: 1,
            updatedAtMs: 1,
            createdBy: { surface: 'system' },
            requestedSurface: 'api',
            executionOriginV1: {
                v: 1,
                authority: 'account_automation',
                surface: 'api',
                caller: { kind: 'host' },
                serverId: 'creator-local-home',
                serverIdentityId: bodyServerIdentityId,
                accountId: 'account-1',
                principalId: 'principal-1',
                credentialId: 'credential-1',
                actionId: 'session.title.set',
                requestId: 'request-1',
            },
            actionId: 'session.title.set',
            actionArgs: { sessionId: 'session-1', title: 'Updated title' },
            summary: 'Set session title',
        }),
        updatedAt: 1,
    };
}

function executedV2Artifact() {
    const artifact = v2Artifact('stable-home-b');
    const request = JSON.parse(artifact.body);
    return {
        ...artifact,
        header: { ...artifact.header, approvalStatus: 'executed' },
        body: JSON.stringify({
            ...request,
            status: 'executed',
            updatedAtMs: 2,
            decision: { kind: 'approve', decidedAtMs: 2 },
            execution: {
                executedAtMs: 2,
                ok: true,
                result: { sessionId: 'session-1', title: 'Updated title' },
            },
        }),
        updatedAt: 2,
    };
}

/** A deferred approval admitted for the present user on one exact Home: no portable identity. */
function presentUserV2Artifact() {
    return {
        id: 'approval-1',
        header: {
            v: 1,
            kind: 'approval_request.v1',
            title: 'Delete machine pool',
            approvalStatus: 'open',
            actionId: 'machines.pools.delete',
            serverId: 'ui-home-b',
        },
        body: JSON.stringify({
            v: 2,
            status: 'open',
            createdAtMs: 1,
            updatedAtMs: 1,
            createdBy: { surface: 'system' },
            requestedSurface: 'ui',
            executionOriginV1: {
                v: 1,
                authority: 'present_user',
                surface: 'ui',
                caller: { kind: 'host' },
                serverId: 'ui-home-b',
                accountId: 'account-1',
                actionId: 'machines.pools.delete',
                requestId: 'machines.pools.delete:pool-1:3',
            },
            actionId: 'machines.pools.delete',
            actionArgs: { poolId: 'pool-1', expectedRevision: 3 },
            summary: 'Delete machine pool',
        }),
        updatedAt: 1,
    };
}

function v1Artifact() {
    return {
        id: 'approval-v1',
        header: {
            v: 1,
            kind: 'approval_request.v1',
            title: 'Set session title',
            approvalStatus: 'open',
            actionId: 'session.title.set',
            serverId: 'legacy-local-home',
        },
        body: JSON.stringify({
            v: 1,
            status: 'open',
            createdAtMs: 1,
            updatedAtMs: 1,
            createdBy: { surface: 'system' },
            actionId: 'session.title.set',
            actionArgs: { sessionId: 'session-1', title: 'Updated title' },
            summary: 'Set session title',
            serverId: 'legacy-local-home',
        }),
        updatedAt: 1,
    };
}

async function publishPortableProfile(profileId: string): Promise<void> {
    await act(async () => {
        boundary.portableProfileId = profileId;
        boundary.profileGeneration += 1;
        for (const listener of boundary.profileListeners) listener(boundary.profileGeneration);
    });
}

afterEach(() => {
    boundary.artifact = null;
    boundary.fetchArtifact.mockReset();
    boundary.captureContext.mockReset();
    boundary.profileGeneration = 0;
    boundary.portableProfileId = 'ui-home-b';
    boundary.resolution = { kind: 'bound', scope: { serverId: 'ui-home-b', accountId: 'account-1' } };
    standardCleanup();
});

describe('useApprovalArtifact', () => {
    it('starts the exact scoped fetch when a mounted portable Home identity becomes resolvable', async () => {
        boundary.portableProfileId = null;
        const artifact = v2Artifact('stable-home-b');
        boundary.fetchArtifact.mockResolvedValue(artifact);
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });

        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));

        expect(hook.getCurrent().error).toBe(true);
        expect(hook.getCurrent().homeUnavailable).toBe(true);
        expect(boundary.captureContext).not.toHaveBeenCalled();

        boundary.resolution = { kind: 'bound', scope: { serverId: 'ui-home-late', accountId: 'account-1' } };
        await publishPortableProfile('ui-home-late');

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(artifact));
        expect(hook.getCurrent().homeUnavailable).toBe(false);
        expect(boundary.captureContext).toHaveBeenCalledWith('ui-home-late', expect.any(AbortSignal));
    });

    it('aborts the old scoped fetch and restarts when the portable Home resolves to a new local profile', async () => {
        const firstFetch = createDeferred<ReturnType<typeof v2Artifact> | null>();
        const artifact = v2Artifact('stable-home-b');
        boundary.captureContext.mockImplementation(async (serverId: string) => ({
            accountId: 'account-1',
            fetchArtifact: serverId === 'ui-home-b'
                ? () => firstFetch.promise
                : async () => artifact,
            dispose: vi.fn(),
        }));

        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));
        await vi.waitFor(() => expect(boundary.captureContext).toHaveBeenCalledTimes(1));
        const firstSignal = boundary.captureContext.mock.calls[0]?.[1] as AbortSignal;

        boundary.resolution = { kind: 'bound', scope: { serverId: 'ui-home-next', accountId: 'account-1' } };
        await publishPortableProfile('ui-home-next');

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(artifact));
        expect(firstSignal.aborted).toBe(true);
        expect(boundary.captureContext).toHaveBeenNthCalledWith(2, 'ui-home-next', expect.any(AbortSignal));
        firstFetch.resolve(null);
    });

    it('resolves a V2 portable Home to this device local profile before its first body fetch', async () => {
        const artifact = v2Artifact('stable-home-b');
        boundary.fetchArtifact.mockResolvedValue(artifact);
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });

        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(artifact));
        expect(boundary.captureContext).toHaveBeenCalledWith('ui-home-b', expect.any(AbortSignal));
    });

    it('refetches a terminal body when a newer socket projection is header-only', async () => {
        const open = v2Artifact('stable-home-b');
        const executed = executedV2Artifact();
        boundary.fetchArtifact
            .mockResolvedValueOnce(open)
            .mockResolvedValueOnce(executed);
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });

        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));
        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(open));

        boundary.artifact = { ...executed, body: null };
        await hook.rerender();

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(executed));
        expect(boundary.fetchArtifact).toHaveBeenCalledTimes(2);
    });

    it('keeps the V1 local Home reader as a safe fallback', async () => {
        const artifact = v1Artifact();
        boundary.fetchArtifact.mockResolvedValue(artifact);
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-v1', serverId: 'legacy-local-home' }));

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(artifact));
        expect(hook.getCurrent().error).toBe(false);
    });

    it('accepts an already-local V2 artifact when its header and body identify the same Home', async () => {
        boundary.artifact = v2Artifact('stable-home-b');
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: null }));

        expect(hook.getCurrent().artifact).toEqual(boundary.artifact);
        expect(boundary.captureContext).not.toHaveBeenCalled();
    });

    it('keeps a local-only V2 present-user approval readable when neither projection claims a portable Home', async () => {
        const artifact = v2Artifact(undefined);
        const request = JSON.parse(artifact.body);
        delete request.executionOriginV1.serverIdentityId;
        boundary.artifact = { ...artifact, body: JSON.stringify(request) };
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: null }));

        expect(hook.getCurrent().artifact).toEqual(boundary.artifact);
    });

    it('keeps an exact-Home present-user approval readable when its origin declares no portable identity', async () => {
        // A Settings form (for example Machine pools) opens its own deferred approval on one exact
        // Home. Only a Home-signed external invocation records a portable identity, so requiring
        // one here would make every locally admitted V2 approval unreadable on its own Home.
        const artifact = presentUserV2Artifact();
        boundary.fetchArtifact.mockResolvedValue(artifact);
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'ui-home-b' }));

        await vi.waitFor(() => expect(hook.getCurrent().artifact).toEqual(artifact));
        expect(hook.getCurrent().error).toBe(false);
        expect(boundary.captureContext).toHaveBeenCalledWith('ui-home-b', expect.any(AbortSignal));
    });

    it('fails closed when an exact-Home read returns an approval bound to another portable Home', async () => {
        boundary.fetchArtifact.mockResolvedValue(v2Artifact('stable-other-home', 'stable-other-home'));
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'identified-local-home' }));

        await vi.waitFor(() => expect(hook.getCurrent().error).toBe(true));
        expect(hook.getCurrent().artifact).toBeNull();
        expect(hook.getCurrent().invalidArtifact).toBe(true);
    });

    it('fails closed when a V2 header is missing or disagrees with the immutable body identity', async () => {
        boundary.fetchArtifact.mockResolvedValueOnce(v2Artifact(undefined));
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));

        await vi.waitFor(() => expect(hook.getCurrent().error).toBe(true));
        expect(hook.getCurrent().artifact).toBeNull();
        expect(hook.getCurrent().invalidArtifact).toBe(true);
    });

    it('fails closed when the V2 header names a different Home than its body', async () => {
        boundary.fetchArtifact.mockResolvedValueOnce(v2Artifact('stable-other-home'));
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'stable-home-b' }));

        await vi.waitFor(() => expect(hook.getCurrent().error).toBe(true));
        expect(hook.getCurrent().artifact).toBeNull();
    });

    it('does not reinterpret an unknown device-local route as V2 Home identity', async () => {
        boundary.fetchArtifact.mockResolvedValueOnce(v2Artifact('stable-home-b'));
        boundary.captureContext.mockResolvedValue({
            accountId: 'account-1',
            fetchArtifact: boundary.fetchArtifact,
            dispose: vi.fn(),
        });
        const { useApprovalArtifact } = await import('./useApprovalArtifact');
        const hook = await renderHook(() => useApprovalArtifact({ artifactId: 'approval-1', serverId: 'unknown-local-home' }));

        await vi.waitFor(() => expect(hook.getCurrent().error).toBe(true));
        expect(hook.getCurrent().artifact).toBeNull();
    });
});
