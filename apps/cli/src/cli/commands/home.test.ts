import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYSTEM_TASK_PROTOCOL_VERSION, type SystemTaskJsonObject, type SystemTaskResult, type SystemTaskSpec } from '@happier-dev/protocol';
import { PERSONAL_HOME_SYSTEM_TASK_KINDS } from '@happier-dev/cli-common/systemTasks';
import { PersonalHomeRelocationTransferCleanupError } from '@happier-dev/cli-common/firstPartyRuntime';

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
