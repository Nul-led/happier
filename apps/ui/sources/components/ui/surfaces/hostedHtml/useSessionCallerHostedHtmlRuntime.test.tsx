import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const platformState = vi.hoisted(() => ({ current: 'web' }));
const currentnessState = vi.hoisted(() => ({ account: true, session: true }));
const frameAvailability = vi.hoisted(() => ({ current: true }));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        Platform: {
            get OS() { return platformState.current; },
            select: <T,>(values: Readonly<{ web?: T; ios?: T; android?: T; default?: T }>) => (
                values[platformState.current as 'web' | 'ios' | 'android'] ?? values.default
            ),
        },
    });
});

// Like the real owner (a memoized projection of stable scope entries), one Home's
// binding keeps its identity across renders; currentness is read through it.
const bindingsByServerId = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/sync/domains/scope/useServerCredentialAccountScopes', () => ({
    useServerCredentialAccountScopeBindings: (serverIds: readonly string[]) => new Map(serverIds.map((serverId) => {
        if (!bindingsByServerId.has(serverId)) {
            bindingsByServerId.set(serverId, {
                serverId,
                accountId: `account:${serverId}`,
                scope: { serverId, accountId: `account:${serverId}` },
                revision: 1,
                isCurrent: () => currentnessState.account,
                onRetire: () => ({ dispose() {} }),
            });
        }
        return [serverId, bindingsByServerId.get(serverId)];
    })),
}));

vi.mock('@/components/sessions/shell/sessionViewStableSession', () => ({
    useSessionViewShellSession: (sessionId: string, serverId: string) => ({ id: sessionId, serverId }),
}));

vi.mock('@/sync/engine/sessions/normalizeSessionAccessProjection', () => ({
    normalizeSessionAccessProjection: () => ({ capabilities: { readTranscript: currentnessState.session } }),
}));

vi.mock('@/sync/ops/actions/frontDoorRuntimeActionExecutor', () => ({
    createFrontDoorActionExecute: () => vi.fn(),
}));

vi.mock('@/sync/domains/plugins/settings/scopedPluginSettingsRuntime', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/sync/domains/plugins/settings/scopedPluginSettingsRuntime')>(),
    resolveScopedPluginSettingsServerIdentity: (serverId: string) => `identity:${serverId}`,
}));

vi.mock('@/components/sessions/presentation/presentationNotices', () => ({
    publishPresentationNotice: vi.fn(),
}));

vi.mock('../framed/hostOrigin', () => ({
    resolveHostedFrameHostOrigin: () => 'https://app.happier.dev',
}));

vi.mock('./sessionCallerHostedHtmlRequestController', () => ({
    createSessionCallerHostedHtmlRequestController: vi.fn(() => ({
        handleRequest: vi.fn(),
        dispose: vi.fn(),
    })),
}));

vi.mock('./hostedInlineDocumentFrameCapability', () => ({
    isHostedInlineDocumentFrameAvailable: () => frameAvailability.current,
}));

import { useSessionCallerHostedHtmlRuntime } from './useSessionCallerHostedHtmlRuntime';

describe('useSessionCallerHostedHtmlRuntime', () => {
    beforeEach(() => {
        platformState.current = 'web';
        currentnessState.account = true;
        currentnessState.session = true;
        frameAvailability.current = true;
    });

    it('stays bound to the exact requested Home across a two-Home shell switch', async () => {
        const hook = await renderHook(
            ({ serverId }) => useSessionCallerHostedHtmlRuntime(serverId, 'shared-session'),
            { initialProps: { serverId: 'home-a' } },
        );

        expect(hook.getCurrent()).toMatchObject({
            serverIdentityId: 'identity:home-a',
            accountId: 'account:home-a',
        });

        await hook.rerender({ serverId: 'home-b' });
        expect(hook.getCurrent()).toMatchObject({
            serverIdentityId: 'identity:home-b',
            accountId: 'account:home-b',
        });
    });

    it.each(['ios', 'android'])('admits caller-authored execution on %s through the same exact-Home runtime', async (platform) => {
        platformState.current = platform;
        const hook = await renderHook(() => useSessionCallerHostedHtmlRuntime('home-a', 'session-a'));
        expect(hook.getCurrent()).toMatchObject({
            serverIdentityId: 'identity:home-a',
            accountId: 'account:home-a',
            hostOrigin: 'https://app.happier.dev',
        });
    });

    it('retires native execution when the exact Account or Session is no longer current', async () => {
        platformState.current = 'android';
        const hook = await renderHook(() => useSessionCallerHostedHtmlRuntime('home-a', 'session-a'));
        expect(hook.getCurrent()).not.toBeNull();

        currentnessState.session = false;
        await hook.rerender();
        expect(hook.getCurrent()).toBeNull();

        currentnessState.session = true;
        currentnessState.account = false;
        await hook.rerender();
        expect(hook.getCurrent()).toBeNull();
    });

    it('keeps one physical mount lifetime and request owner while another item\'s approval changes', async () => {
        // The real local-settings owner holds approvals; approving item B and
        // revoking it must not hand item A a new mount lifetime or controller.
        const hook = await renderHook(() => useSessionCallerHostedHtmlRuntime('home-a', 'session-a'));
        const before = hook.getCurrent()!;
        const approval = { v: 1 } as never;
        expect(before.isApproved(approval, 'item-b-key')).toBe(false);

        before.approve(approval, 'item-b-key');
        await hook.rerender();
        const approved = hook.getCurrent()!;
        expect(approved.isApproved(approval, 'item-b-key')).toBe(true);
        expect(approved.lifetime).toBe(before.lifetime);
        expect(approved.createRequestController).toBe(before.createRequestController);

        approved.revoke(approval, 'item-b-key');
        await hook.rerender();
        const revoked = hook.getCurrent()!;
        expect(revoked.isApproved(approval, 'item-b-key')).toBe(false);
        expect(revoked.lifetime).toBe(before.lifetime);
    });

    it.each(['ios', 'android'])('does not advertise caller HTML on %s without the native registrar', async (platform) => {
        platformState.current = platform;
        frameAvailability.current = false;
        const hook = await renderHook(() => useSessionCallerHostedHtmlRuntime('home-a', 'session-a'));
        expect(hook.getCurrent()).toBeNull();
    });
});
