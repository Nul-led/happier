import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskJsonObject, type SystemTaskResult, type SystemTaskSpec } from '@happier-dev/protocol';
import { PERSONAL_HOME_SYSTEM_TASK_KINDS } from '@happier-dev/cli-common/systemTasks';
import { PersonalHomeRelocationTransferCleanupError } from '@happier-dev/cli-common/firstPartyRuntime';
import { captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';

import { handleHomeCommand, type HomeCommandDeps } from './home';

function success(taskId: string, data: SystemTaskJsonObject): SystemTaskResult {
  return { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, taskId, ok: true, data };
}

type ScriptedTaskResult = SystemTaskResult | Readonly<{
  prompt: Readonly<{ kind: string; data: SystemTaskJsonObject }>;
  result: SystemTaskResult;
}>;

function createDeps(results: readonly ScriptedTaskResult[], overrides: Partial<HomeCommandDeps> = {}) {
  let index = 0;
  let promptShown = false;
  const start = vi.fn(async (_params: Readonly<{ spec: SystemTaskSpec }>) => ({ taskId: `task-${index + 1}` }));
  const poll = vi.fn(async () => {
    const scripted = results[index];
    if (!scripted) throw new Error('unexpected poll');
    if ('prompt' in scripted && !promptShown) {
      promptShown = true;
      return { events: [], nextCursor: 0, result: null, pendingPrompt: scripted.prompt };
    }
    index += 1;
    promptShown = false;
    const result = 'prompt' in scripted ? scripted.result : scripted;
    return { events: [], nextCursor: 0, result, pendingPrompt: null };
  });
  const respond = vi.fn(async () => {});
  const deps: HomeCommandDeps = {
    createRunner: () => ({ start, poll, respond }),
    resolvePath: (value) => value.startsWith('/') ? value : `/work/${value.replace(/^\.\//, '')}`,
    isInteractiveTerminal: () => false,
    promptInput: async () => 'no',
    sleep: async () => undefined,
    resolveDefaultChannel: () => 'stable',
    ...overrides,
  };
  return { deps, start, poll, respond };
}

function erasePrompt(result: SystemTaskResult): ScriptedTaskResult {
  return {
    prompt: {
      kind: 'personal_home.confirm_erase.v1',
      data: {
        canonicalServerUrl: 'http://127.0.0.1:53288',
        homeServerIdentityId: 'home-1',
        paths: ['/data/home/database/home.sqlite', '/data/home/files/public'],
        estimatedBytes: 4096,
      },
    },
    result,
  };
}

function failure(taskId: string, code: string, message: string): SystemTaskResult {
  return { protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION, taskId, ok: false, error: { code, message } };
}

const homeStatus = success('status', {
  installed: true,
  purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
  canonicalServerUrl: 'http://127.0.0.1:53288',
});

const nonEmptyInspection = success('inspect', {
  running: false,
  identity: { homeServerIdentityId: 'home-1' },
  masterSecret: { present: true, fingerprint: 'secret-fingerprint' },
  layout: {
    dataDir: '/data/home',
    configDir: '/config/home',
    backupsDir: '/data/home/backups',
    databasePath: '/data/home/database/home.sqlite',
    publicFilesDir: '/data/home/files/public',
    privateFilesDir: '/data/home/files/private',
    masterSecretPath: '/data/home/secrets/master-secret',
  },
  storage: {
    databasePresent: true,
    databaseBytes: 512,
    publicFilesPresent: true,
    privateFilesPresent: true,
    backupsCount: 1,
    ownedErasePaths: ['/data/home/database/home.sqlite', '/data/home/files/public', '/data/home/files/private'],
    estimatedOwnedBytes: 4_096,
    destinationEmpty: false,
  },
  restoreRecovery: { status: 'none', affectedTargets: [] },
});
const nonEmptyInspectionData = (nonEmptyInspection as Extract<SystemTaskResult, { ok: true }>).data as SystemTaskJsonObject;

const emptyInspection = success('inspect', {
  running: false,
  identity: null,
  masterSecret: { present: false, fingerprint: null },
  layout: { dataDir: '/data/home' },
  storage: {
    databasePresent: false,
    databaseBytes: null,
    publicFilesPresent: false,
    privateFilesPresent: false,
    backupsCount: 0,
    ownedErasePaths: [],
    estimatedOwnedBytes: 0,
    destinationEmpty: true,
  },
  restoreRecovery: { status: 'none', affectedTargets: [] },
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('handleHomeCommand', () => {
  it('runs forward direct QR only after trusted Home creation and keeps automatic Account Service linking optional', async () => {
    const order: string[] = [];
    const pairDevice = vi.fn(async () => {
      order.push('pair');
      return { kind: 'completed' as const, requestedDeviceLabel: 'Phone' };
    });
    const linkAccount = vi.fn(async () => {
      order.push('link');
      return { kind: 'unavailable' as const, reason: 'account_service_credentials_unavailable' as const };
    });
    const { deps } = createDeps([], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      createPersonalHome: async () => {
        order.push('create');
        return {
          profileId: 'personal-home',
          homeServerIdentityId: 'srv_personal_home',
          canonicalServerUrl: 'http://127.0.0.1:43123',
          accountCreated: true,
        };
      },
      reconcileCreatedHome: async () => { order.push('reconcile'); },
      pairDevice,
      linkAccount,
    });

    await handleHomeCommand(['create', '--link-account', 'auto'], deps);

    expect(order).toEqual(['create', 'reconcile', 'pair', 'link']);
    expect(pairDevice).toHaveBeenCalledWith({ profileRef: 'personal-home', copyLink: false, signal: undefined });
    expect(linkAccount).toHaveBeenCalledWith({ homeServerIdentityId: 'srv_personal_home', relink: false, signal: undefined });
    expect(process.exitCode).toBeUndefined();
  });

  it('honors create --link-account never and does not emit QR material in JSON mode', async () => {
    const pairDevice = vi.fn();
    const linkAccount = vi.fn();
    const { deps } = createDeps([], {
      createPersonalHome: async () => ({
        profileId: 'personal-home',
        homeServerIdentityId: 'srv_personal_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: false,
      }),
      reconcileCreatedHome: async () => undefined,
      pairDevice,
      linkAccount,
    });
    const output = captureStdoutJsonOutput<Record<string, unknown>>();
    try {
      await handleHomeCommand(['create', '--yes', '--json', '--link-account', 'never'], deps);
      expect(JSON.stringify(output.json())).not.toMatch(/pair|secret|credential|approval|qr/i);
      expect(output.json().data).toMatchObject({ accountServiceLink: { kind: 'not_requested' } });
    } finally {
      output.restore();
    }
    expect(pairDevice).not.toHaveBeenCalled();
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', async () => ({ kind: 'failed' as const }), { kind: 'failed' }],
    ['cancelled', async () => ({ kind: 'cancelled' as const }), { kind: 'cancelled' }],
    ['Account Service session unavailable', async () => ({ kind: 'unavailable' as const, reason: 'account_service_credentials_unavailable' as const }), { kind: 'unavailable', reason: 'account_service_credentials_unavailable' }],
    ['home transport unavailable', async () => ({ kind: 'unavailable' as const, reason: 'home_transport_unavailable' as const }), { kind: 'unavailable', reason: 'home_transport_unavailable' }],
    ['exception', async () => { throw new Error('link failed after create'); }, { kind: 'failed' }],
  ])('keeps local Home creation durable and reports typed post-create link outcome when linking is %s', async (_label, linkAccount, expected) => {
    const { deps } = createDeps([], {
      createPersonalHome: async () => ({
        profileId: 'personal-home',
        homeServerIdentityId: 'srv_personal_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
      }),
      reconcileCreatedHome: async () => undefined,
      linkAccount,
    });
    const output = captureStdoutJsonOutput<{ data?: { status?: string; accountServiceLink?: { kind?: string } } }>();
    try {
      await handleHomeCommand(['create', '--yes', '--json', '--link-account', 'auto'], deps);
      expect(output.json().data).toMatchObject({
        status: 'complete',
        accountServiceLink: expected,
      });
    } finally {
      output.restore();
    }
  });

  it('keeps local creation successful and prints identity-specific reentry after an optional post-create link failure', async () => {
    const { deps } = createDeps([], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      createPersonalHome: async () => ({
        profileId: 'personal-home',
        homeServerIdentityId: 'srv_personal_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
      }),
      reconcileCreatedHome: async () => undefined,
      linkAccount: async () => ({ kind: 'failed' }),
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--link-account', 'auto'], deps);

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Personal Home ready');
    expect(text).toContain('happier home link-account --home srv_personal_home');
    expect(process.exitCode).toBeUndefined();
  });

  it('exposes direct QR reentry separately from terminal pairing', async () => {
    const pairDevice = vi.fn(async () => ({ kind: 'completed' as const, requestedDeviceLabel: 'Browser' }));
    const { deps } = createDeps([], { pairDevice });

    await handleHomeCommand(['pair-device', '--home', 'studio', '--copy-link'], deps);

    expect(pairDevice).toHaveBeenCalledWith({ profileRef: 'studio', copyLink: true, signal: undefined });
  });

  it('emits only the authorized invite and typed outcome for the internal remote pairing stream', async () => {
    const link = 'happier:///pair?v=2&payload=short-lived-v2';
    const pairDevice = vi.fn(async (input: Readonly<{ onInvite?: (value: Readonly<{ link: string }>) => void }>) => {
      input.onInvite?.({ link });
      return { kind: 'expired' as const };
    });
    const { deps } = createDeps([], { pairDevice, isInteractiveTerminal: () => false });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['pair-device', '--system-task-stream'], deps);

    expect(output.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { v: 1, kind: 'home_pair_device.invite', link },
      { v: 1, kind: 'home_pair_device.result', result: { kind: 'expired' } },
    ]);
    expect(output.mock.calls.flat().join('\n')).not.toMatch(/access\.key|bearer|claimSecret|masterSecret/i);
  });

  it('refuses pair-device JSON before starting and emits no enrollment material', async () => {
    const pairDevice = vi.fn();
    const { deps } = createDeps([], { pairDevice });
    const output = captureStdoutJsonOutput();
    try {
      await expect(handleHomeCommand(['pair-device', '--json', '--copy-link'], deps))
        .rejects.toMatchObject({ code: 'interactive_required' });
      expect(output.chunks.join('')).toBe('');
    } finally {
      output.restore();
    }
    expect(pairDevice).not.toHaveBeenCalled();
  });

  it('surfaces bound QR update-required without starting another flow', async () => {
    const pairDevice = vi.fn(async () => ({ kind: 'update_required' as const }));
    const { deps } = createDeps([], { pairDevice, isInteractiveTerminal: () => true });

    await expect(handleHomeCommand(['pair-device'], deps)).rejects.toMatchObject({ code: 'update_required' });
    expect(pairDevice).toHaveBeenCalledOnce();
  });

  it('preserves explicit Account Service relink conflict semantics', async () => {
    const linkAccount = vi.fn(async (input: Readonly<{ relink: boolean }>) => input.relink
      ? ({ kind: 'linked' as const, homeServerIdentityId: 'srv_home' })
      : ({ kind: 'relink_required' as const, homeServerIdentityId: 'srv_home' }));
    const { deps } = createDeps([], { linkAccount });

    await expect(handleHomeCommand(['link-account', '--home', 'srv_home'], deps)).rejects.toMatchObject({ code: 'relink_required' });
    await handleHomeCommand(['link-account', '--home', 'srv_home', '--relink'], deps);

    expect(linkAccount).toHaveBeenLastCalledWith({ homeServerIdentityId: 'srv_home', relink: true, signal: undefined });
  });

  it('admits the selected artifact before starting local Personal Home bootstrap, then reconciles the adopted Home', async () => {
    const order: string[] = [];
    const createPersonalHome = vi.fn(async (input: Readonly<{
      channel: 'stable' | 'preview' | 'dev';
      mode: 'user' | 'system';
    }>) => {
      order.push('create');
      expect(input).toEqual({ channel: 'preview', mode: 'system' });
      return {
        profileId: 'personal-home',
        homeServerIdentityId: 'srv_personal_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
      };
    });
    const reconcileCreatedHome = vi.fn(async (profileId: string) => {
      order.push(`reconcile:${profileId}`);
    });
    const promptInput = vi.fn(async () => {
      order.push('confirm');
      return 'yes';
    });
    const { deps, start } = createDeps([], {
      createPersonalHome,
      reconcileCreatedHome,
      isInteractiveTerminal: () => true,
      promptInput,
    });

    await handleHomeCommand(['create', '--channel', 'preview', '--mode', 'system'], deps);

    expect(order).toEqual(['confirm', 'create', 'reconcile:personal-home']);
    expect(promptInput).toHaveBeenCalledWith(expect.stringContaining('plaintext'));
    expect(promptInput).toHaveBeenCalledWith(expect.stringContaining('Mode: system'));
    expect(start).not.toHaveBeenCalled();
  });

  it('uses the current CLI release ring when --channel is omitted', async () => {
    const createPersonalHome = vi.fn(async () => ({
      profileId: 'personal-home',
      homeServerIdentityId: 'srv_personal_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      accountCreated: false,
    }));
    const { deps } = createDeps([], {
      createPersonalHome,
      reconcileCreatedHome: async () => undefined,
      resolveDefaultChannel: () => 'dev',
      isInteractiveTerminal: () => false,
    });

    await handleHomeCommand(['create', '--yes'], deps);

    expect(createPersonalHome).toHaveBeenCalledWith({ channel: 'dev', mode: 'user' });
  });

  it('declines before artifact, runtime, profile, or bootstrap mutation', async () => {
    const createPersonalHome = vi.fn();
    const reconcileCreatedHome = vi.fn();
    const { deps, start } = createDeps([], {
      createPersonalHome,
      reconcileCreatedHome,
      isInteractiveTerminal: () => true,
      promptInput: async () => 'no',
    });

    await expect(handleHomeCommand(['create'], deps)).rejects.toMatchObject({
      code: 'confirmation_declined',
    });

    expect(createPersonalHome).not.toHaveBeenCalled();
    expect(reconcileCreatedHome).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('allows explicit --yes creation without a TTY and never prompts', async () => {
    const createPersonalHome = vi.fn(async () => ({
      profileId: 'personal-home',
      homeServerIdentityId: 'srv_personal_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      accountCreated: true,
    }));
    const promptInput = vi.fn();
    const { deps } = createDeps([], {
      createPersonalHome,
      reconcileCreatedHome: async () => undefined,
      isInteractiveTerminal: () => false,
      promptInput,
    });

    await handleHomeCommand(['create', '--yes'], deps);

    expect(createPersonalHome).toHaveBeenCalledOnce();
    expect(promptInput).not.toHaveBeenCalled();
  });

  it('creates a remote Personal Home through the one SSH coordinator after explicit plaintext confirmation', async () => {
    const descriptor = {
      v: 1,
      homeServerIdentityId: 'srv_remote_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      revision: 2,
      endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
    };
    const remoteCreated = success('remote-create', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor,
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    const createPersonalHome = vi.fn();
    const reconcileCreatedHome = vi.fn();
    const pairDevice = vi.fn();
    const promptInput = vi.fn(async (_prompt: string) => 'yes');
    const { deps, start } = createDeps([remoteCreated], {
      createPersonalHome,
      reconcileCreatedHome,
      pairDevice,
      promptInput,
      isInteractiveTerminal: () => true,
    });

    await handleHomeCommand(['create', '--ssh', 'dev@example.test'], deps);

    expect(promptInput).toHaveBeenCalledWith(expect.stringContaining('dev@example.test'));
    expect(promptInput).toHaveBeenCalledWith(expect.stringContaining('plaintext'));
    expect(start).toHaveBeenCalledWith({ spec: {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action: 'personalHome.create',
        channel: 'stable',
        relayRuntime: { channel: 'stable', mode: 'user' },
        pairDevice: true,
        enrollInvokingClient: true,
        ssh: { target: 'dev@example.test', auth: 'agent' },
      },
    } });
    expect(createPersonalHome).not.toHaveBeenCalled();
    expect(reconcileCreatedHome).not.toHaveBeenCalled();
    expect(pairDevice).not.toHaveBeenCalled();
  });

  it.each(['cancelled', 'expired'] as const)('keeps remote creation successful when optional pairing is %s', async (kind) => {
    const remoteCreated = success(`remote-create-${kind}`, {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind },
        invokingClientEnrollment: { kind: 'not_requested' },
      },
    });
    const { deps } = createDeps([remoteCreated], { isInteractiveTerminal: () => true, promptInput: async () => 'yes' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'never'], deps);

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Remote Personal Home ready');
    expect(text).toContain('happier home create --ssh dev@example.test --link-account never');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an optional post-create pairing failure without failing or claiming Home rollback', async () => {
    const remoteCreated = success('remote-create-pair-failed', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'failed', status: 503 },
        invokingClientEnrollment: { kind: 'not_requested' },
      },
    });
    const { deps } = createDeps([remoteCreated], { isInteractiveTerminal: () => true, promptInput: async () => 'yes' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'never'], deps);

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Remote Personal Home ready');
    expect(text).toContain('pairing is incomplete');
    expect(text).not.toMatch(/rolled back|removed|creation failed/i);
    expect(process.exitCode).toBeUndefined();
  });

  it('enrolls the invoking CLI before automatic Account Service linking for a remote Home', async () => {
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_remote_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      revision: 2,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
    };
    const remoteCreated = success('remote-create-auto-link', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: descriptor.homeServerIdentityId,
        canonicalServerUrl: descriptor.canonicalServerUrl,
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor,
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    const linkAccount = vi.fn(async () => ({ kind: 'linked' as const, homeServerIdentityId: descriptor.homeServerIdentityId }));
    const { deps } = createDeps([remoteCreated], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      linkAccount,
    });

    await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'auto'], deps);

    expect(linkAccount).toHaveBeenCalledWith({
      homeServerIdentityId: descriptor.homeServerIdentityId,
      relink: false,
      signal: undefined,
    });
  });

  it('reports remote invoking-client enrollment failure as typed post-create incompleteness in JSON', async () => {
    const remoteCreated = success('remote-create-enrollment-failed', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'not_requested' },
        invokingClientEnrollment: { kind: 'failed' },
      },
    });
    const linkAccount = vi.fn();
    const { deps } = createDeps([remoteCreated], { linkAccount });
    const output = captureStdoutJsonOutput<{ data?: Record<string, unknown> }>();
    try {
      await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--yes', '--json', '--link-account', 'auto'], deps);
      expect(output.json().data).toMatchObject({
        status: 'complete',
        invokingClientEnrollment: { kind: 'failed' },
        accountServiceLink: { kind: 'unable_to_attempt' },
      });
      expect(output.json().data).not.toHaveProperty('pairing');
    } finally {
      output.restore();
    }
    expect(linkAccount).not.toHaveBeenCalled();
  });

  it('reports remote enrollment failure without undoing the Home and prints exact create reentry', async () => {
    const remoteCreated = success('remote-create-enrollment-failed-human', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'not_requested' },
        invokingClientEnrollment: { kind: 'failed' },
      },
    });
    const { deps } = createDeps([remoteCreated], { isInteractiveTerminal: () => true, promptInput: async () => 'yes' });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'auto'], deps);

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Remote Personal Home ready');
    expect(text).toContain('happier home create --ssh dev@example.test --link-account auto');
    expect(text).not.toMatch(/rolled back|removed|creation failed/i);
    expect(process.exitCode).toBeUndefined();
  });

  it('does not attempt Account Service linking when remote Home creation fails', async () => {
    const linkAccount = vi.fn();
    const { deps } = createDeps([
      failure('remote-create-failed', 'personal_home_create_failed', 'Remote bootstrap failed.'),
    ], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      linkAccount,
    });

    await expect(handleHomeCommand([
      'create',
      '--ssh',
      'dev@example.test',
      '--link-account',
      'auto',
    ], deps)).rejects.toMatchObject({ code: 'personal_home_create_failed' });

    expect(linkAccount).not.toHaveBeenCalled();
  });

  it('makes remote --link-account never skip invoking-client enrollment and Account Service publication', async () => {
    const remoteCreated = success('remote-create-never-link', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'not_requested' },
      },
    });
    const linkAccount = vi.fn();
    const { deps, start } = createDeps([remoteCreated], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      linkAccount,
    });

    await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'never'], deps);

    expect(linkAccount).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({
      params: expect.objectContaining({ enrollInvokingClient: false }),
    }) }));
  });

  it('keeps a remote Home usable when Account Service is unavailable and prints the exact link reentry', async () => {
    const remoteCreated = success('remote-create-no-account-service', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    const { deps } = createDeps([remoteCreated], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      linkAccount: async () => ({ kind: 'unavailable' as const, reason: 'account_service_credentials_unavailable' as const }),
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--ssh', 'dev@example.test'], deps);

    expect(output.mock.calls.flat().join('\n')).toContain('happier home link-account --home srv_remote_home');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports an optional Account Service exception without failing or undoing the remote Home', async () => {
    const remoteCreated = success('remote-create-link-error', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete',
        homeServerIdentityId: 'srv_remote_home',
        canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true,
        channel: 'stable',
        mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'completed', requestedDeviceLabel: null },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    const { deps } = createDeps([remoteCreated], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
      linkAccount: async () => {
        throw new Error('Account Service unavailable');
      },
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    await handleHomeCommand(['create', '--ssh', 'dev@example.test'], deps);

    const text = output.mock.calls.flat().join('\n');
    expect(text).toContain('Remote Personal Home ready');
    expect(text).toContain('happier home link-account --home srv_remote_home');
    expect(text).not.toMatch(/rolled back|removed|creation failed/i);
    expect(process.exitCode).toBeUndefined();
  });

  it('keeps remote create mutation-free without confirmation and makes JSON output secret-free', async () => {
    const createPersonalHome = vi.fn();
    const { deps, start } = createDeps([], { createPersonalHome, promptInput: async () => 'no', isInteractiveTerminal: () => true });
    await expect(handleHomeCommand(['create', '--ssh', 'dev@example.test'], deps)).rejects.toMatchObject({ code: 'confirmation_declined' });
    expect(start).not.toHaveBeenCalled();

    const remoteCreated = success('remote-create-json', {
      action: 'personalHome.create',
      personalHome: {
        status: 'complete', homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123',
        accountCreated: true, channel: 'stable', mode: 'user',
        descriptor: { v: 1, homeServerIdentityId: 'srv_remote_home', canonicalServerUrl: 'http://127.0.0.1:43123', revision: 1, endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }] },
        pairing: { kind: 'not_requested' },
        invokingClientEnrollment: { kind: 'enrolled' },
      },
    });
    const linkAccount = vi.fn(async () => ({ kind: 'linked' as const, homeServerIdentityId: 'srv_remote_home' }));
    const jsonHarness = createDeps([remoteCreated], { linkAccount });
    const output = captureStdoutJsonOutput<Record<string, unknown>>();
    try {
      await handleHomeCommand(['create', '--ssh', 'dev@example.test', '--yes', '--json'], jsonHarness.deps);
      const text = JSON.stringify(output.json());
      expect(text).not.toMatch(/token|secret|credential|approval|qr|pairing.*link/i);
    } finally {
      output.restore();
    }
    expect(jsonHarness.start).toHaveBeenCalledWith(expect.objectContaining({ spec: expect.objectContaining({
      kind: 'remote.ssh.manageHost.v1',
      params: expect.objectContaining({ pairDevice: false, enrollInvokingClient: true }),
    }) }));
    expect(linkAccount).toHaveBeenCalledOnce();
    expect(output.json().data).toMatchObject({ accountServiceLink: { kind: 'linked' } });
  });

  it('rejects ambiguous or invalid remote create options before starting the coordinator', async () => {
    const { deps, start } = createDeps([]);
    await expect(handleHomeCommand(['create', '--ssh', 'dev@example.test', '--this-computer', '--yes'], deps))
      .rejects.toMatchObject({ code: 'invalid_params' });
    await expect(handleHomeCommand(['create', '--ssh', 'dev@example.test', '--link-account', 'sometimes', '--yes'], deps))
      .rejects.toMatchObject({ code: 'invalid_params' });
    expect(start).not.toHaveBeenCalled();
  });

  it.each([
    ['status', ['status', '--ssh', 'dev@example.test'], 'personalHome.status', undefined],
    ['backup', ['backup', '--ssh', 'dev@example.test', '--output', './home.tar'], 'personalHome.backup', { outputPath: '/work/home.tar' }],
    ['verify', ['verify-backup', '--ssh', 'dev@example.test', './home.tar'], 'personalHome.verifyBackup', { archivePath: '/work/home.tar' }],
    ['restore', ['restore', '--ssh', 'dev@example.test', './home.tar', '--yes'], 'personalHome.restore', { archivePath: '/work/home.tar' }],
    ['recovery', ['recover-restore', '--ssh', 'dev@example.test', '--yes'], 'personalHome.recoverRestore', undefined],
  ] as const)('routes remote %s through the single SSH coordinator', async (_name, argv, action, personalHomeOperation) => {
    const remote = success('remote-operation', { action, personalHome: { outcome: 'complete' } });
    const { deps, start } = createDeps([remote]);

    await handleHomeCommand([...argv], deps);

    expect(start).toHaveBeenCalledWith({ spec: {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      kind: 'remote.ssh.manageHost.v1',
      params: {
        action,
        channel: 'stable',
        relayRuntime: { channel: 'stable', mode: 'user' },
        ssh: { target: 'dev@example.test', auth: 'agent' },
        ...(personalHomeOperation ? { personalHomeOperation } : {}),
      },
    } });
  });

  it('renders exact remote erase facts and keeps approval in the in-memory prompt response', async () => {
    const remoteErase: ScriptedTaskResult = {
      prompt: {
        kind: 'personal_home.confirm_remote_erase.v1',
        data: {
          sshHost: 'dev@example.test', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'home-1',
          paths: ['/srv/home/db.sqlite', '/srv/home/files'], estimatedBytes: 4096,
        },
      },
      result: success('remote-erase', { action: 'personalHome.erase', personalHome: { outcome: 'completed', removedPaths: ['/srv/home/db.sqlite', '/srv/home/files'] } }),
    };
    const promptInput = vi.fn(async (_prompt: string) => 'yes');
    const { deps, start, respond } = createDeps([remoteErase], { promptInput, isInteractiveTerminal: () => true });

    await handleHomeCommand(['erase', '--ssh', 'dev@example.test'], deps);

    expect(promptInput.mock.calls[0]?.[0]).toContain('dev@example.test');
    expect(promptInput.mock.calls[0]?.[0]).toContain('home-1');
    expect(promptInput.mock.calls[0]?.[0]).toContain('/srv/home/db.sqlite');
    expect(promptInput.mock.calls[0]?.[0]).toContain('4096');
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-1', answer: { confirmed: true } });
    expect(JSON.stringify(start.mock.calls)).not.toMatch(/confirmation-token|approval-stdin/u);
  });

  it.each([[[]], [['--json']]])('keeps no-TTY creation without --yes mutation-free (%j)', async (flags: string[]) => {
    const createPersonalHome = vi.fn();
    const reconcileCreatedHome = vi.fn();
    const { deps, start } = createDeps([], { createPersonalHome, reconcileCreatedHome });

    await expect(handleHomeCommand(['create', ...flags], deps)).rejects.toMatchObject({ code: 'interactive_required' });
    expect(createPersonalHome).not.toHaveBeenCalled();
    expect(reconcileCreatedHome).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('writes one strict non-secret JSON creation result with --json --yes', async () => {
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_personal_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      revision: 1,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'a'.repeat(64) }],
    };
    const createPersonalHome = vi.fn(async () => ({
      profileId: 'personal-home',
      homeServerIdentityId: 'srv_personal_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      accountCreated: true,
      descriptor,
    }));
    const reconcileCreatedHome = vi.fn(async () => undefined);
    const { deps } = createDeps([], { createPersonalHome, reconcileCreatedHome });
    const output = captureStdoutJsonOutput<Record<string, unknown>>();
    try {
      await handleHomeCommand(['create', '--json', '--yes'], deps);
      const parsed = output.json() as Record<string, any>;
      expect(parsed).toEqual({
        v: 1,
        ok: true,
        kind: 'personal_home_create',
        data: {
          status: 'complete',
          profileId: 'personal-home',
          homeServerIdentityId: 'srv_personal_home',
          canonicalServerUrl: 'http://127.0.0.1:43123',
          accountCreated: true,
          channel: 'stable',
          mode: 'user',
          descriptor,
          accountServiceLink: { kind: 'unable_to_attempt' },
        },
      });
      expect(JSON.stringify(parsed)).not.toMatch(/token|secret|credential|approval|qr/i);
      expect(reconcileCreatedHome).toHaveBeenCalledWith('personal-home', { quiet: true });
    } finally {
      output.restore();
    }
  });

  it('keeps the compatibility --this-computer alias on the canonical create path', async () => {
    const createPersonalHome = vi.fn(async () => ({
      profileId: 'personal-home',
      homeServerIdentityId: 'srv_personal_home',
      canonicalServerUrl: 'http://127.0.0.1:43123',
      accountCreated: false,
    }));
    const { deps } = createDeps([], {
      createPersonalHome,
      reconcileCreatedHome: async () => undefined,
      isInteractiveTerminal: () => true,
      promptInput: async () => 'yes',
    });

    await handleHomeCommand(['create', '--this-computer'], deps);

    expect(createPersonalHome).toHaveBeenCalledTimes(1);
  });

  it('invokes the installed destination-local relocation task contract without exposing a data directory', async () => {
    const staged = success('stage', { operationId: 'operation-1', status: 'quarantined' });
    const { deps, start } = createDeps([homeStatus, staged]);
    await handleHomeCommand([
      'relocation-destination', 'stage',
      '--operation-id', 'operation-1',
      '--archive', '/incoming/home.tar',
      '--bundle-sha256', 'a'.repeat(64),
      '--expected-home-id', 'home-1',
      '--expected-canonical-server-url', 'https://source.example.test',
      '--source-descriptor-revision', '7',
      '--json',
    ], deps);
    expect(start).toHaveBeenNthCalledWith(2, { spec: expect.objectContaining({
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.relocationDestinationStage,
      params: expect.objectContaining({
        operationId: 'operation-1',
        archivePath: '/incoming/home.tar',
        expectedCanonicalServerUrl: 'https://source.example.test',
        sourceDescriptorRevision: 7,
      }),
    }) });
    const params = (start.mock.calls[1]?.[0] as { spec: SystemTaskSpec }).spec.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('destinationDataDir');
  });

  it('projects only the non-secret upload locator from a destination transfer reservation', async () => {
    const prepareRelocationUpload = vi.fn(async () => ({
      operationId: 'remote-verify-1',
      uploadLocator: '/tmp/happier-transfer/bundle.tar',
      uploadReceipt: '11111111-1111-4111-8111-111111111111',
    }));
    const { deps } = createDeps([homeStatus], { prepareRelocationUpload });
    const output = captureStdoutJsonOutput<Record<string, unknown>>();
    try {
      await handleHomeCommand([
        'relocation-destination', 'stage', '--operation-id', 'remote-verify-1', '--prepare-upload', '--json',
      ], deps);
      expect(output.json()).toMatchObject({
        kind: 'personal_home_task_result',
        result: { data: { operationId: 'remote-verify-1', uploadLocator: '/tmp/happier-transfer/bundle.tar' } },
      });
      expect(JSON.stringify(output.json())).not.toContain('uploadReceipt');
      expect(JSON.stringify(output.json())).not.toContain('11111111-1111-4111-8111-111111111111');
    } finally {
      output.restore();
    }
  });

  it('cleans the exact destination-owned transfer reservation after a successful stage', async () => {
    const consumeRelocationUpload = vi.fn(async () => ({ archivePath: '/tmp/relocation-operation/bundle.tar' }));
    const cleanupRelocationUpload = vi.fn(async () => undefined);
    const staged = success('stage', { operationId: 'operation-1', status: 'quarantined' });
    const { deps, start } = createDeps([homeStatus, staged], { consumeRelocationUpload, cleanupRelocationUpload });

    await handleHomeCommand([
      'relocation-destination', 'stage',
      '--operation-id', 'operation-1',
      '--upload-receipt', '11111111-1111-4111-8111-111111111111',
      '--bundle-sha256', 'a'.repeat(64),
      '--expected-home-id', 'home-1',
      '--expected-canonical-server-url', 'https://source.example.test',
      '--source-descriptor-revision', '7',
      '--json',
    ], deps);

    expect(consumeRelocationUpload).toHaveBeenCalledWith({ operationId: 'operation-1', uploadReceipt: '11111111-1111-4111-8111-111111111111' });
    expect(cleanupRelocationUpload).toHaveBeenCalledTimes(1);
    expect(cleanupRelocationUpload).toHaveBeenCalledWith({ operationId: 'operation-1' });
    const params = (start.mock.calls[1]?.[0] as { spec: SystemTaskSpec }).spec.params as Record<string, unknown>;
    expect(params).toMatchObject({ operationId: 'operation-1', archivePath: '/tmp/relocation-operation/bundle.tar' });
  });

  it('still cleans the destination-owned transfer reservation when the stage task fails', async () => {
    const consumeRelocationUpload = vi.fn(async () => ({ archivePath: '/tmp/relocation-operation/bundle.tar' }));
    const cleanupRelocationUpload = vi.fn(async () => undefined);
    const { deps } = createDeps(
      [homeStatus, failure('stage', 'relocation_stage_failed', 'restore failed')],
      { consumeRelocationUpload, cleanupRelocationUpload },
    );

    await expect(handleHomeCommand([
      'relocation-destination', 'stage',
      '--operation-id', 'operation-1',
      '--upload-receipt', '11111111-1111-4111-8111-111111111111',
      '--bundle-sha256', 'a'.repeat(64),
      '--expected-home-id', 'home-1',
      '--expected-canonical-server-url', 'https://source.example.test',
      '--source-descriptor-revision', '7',
      '--json',
    ], deps)).rejects.toMatchObject({ code: 'relocation_stage_failed' });
    expect(cleanupRelocationUpload).toHaveBeenCalledTimes(1);
    expect(cleanupRelocationUpload).toHaveBeenCalledWith({ operationId: 'operation-1' });
  });

  it('surfaces cleanup attention when staging and reservation cleanup both fail', async () => {
    const consumeRelocationUpload = vi.fn(async () => ({ archivePath: '/tmp/relocation-operation/bundle.tar' }));
    const cleanupRelocationUpload = vi.fn(async () => { throw new Error('cleanup failed'); });
    const { deps } = createDeps(
      [homeStatus, failure('stage', 'relocation_stage_failed', 'restore failed')],
      { consumeRelocationUpload, cleanupRelocationUpload },
    );

    const error = await handleHomeCommand([
      'relocation-destination', 'stage',
      '--operation-id', 'operation-1',
      '--upload-receipt', '11111111-1111-4111-8111-111111111111',
      '--bundle-sha256', 'a'.repeat(64),
      '--expected-home-id', 'home-1',
      '--expected-canonical-server-url', 'https://source.example.test',
      '--source-descriptor-revision', '7',
      '--json',
    ], deps).then(() => null, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(PersonalHomeRelocationTransferCleanupError);
    expect(error).toMatchObject({ transferCleanupNeedsAttention: true });
    expect(String((error as Error).message)).not.toContain('/tmp/relocation-operation');
  });

  it('cleans the destination-owned transfer reservation when the upload cannot be consumed', async () => {
    const consumeRelocationUpload = vi.fn(async () => {
      throw new Error('Personal Home relocation upload receipt does not match the reserved transfer.');
    });
    const cleanupRelocationUpload = vi.fn(async () => undefined);
    const { deps } = createDeps([homeStatus], { consumeRelocationUpload, cleanupRelocationUpload });

    await expect(handleHomeCommand([
      'relocation-destination', 'stage',
      '--operation-id', 'operation-1',
      '--upload-receipt', '11111111-1111-4111-8111-111111111111',
      '--bundle-sha256', 'a'.repeat(64),
      '--expected-home-id', 'home-1',
      '--expected-canonical-server-url', 'https://source.example.test',
      '--source-descriptor-revision', '7',
      '--json',
    ], deps)).rejects.toThrow('does not match the reserved transfer');
    expect(cleanupRelocationUpload).toHaveBeenCalledTimes(1);
    expect(cleanupRelocationUpload).toHaveBeenCalledWith({ operationId: 'operation-1' });
  });

  it('selects the existing live task composition with explicit runtime channel and mode', async () => {
    const createRunner = vi.fn((runtime: Readonly<{ channel: 'stable' | 'preview' | 'dev'; mode: 'user' | 'system' }>) => createDeps([homeStatus, success('inspect', nonEmptyInspectionData)]).deps.createRunner(runtime));
    const deps: HomeCommandDeps = {
      ...createDeps([]).deps,
      createRunner,
    };

    await handleHomeCommand(['status', '--channel', 'preview', '--mode', 'system'], deps);

    expect(createRunner).toHaveBeenCalledWith({ channel: 'preview', mode: 'system' });
  });

  it('accepts ephemeral stdin approval only when the final owner prompt facts match exactly', async () => {
    const approved = success('erase', { outcome: 'erased', removedPaths: ['/data/home/database/home.sqlite', '/data/home/files/public'] });
    const approval = JSON.stringify({
      v: 1,
      operation: 'erase',
      canonicalServerUrl: 'http://127.0.0.1:53288',
      homeServerIdentityId: 'home-1',
      paths: ['/data/home/database/home.sqlite', '/data/home/files/public'],
      estimatedBytes: 4096,
      confirmed: true,
    });
    const { deps, respond } = createDeps([homeStatus, erasePrompt(approved)], {
      readApprovalInput: async () => approval,
    });

    await handleHomeCommand(['erase', '--approval-stdin'], deps);

    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ answer: { confirmed: true } }));
  });

  it.each([
    ['operation mismatch', JSON.stringify({ v: 1, operation: 'restore', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'home-1', paths: ['/data/home/database/home.sqlite', '/data/home/files/public'], estimatedBytes: 4096, confirmed: true })],
    ['canonical URL mismatch', JSON.stringify({ v: 1, operation: 'erase', canonicalServerUrl: 'http://127.0.0.1:9999', homeServerIdentityId: 'home-1', paths: ['/data/home/database/home.sqlite', '/data/home/files/public'], estimatedBytes: 4096, confirmed: true })],
    ['Home identity mismatch', JSON.stringify({ v: 1, operation: 'erase', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'other-home', paths: ['/data/home/database/home.sqlite', '/data/home/files/public'], estimatedBytes: 4096, confirmed: true })],
    ['path mismatch', JSON.stringify({ v: 1, operation: 'erase', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'home-1', paths: ['/data/home/database/home.sqlite'], estimatedBytes: 4096, confirmed: true })],
    ['byte estimate mismatch', JSON.stringify({ v: 1, operation: 'erase', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'home-1', paths: ['/data/home/database/home.sqlite', '/data/home/files/public'], estimatedBytes: 4097, confirmed: true })],
    ['extra field', JSON.stringify({ v: 1, operation: 'erase', canonicalServerUrl: 'http://127.0.0.1:53288', homeServerIdentityId: 'home-1', paths: ['/data/home/database/home.sqlite', '/data/home/files/public'], estimatedBytes: 4096, confirmed: true, token: 'not-accepted' })],
    ['malformed JSON', '{'],
    ['EOF', ''],
  ])('fails the final owner prompt closed for %s in ephemeral stdin approval', async (_label, approvalInput) => {
    const declined = failure('erase', 'confirmation_required', 'not confirmed');
    const { deps, respond } = createDeps([homeStatus, erasePrompt(declined)], {
      readApprovalInput: async () => approvalInput,
    });
    await expect(handleHomeCommand(['erase', '--approval-stdin'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ answer: { confirmed: false } }));
  });

  it('fails a malformed final owner erase prompt closed without consuming stdin approval', async () => {
    const declined = failure('erase', 'confirmation_required', 'not confirmed');
    const malformedPrompt: ScriptedTaskResult = {
      prompt: {
        kind: 'personal_home.confirm_erase.v1',
        data: {
          canonicalServerUrl: 'http://127.0.0.1:53288',
          homeServerIdentityId: '',
          paths: ['/data/home/database/home.sqlite'],
          estimatedBytes: 1,
        },
      },
      result: declined,
    };
    const readApprovalInput = vi.fn(async () => '{}');
    const { deps, respond } = createDeps([homeStatus, malformedPrompt], { readApprovalInput });

    await expect(handleHomeCommand(['erase', '--approval-stdin'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ answer: { confirmed: false } }));
    expect(readApprovalInput).not.toHaveBeenCalled();
  });
  it('inspects and explicitly confirms rollback recovery through the restore task kind', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const recoverable = success('inspect', { ...nonEmptyInspectionData, restoreRecovery: { status: 'rollback_available', affectedTargets: ['/data/home', '/data/home.rollback'] } });
    const recovered = success('recover', { outcome: 'rolled_back', affectedTargets: ['/data/home', '/data/home.rollback'] });
    const { deps, start } = createDeps([homeStatus, recoverable, recovered]);
    await handleHomeCommand(['recover-restore', '--yes'], deps);
    expect(start).toHaveBeenNthCalledWith(3, { spec: expect.objectContaining({
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.restore,
      params: expect.objectContaining({ action: 'recover' }),
    }) });
  });

  it('returns a stable no-op without starting recovery when no restore recovery is needed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection]);
    await handleHomeCommand(['recover-restore'], deps);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('fails closed without mutation for ambiguous restore recovery', async () => {
    const ambiguous = success('inspect', { ...nonEmptyInspectionData, restoreRecovery: { status: 'ambiguous', affectedTargets: ['/data/home'] } });
    const { deps, start } = createDeps([homeStatus, ambiguous]);
    await expect(handleHomeCommand(['recover-restore', '--yes'], deps)).rejects.toMatchObject({ code: 'restore_recovery_ambiguous' });
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('rejects completed restore finalization facts through recover-restore', async () => {
    const finalization = success('inspect', { ...nonEmptyInspectionData, restoreRecovery: { status: 'finalization_available', affectedTargets: ['/data/home', '/data/home.rollback'] } });
    const { deps, start } = createDeps([homeStatus, finalization]);

    await expect(handleHomeCommand(['recover-restore', '--yes'], deps))
      .rejects.toMatchObject({ code: 'personal_home_inspection_incomplete' });

    expect(start).toHaveBeenCalledTimes(2);
  });

  it('does not expose the removed finalize-restore command', async () => {
    const { deps, start } = createDeps([homeStatus]);

    await expect(handleHomeCommand(['finalize-restore', '--yes'], deps))
      .rejects.toThrow('Unknown home subcommand: finalize-restore');

    expect(start).toHaveBeenCalledOnce();
  });
  it('starts the exact backup task with a normalized output path and authoritative purpose', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backup = success('backup', { path: '/work/backup.tar', sha256: 'abc', manifest: { homeServerIdentityId: 'home-1' } });
    const { deps, start } = createDeps([homeStatus, backup]);

    await handleHomeCommand(['backup', '--output', './backup.tar'], deps);

    expect(start).toHaveBeenNthCalledWith(2, { spec: {
      protocolVersion: 1,
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
        outputPath: '/work/backup.tar',
      },
    } });
  });

  it('warns when backup bytes exist but the Home needs attention', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const backup = success('backup', { path: '/work/backup.tar', sha256: 'abc', homeNeedsAttention: true });
    const { deps } = createDeps([homeStatus, backup]);

    await handleHomeCommand(['backup'], deps);

    expect(output.mock.calls.flat().join('\n')).toMatch(/Home needs attention: true/iu);
  });

  it('rejects home status for a generic managed runtime before starting inspect', async () => {
    const genericStatus = success('status', { installed: true, purpose: { kind: 'generic' } });
    const { deps, start } = createDeps([genericStatus]);

    await expect(handleHomeCommand(['status'], deps)).rejects.toThrow(/not a Personal Home/i);
    expect(start).toHaveBeenCalledOnce();
  });

  it('prints an incomplete backup inventory as a lower bound', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const incompleteInspection = success('inspect', {
      ...nonEmptyInspectionData,
      storage: {
        ...(nonEmptyInspectionData.storage as SystemTaskJsonObject),
        backupsCount: 32,
        backupsCountComplete: false,
      },
    });
    const { deps } = createDeps([homeStatus, incompleteInspection]);

    await handleHomeCommand(['status'], deps);

    expect(log.mock.calls.flat().join('\n')).toContain('Backup archives: 32+');
  });

  it('verifies before restore and never starts restore when confirmation is declined', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const verified = success('verify', {
      identityMatchesCurrentHome: 'match',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' },
    });
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection, verified], {
      isInteractiveTerminal: () => true,
      promptInput: async () => 'no',
    });

    await expect(handleHomeCommand(['restore', './backup.tar'], deps)).rejects.toThrow(/not confirmed/i);
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect,
      PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup,
    ]);
  });

  it('does not start restore when the verification task fails', async () => {
    const failedVerification: SystemTaskResult = {
      protocolVersion: SYSTEM_TASK_PROTOCOL_VERSION,
      taskId: 'verify',
      ok: false,
      error: { code: 'archive_hash_mismatch', message: 'Backup verification failed.' },
    };
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection, failedVerification]);

    await expect(handleHomeCommand(['restore', './backup.tar', '--yes'], deps))
      .rejects.toMatchObject({ code: 'archive_hash_mismatch' });
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.inspect,
      PERSONAL_HOME_SYSTEM_TASK_KINDS.verifyBackup,
    ]);
  });

  it('verifies before restore and --yes starts the exact confirmed restore task', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const verified = success('verify', {
      identityMatchesCurrentHome: 'match',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' },
    });
    const restored = success('restore', { outcome: 'restored' });
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection, verified, restored]);

    await handleHomeCommand(['restore', './backup.tar', '--yes'], deps);

    expect(start).toHaveBeenNthCalledWith(4, { spec: {
      protocolVersion: 1,
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.restore,
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
        archivePath: '/work/backup.tar',
        confirmOverwrite: true,
        expectedHomeServerIdentityId: 'home-1',
      },
    } });
  });

  it('prints retained restore recovery facts and rejects a rolled-back restore outcome', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const verified = success('verify', {
      identityMatchesCurrentHome: 'match',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' },
    });
    const restored = success('restore', {
      outcome: 'rolled_back',
      error: 'activated Home identity did not match',
      rollbackPaths: ['/data/home.rollback', '/config/server.env.rollback'],
    });
    const { deps } = createDeps([homeStatus, nonEmptyInspection, verified, restored]);

    await expect(handleHomeCommand(['restore', './backup.tar', '--yes'], deps)).rejects.toMatchObject({
      code: 'personal_home_restore_incomplete',
    });
    const stdout = output.mock.calls.flat().join('\n');
    expect(stdout).toContain('Outcome: rolled_back');
    expect(stdout).toContain('Restore error: activated Home identity did not match');
    expect(stdout).toContain('Rollback retained at: /data/home.rollback');
    expect(stdout).toContain('Rollback retained at: /config/server.env.rollback');
  });

  it('requires --yes for a noninteractive restore into an owner-proven non-empty destination', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const verified = success('verify', {
      identityMatchesCurrentHome: 'match',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-1' },
    });
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection, verified]);

    await expect(handleHomeCommand(['restore', './backup.tar'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.restore)).toBe(false);
  });

  it('restores a verified archive into an owner-proven empty destination without overwrite confirmation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const verified = success('verify', {
      identityMatchesCurrentHome: 'unknown',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'home-from-backup' },
    });
    const restored = success('restore', { outcome: 'restored' });
    const { deps, start } = createDeps([homeStatus, emptyInspection, verified, restored]);

    await handleHomeCommand(['restore', './backup.tar'], deps);

    expect(start).toHaveBeenNthCalledWith(4, { spec: {
      protocolVersion: 1,
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.restore,
      params: {
        target: { kind: 'local' },
        channel: 'stable',
        mode: 'user',
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
        archivePath: '/work/backup.tar',
        expectedHomeServerIdentityId: 'home-from-backup',
      },
    } });
  });

  it('keeps a verified identity mismatch fail-closed even when the destination is empty', async () => {
    const verified = success('verify', {
      identityMatchesCurrentHome: 'mismatch',
      manifest: { format: 'happier-personal-home-backup', version: 1, homeServerIdentityId: 'other-home' },
    });
    const { deps, start } = createDeps([homeStatus, emptyInspection, verified]);

    await expect(handleHomeCommand(['restore', './backup.tar'], deps)).rejects.toMatchObject({ code: 'identity_mismatch' });
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.restore)).toBe(false);
  });

  it('noninteractive erase without --yes answers the owner prompt negatively and leaves no waiting task', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const declined = failure('erase', 'confirmation_required', 'Personal Home data deletion was not explicitly confirmed.');
    const { deps, start, respond } = createDeps([homeStatus, erasePrompt(declined)]);

    await expect(handleHomeCommand(['erase'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-2', answer: { confirmed: false } });
  });

  it('confirmed erase starts the exact erase kind', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const erased = success('erase', { removedPaths: ['/data/home'] });
    const { deps, start, respond } = createDeps([homeStatus, erasePrompt(erased)]);

    await handleHomeCommand(['erase', '--yes'], deps);
    expect(start).toHaveBeenNthCalledWith(2, { spec: expect.objectContaining({
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
      params: expect.not.objectContaining({ confirmErase: expect.anything() }),
    }) });
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-2', answer: { confirmed: true } });
  });

  it('prints partial erase facts and rejects a partial outcome', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const erased = success('erase', {
      outcome: 'partial',
      removedPaths: ['/data/home/database/home.sqlite'],
      remainingOwnedPaths: ['/data/home/files/private'],
      remainingUnknownPaths: ['/data/home/files/private/mystery'],
      stoppedRunningHome: true,
      error: 'permission denied',
    });
    const { deps } = createDeps([homeStatus, erasePrompt(erased)]);

    await expect(handleHomeCommand(['erase', '--yes'], deps)).rejects.toMatchObject({
      code: 'personal_home_erase_incomplete',
    });
    const stdout = output.mock.calls.flat().join('\n');
    expect(stdout).toContain('Erase error: permission denied');
    expect(stdout).toContain('Removed: /data/home/database/home.sqlite');
    expect(stdout).toContain('Remaining owned: /data/home/files/private');
    expect(stdout).toContain('Remaining unknown: /data/home/files/private/mystery');
    expect(stdout).toContain('Stopped running Home: true');
  });

  it('uses --yes only for erase and never adds a preliminary backup prompt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const erased = success('erase', { removedPaths: ['/data/home'] });
    const prompt = vi.fn(async () => 'yes');
    const { deps, start, respond } = createDeps([homeStatus, erasePrompt(erased)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await handleHomeCommand(['erase', '--yes'], deps);

    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(prompt).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-2', answer: { confirmed: true } });
  });

  it('rejects retired embedded backup flags and keeps backup as a separate command', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const { deps, start } = createDeps([homeStatus]);

    await expect(handleHomeCommand(['erase', '--backup-first', '--backup-output', '/safe/verified.tar', '--yes'], deps))
      .rejects.toMatchObject({ code: 'invalid_params' });

    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual(['relay.runtime.status.v1']);
  });

  it('interactive erase declines at the single exact owner-held path prompt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const answers = ['no'];
    const prompt = vi.fn(async (_message: string) => answers.shift() ?? 'no');
    const declined = failure('erase', 'confirmation_required', 'Personal Home data deletion was not explicitly confirmed.');
    const { deps, start } = createDeps([homeStatus, erasePrompt(declined)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await expect(handleHomeCommand(['erase'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(prompt.mock.calls[0]?.[0]).toContain('http://127.0.0.1:53288');
    expect(prompt.mock.calls[0]?.[0]).toContain('home-1');
    expect(prompt.mock.calls[0]?.[0]).toContain('/data/home/database/home.sqlite');
    expect(prompt.mock.calls[0]?.[0]).toContain('4096');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.backup)).toBe(false);
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.erase)).toBe(true);
  });

});
