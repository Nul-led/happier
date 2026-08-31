import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskJsonObject, type SystemTaskResult, type SystemTaskSpec } from '@happier-dev/protocol';
import { PERSONAL_HOME_SYSTEM_TASK_KINDS } from '@happier-dev/cli-common/systemTasks';

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
  it('selects the existing live task composition with explicit runtime channel and mode', async () => {
    const createRunner = vi.fn((runtime: Readonly<{ channel: 'stable' | 'preview' | 'dev'; mode: 'user' | 'system' }>) => createDeps([homeStatus, success('inspect', nonEmptyInspectionData)]).deps.createRunner(runtime));
    const deps: HomeCommandDeps = {
      ...createDeps([]).deps,
      createRunner,
    };

    await handleHomeCommand(['status', '--channel', 'preview', '--mode', 'system'], deps);

    expect(createRunner).toHaveBeenCalledWith({ channel: 'preview', mode: 'system' });
  });

  it('fails the final owner prompt closed when a remote erase confirmation token mismatches', async () => {
    const declined = failure('erase', 'confirmation_required', 'not confirmed');
    const { deps, respond } = createDeps([homeStatus, erasePrompt(declined)]);
    await expect(handleHomeCommand(['erase', '--confirmation-token', '0'.repeat(64)], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ answer: { confirmed: false } }));
  });

  it('fails a malformed final owner erase prompt closed without accepting its token', async () => {
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
    const { deps, respond } = createDeps([homeStatus, malformedPrompt]);

    await expect(handleHomeCommand(['erase', '--confirmation-token', '0'.repeat(64)], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ answer: { confirmed: false } }));
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
  it('keeps completed restore rollback reachable through recover-restore', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const finalization = success('inspect', { ...nonEmptyInspectionData, restoreRecovery: { status: 'finalization_available', affectedTargets: ['/data/home', '/data/home.rollback'] } });
    const recovered = success('recover', { outcome: 'rolled_back', restartedHome: true });
    const { deps, start } = createDeps([homeStatus, finalization, recovered]);

    await handleHomeCommand(['recover-restore', '--yes'], deps);

    expect(start).toHaveBeenNthCalledWith(3, { spec: expect.objectContaining({
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.restore,
      params: expect.objectContaining({ action: 'recover' }),
    }) });
  });

  it('inspects completed restore facts, confirms, and finalizes through the restore task kind', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const finalization = success('inspect', { ...nonEmptyInspectionData, restoreRecovery: { status: 'finalization_available', affectedTargets: ['/data/home', '/data/home.rollback'] } });
    const finalized = success('finalize', { outcome: 'finalized', removedPaths: ['/data/home.rollback'] });
    const { deps, start } = createDeps([homeStatus, finalization, finalized]);

    await handleHomeCommand(['finalize-restore', '--yes'], deps);

    expect(log.mock.calls.flat().join('\n')).toContain('/data/home.rollback');
    expect(start).toHaveBeenNthCalledWith(3, { spec: expect.objectContaining({
      kind: PERSONAL_HOME_SYSTEM_TASK_KINDS.restore,
      params: expect.objectContaining({ action: 'finalize' }),
    }) });
  });

  it('refuses restore finalization unless inspection proves completed retained material', async () => {
    const { deps, start } = createDeps([homeStatus, nonEmptyInspection]);

    await expect(handleHomeCommand(['finalize-restore', '--yes'], deps)).rejects.toMatchObject({ code: 'restore_finalization_unavailable' });
    expect(start).toHaveBeenCalledTimes(2);
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
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
        outputPath: '/work/backup.tar',
      },
    } });
  });

  it('rejects home status for a generic managed runtime before starting inspect', async () => {
    const genericStatus = success('status', { installed: true, purpose: { kind: 'generic' } });
    const { deps, start } = createDeps([genericStatus]);

    await expect(handleHomeCommand(['status'], deps)).rejects.toThrow(/not a Personal Home/i);
    expect(start).toHaveBeenCalledOnce();
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
        purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
        archivePath: '/work/backup.tar',
        confirmOverwrite: true,
        expectedHomeServerIdentityId: 'home-1',
      },
    } });
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

  it('does not treat --yes as backup consent while keeping the interactive backup offer', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const erased = success('erase', { removedPaths: ['/data/home'] });
    const prompt = vi.fn(async () => 'no');
    const { deps, start, respond } = createDeps([homeStatus, erasePrompt(erased)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await handleHomeCommand(['erase', '--yes'], deps);

    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(prompt).toHaveBeenCalledOnce();
    expect(prompt.mock.calls[0]?.[0]).toMatch(/verified Personal Home backup/i);
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-2', answer: { confirmed: true } });
  });

  it('creates a verified external backup before noninteractive erase only with --backup-first and --backup-output', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backup = success('backup', { path: '/safe/verified.tar', sha256: 'abc', manifest: { homeServerIdentityId: 'home-1' } });
    const erased = success('erase', { removedPaths: ['/data/home'] });
    const { deps, start, respond } = createDeps([homeStatus, backup, erasePrompt(erased)]);

    await handleHomeCommand(['erase', '--backup-first', '--backup-output', '/safe/verified.tar', '--yes'], deps);

    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(start.mock.calls[1]?.[0].spec.params).toEqual(expect.objectContaining({ outputPath: '/safe/verified.tar', intent: 'erase-safety' }));
    expect(respond).toHaveBeenCalledWith({ taskId: 'task-3', answer: { confirmed: true } });
  });

  it('refuses a safety backup inside any canonical erase or configuration root', async () => {
    const rejected = failure('backup', 'unsafe_data_root', 'outside Home roots');
    const { deps, start } = createDeps([homeStatus, rejected]);

    await expect(handleHomeCommand(['erase', '--backup-first', '--backup-output', '/data/home/backups/will-be-erased.tar', '--yes'], deps))
      .rejects.toMatchObject({ code: 'unsafe_data_root' });
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
    ]);
  });

  it('interactive erase can skip backup and declines only at the exact owner-held path prompt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const answers = ['no', 'no'];
    const prompt = vi.fn(async (_message: string) => answers.shift() ?? 'no');
    const declined = failure('erase', 'confirmation_required', 'Personal Home data deletion was not explicitly confirmed.');
    const { deps, start } = createDeps([homeStatus, erasePrompt(declined)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await expect(handleHomeCommand(['erase'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(prompt.mock.calls[1]?.[0]).toContain('/data/home/database/home.sqlite');
    expect(prompt.mock.calls[1]?.[0]).toContain('4096');
    expect(prompt).toHaveBeenCalledTimes(2);
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.backup)).toBe(false);
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.erase)).toBe(true);
  });

  it('interactive erase creates a verified backup first and then declines the owner-held erase prompt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backup = success('backup', { path: '/safe/verified.tar', sha256: 'abc', manifest: { homeServerIdentityId: 'home-1' } });
    const answers = ['yes', '/safe/verified.tar', 'no'];
    const prompt = vi.fn(async (_message: string) => answers.shift() ?? 'no');
    const declined = failure('erase', 'confirmation_required', 'Personal Home data deletion was not explicitly confirmed.');
    const { deps, start } = createDeps([homeStatus, backup, erasePrompt(declined)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await expect(handleHomeCommand(['erase'], deps)).rejects.toMatchObject({ code: 'confirmation_required' });
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(prompt).toHaveBeenCalledTimes(3);
  });

  it('interactive erase starts only after verified backup and final explicit confirmation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const backup = success('backup', { path: '/safe/verified.tar', sha256: 'abc', manifest: { homeServerIdentityId: 'home-1' } });
    const erased = success('erase', { removedPaths: ['/data/home/database/home.sqlite'] });
    const answers = ['yes', '/safe/verified.tar', 'yes'];
    const prompt = vi.fn(async (_message: string) => answers.shift() ?? 'no');
    const { deps, start } = createDeps([homeStatus, backup, erasePrompt(erased)], {
      isInteractiveTerminal: () => true,
      promptInput: prompt,
    });

    await handleHomeCommand(['erase'], deps);
    expect(start.mock.calls.map(([input]) => input.spec.kind)).toEqual([
      'relay.runtime.status.v1',
      PERSONAL_HOME_SYSTEM_TASK_KINDS.backup,
      PERSONAL_HOME_SYSTEM_TASK_KINDS.erase,
    ]);
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(prompt.mock.calls[2]?.[0]).toContain('/data/home/database/home.sqlite');
    expect(prompt.mock.calls[2]?.[0]).toContain('/data/home/files/public');
    expect(prompt.mock.calls[2]?.[0]).toContain('4096');
  });

  it('fails relocation before the relocation task when the canonical target resolver is unavailable', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const inspected = success('inspect', { identity: { homeServerIdentityId: 'home-1' } });
    const { deps, start } = createDeps([homeStatus, inspected]);

    await expect(handleHomeCommand(['relocate', '--target', 'machine-2', '--yes'], deps))
      .rejects.toThrow(/destination descriptor resolver is unavailable/i);
    expect(start.mock.calls.some(([input]) => input.spec.kind === PERSONAL_HOME_SYSTEM_TASK_KINDS.relocate)).toBe(false);
  });

  it('relocation passes only canonical destination target facts and no callbacks', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const inspected = success('inspect', { identity: { homeServerIdentityId: 'home-1' } });
    const relocated = success('relocate', { homeServerIdentityId: 'home-1', destinationVerified: true });
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'home-1',
      canonicalServerUrl: 'https://home-2.example.test',
      revision: 1,
      endpoints: [{ kind: 'https' as const, url: 'https://home-2.example.test' }],
    };
    const { deps, start } = createDeps([homeStatus, inspected, relocated], {
      resolveRelocationDestination: async (targetId) => ({ targetId, descriptor }),
    });

    await handleHomeCommand(['relocate', '--target', 'machine-2', '--yes'], deps);

    const params = start.mock.calls[2]?.[0].spec.params;
    expect(params).toEqual({
      target: { kind: 'local' },
      purpose: { kind: 'personal-home', canonicalServerUrl: 'http://127.0.0.1:53288' },
      destination: { targetId: 'machine-2', descriptor },
    });
    expect(JSON.stringify(params)).not.toMatch(/callback|transfer|commit/i);
  });
});
