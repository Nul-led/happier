import { afterEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';
import { act } from 'react-test-renderer';
import { createManualSystemTaskRunner } from '@/dev/testkit/harness/manualSystemTaskRunner';
import { useThisComputerSetupTask } from './useThisComputerSetupTask';

const modalSpies = vi.hoisted(() => ({ confirm: vi.fn(async () => true) }));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { confirm: modalSpies.confirm } }).module;
});
afterEach(() => { standardCleanup(); vi.clearAllMocks(); });

import { resolveThisComputerSetupFollowUp } from './useThisComputerSetupTask';

it('answers a later service prompt after delayed launch and navigation, and adopts the same scoped run on return', async () => {
    let finishStart!: (taskId: string) => void;
    const manual = createManualSystemTaskRunner();
    const { runner } = manual;
    manual.bridge.start.mockImplementation(() => new Promise<string>((resolve) => { finishStart = resolve; }));
    const approval = { expectedRelayUrl: 'https://retained-setup.example', serverId: 'home-a', expectedAccountId: 'owner-a' };
    const mounted = await renderHook(() => useThisComputerSetupTask({ runner, authRequestApproval: approval }));
    let starting!: Promise<string>;
    await act(async () => { starting = mounted.getCurrent().start({ protocolVersion: 1, kind: 'setup.thisComputer.v1', params: {
        activeRelayUrl: approval.expectedRelayUrl, activeServerIdentityId: approval.serverId, activeAccountId: approval.expectedAccountId,
    } }); });
    await mounted.unmount();
    finishStart('retained-task');
    await starting;
    manual.emitEvent('retained-task', { type: 'progress', message: 'Downloading command line' });
    manual.emitEvent('retained-task', { type: 'prompt', message: 'Switch channel?', data: {
        kind: 'releaseChannel.switchDefaultForSetup', targetServerUrl: approval.expectedRelayUrl,
        currentDefaultReleaseChannel: 'stable', targetReleaseChannel: 'preview', managedReleaseChannels: [],
    } });
    await flushHookEffects();
    expect(manual.bridge.respond).toHaveBeenCalledWith('retained-task', { switchDefaultReleaseChannel: true });
    const returned = await renderHook((currentApproval) => useThisComputerSetupTask({ runner, authRequestApproval: currentApproval }), {
        initialProps: approval,
    });
    expect(returned.getCurrent().activeTaskId).toBe('retained-task');
    expect(returned.getCurrent().activeTaskSnapshot?.latestMessage).toBe('Switch channel?');
    await returned.rerender({ ...approval, expectedAccountId: 'owner-b' });
    expect(returned.getCurrent().activeTaskId).toBeNull();
    await returned.rerender(approval);
    expect(returned.getCurrent().activeTaskId).toBe('retained-task');
    const otherHome = await renderHook(() => useThisComputerSetupTask({ runner, authRequestApproval: {
        expectedRelayUrl: 'https://different.example', serverId: 'home-b',
    } }));
    expect(otherHome.getCurrent().activeTaskId).toBeNull();
    const otherAccount = await renderHook(() => useThisComputerSetupTask({ runner, authRequestApproval: {
        ...approval, expectedAccountId: 'owner-b',
    } }));
    expect(otherAccount.getCurrent().activeTaskId).toBeNull();
    await act(async () => {
        returned.getCurrent().cancel();
        manual.emitResult('retained-task', { protocolVersion: 1, taskId: 'retained-task', ok: false, error: { code: 'cancelled', message: 'Stopped' } });
    });
    await flushHookEffects();
    expect(returned.getCurrent().activeTaskSnapshot?.status).toBe('canceled');
    expect(runner.listPromptContinuations?.()).toEqual([]);
});

it('retains a URL-only enrollment for its unique saved Home and account, but refuses an ambiguous URL or another account', async () => {
    const profiles = await import('@/sync/domains/server/serverProfiles');
    const { resolveSavedServerProfileByUrl, upsertServerProfile } = profiles;
    const relayUrl = 'https://url-only-setup.example';
    const profile = await upsertServerProfile({ serverUrl: relayUrl });
    const manual = createManualSystemTaskRunner();
    const approval = { expectedRelayUrl: relayUrl, serverId: profile.id, expectedAccountId: 'owner-a' };
    const mounted = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner, authRequestApproval: approval }));
    let taskId = '';
    await act(async () => { taskId = await mounted.getCurrent().start({ protocolVersion: 1, kind: 'setup.thisComputer.v1', params: {
        activeRelayUrl: relayUrl, activeAccountId: 'owner-a',
    } }); });
    expect(mounted.getCurrent().activeTaskId).toBe(taskId);
    await mounted.unmount();
    const reopened = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner, authRequestApproval: approval }));
    expect(reopened.getCurrent().activeTaskId).toBe(taskId);
    const otherAccount = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner, authRequestApproval: {
        ...approval, expectedAccountId: 'owner-b',
    } }));
    expect(otherAccount.getCurrent().activeTaskId).toBeNull();
    const { MMKV } = await import('react-native-mmkv');
    const { readStorageScopeFromEnv, scopedStorageId } = await import('@/utils/system/storageScope');
    const boundary = new MMKV({ id: scopedStorageId('server-profiles', readStorageScopeFromEnv()) });
    const previous = boundary.getString('server-state-v1');
    try {
        // Released persisted profiles can retain distinct Home identities at one URL;
        // use the same secure-storage vector as the canonical profile-owner coverage.
        boundary.set('server-state-v1', JSON.stringify({ servers: {
            [profile.id]: { ...profile, serverIdentityId: 'srv_url_only_home_a' },
            other: { ...profile, id: 'other', serverIdentityId: 'srv_url_only_home_b' },
        } }));
        profiles.resetServerProfilesRuntimeForTests();
        expect(resolveSavedServerProfileByUrl(relayUrl, { includeCanonicalServerUrl: true }).kind).toBe('ambiguous');
        const ambiguous = await renderHook(() => useThisComputerSetupTask({ runner: manual.runner, authRequestApproval: approval }));
        expect(ambiguous.getCurrent().activeTaskId).toBeNull();
        expect(manual.runner.getSnapshot(taskId)?.status).toBe('running');
    } finally {
        if (previous === undefined) boundary.delete('server-state-v1');
        else boundary.set('server-state-v1', previous);
        profiles.resetServerProfilesRuntimeForTests();
    }
});

describe('resolveThisComputerSetupFollowUp', () => {
    it('still routes unauthenticated failures to auth follow-up', () => {
        expect(resolveThisComputerSetupFollowUp({
            protocolVersion: 1,
            taskId: 'task-1',
            ok: false,
            error: {
                code: 'not_authenticated',
                message: 'sign in required',
            },
        })).toBe('auth');
    });

    it('does not route missing machine ids to a manual approval follow-up for local setup', () => {
        expect(resolveThisComputerSetupFollowUp({
            protocolVersion: 1,
            taskId: 'task-1',
            ok: false,
            error: {
                code: 'machine_id_unavailable',
                message: 'machine id missing',
            },
        })).toBeNull();
    });
});
