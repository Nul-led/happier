import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { createServerScopedMachineRpcBoundaryMock } from '@/dev/testkit/mocks/serverScopedRpc';

const boundary = vi.hoisted(() => ({ rpc: vi.fn(), signedIn: false, cursor: 0 }));
vi.mock('react-native-unistyles', async () => {
  const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
  return createUnistylesMock();
});
vi.mock('@/sync/domains/server/serverProfiles', async (original) => {
  const { createPartialServerProfilesModuleMock } = await import('@/dev/testkit/mocks/serverProfiles');
  return createPartialServerProfilesModuleMock(original, { profiles: [{ id: 'fixture-server', serverUrl: 'https://fixture.invalid' }] });
});
vi.mock('@/auth/storage/tokenStorage', async (original) => {
  const { createTokenStorageModuleMock } = await import('@/dev/testkit/mocks/tokenStorage');
  return createTokenStorageModuleMock({ importOriginal: original, tokenStorage: {
    getCredentialsForServerUrl: async () => ({ token: `header.${Buffer.from(JSON.stringify({ sub: 'fixture-account' })).toString('base64')}.signature`,
      encryption: { type: 'legacy', secret: new Uint8Array(32) } }),
  } });
});
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () =>
  createServerScopedMachineRpcBoundaryMock(boundary.rpc));
vi.mock('@/utils/platform/desktopHost', () => ({ isDesktopHost: () => false }));
import { useAgentSignIn } from './useAgentSignIn';

describe('shared Agent sign-in', () => {
  afterEach(() => { vi.useRealTimers(); boundary.rpc.mockReset(); });
  it('uses the daemon terminal on web, shares auth URLs across presenters and keeps state across remounts', async () => {
    vi.useFakeTimers(); boundary.signedIn = false; boundary.cursor = 0;
    boundary.rpc.mockImplementation(async ({ method, payload }: { method: string; payload: { cursor?: number } }) => {
      if (method === 'daemon.agents.signIn.prepare') return { method: 'native', launch: { kind: 'agent_login', agentId: 'codex' } };
      if (method === 'daemon.agents.signIn.status') return { status: boundary.signedIn ? 'signedIn' : 'signedOut',
        accountLabel: null, checkedAt: Date.now(), nativeLogin: 'login_terminal', connectedServices: [] };
      if (method === 'daemon.terminal.close') return { ok: true };
      throw new Error(`Unexpected fixture RPC ${method}`);
    });
    const target = { serverId: 'fixture-server', machineId: 'fixture-machine', agentId: 'codex' };
    const first = await renderHook(() => useAgentSignIn(target));
    const second = await renderHook(() => useAgentSignIn(target));
    await act(async () => { await first.getCurrent().start(); });
    expect(first.getCurrent().state.phase).toBe('waiting');
    await act(async () => {
      first.getCurrent().reportTerminalUrl({ kind: 'generic', url: 'https://example.invalid/not-auth' });
      first.getCurrent().reportTerminalUrl({ kind: 'auth', url: 'https://example.invalid/auth' });
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(second.getCurrent().authUrl).toBe('https://example.invalid/auth');
    const startedAt = first.getCurrent().startedAtMs;
    await first.unmount(); await second.unmount();
    const remounted = await renderHook(() => useAgentSignIn(target));
    expect(remounted.getCurrent().startedAtMs).toBe(startedAt);
    expect(remounted.getCurrent().state.phase).toBe('waiting');
    boundary.signedIn = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(remounted.getCurrent().phase).toBe('signedIn');
    expect(boundary.rpc.mock.calls.map(([request]) => request.method)).not.toContain('daemon.terminal.ensure');
    expect(boundary.rpc.mock.calls.map(([request]) => request.method)).not.toContain('daemon.terminal.streamRead');
    await act(async () => { await remounted.getCurrent().cancel(); });
    expect(remounted.getCurrent().phase).toBe('idle');
    await remounted.unmount();
  });
});
