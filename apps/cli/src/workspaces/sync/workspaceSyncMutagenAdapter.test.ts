import { describe, expect, it, vi } from 'vitest';

import { deriveWorkspaceSyncEndpointId } from './transport/workspaceSyncBrokerProtocol';
import { createWorkspaceSyncMutagenAdapter } from './workspaceSyncMutagenAdapter';
import { computeWorkspaceSyncPolicyDigest } from './workspaceSyncTypes';

const policyInput = { v: 1 as const, selection: 'all_files' as const, extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false };
const relationship = {
  v: 1 as const, relationshipId: 'r1', controllerMachineId: 'm1', alphaWorkspaceRefId: 'a', betaWorkspaceRefId: 'b',
  mode: 'keep_synced' as const, contentPolicy: { ...policyInput, policyDigest: computeWorkspaceSyncPolicyDigest(policyInput) },
  enabled: true, createdAtMs: 1, updatedAtMs: 1,
};

const copyOnceOperation = {
  v: 1 as const, operationId: 'copy-1', controllerMachineId: 'm1', alphaWorkspaceRefId: 'a', betaWorkspaceRefId: 'b',
  contentPolicy: { ...policyInput, policyDigest: computeWorkspaceSyncPolicyDigest(policyInput) },
};

function labelsFor(id: string) {
  return {
    'external.owner': 'happier-workspace-sync',
    'external.relationship_id': id,
    'external.endpoint_role': 'alpha|beta',
    'external.schema': 'workspace-sync-v1',
    'external.policy_digest': relationship.contentPolicy.policyDigest,
    'external.alpha_workspace_ref_id': 'a',
    'external.beta_workspace_ref_id': 'b',
    'external.controller_machine_id': 'm1',
    'external.operation_kind': id.startsWith('copy-') ? 'copy_once' : 'relationship',
    'external.policy_selection': 'all_files',
    'external.include_git_directory': 'false',
  };
}

function genericSession(overrides: Record<string, unknown> = {}) {
  return {
    identifier: 'mutagen-session-1',
    name: 'r1',
    labels: labelsFor('r1'),
    alpha: { protocol: 'external', host: deriveWorkspaceSyncEndpointId('r1', 'alpha'), path: '', connected: true, scanned: true },
    beta: { protocol: 'external', host: deriveWorkspaceSyncEndpointId('r1', 'beta'), path: '', connected: true, scanned: true },
    mode: 'one-way-safe', paused: false, status: 'watching', successfulCycles: 1, conflicts: [], excludedConflicts: 0,
    ignore: { paths: ['.git/'] },
    ...overrides,
  };
}

function genericSessionFor(id: string, overrides: Record<string, unknown> = {}) {
  return genericSession({
    identifier: `mutagen-${id}`,
    name: id,
    labels: labelsFor(id),
    alpha: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(id, 'alpha'), path: '', connected: true, scanned: true },
    beta: { protocol: 'external', host: deriveWorkspaceSyncEndpointId(id, 'beta'), path: '', connected: true, scanned: true },
    ...overrides,
  });
}

describe('WorkspaceSyncMutagenAdapterClient', () => {
  it('rehydrates and lists more than 32 valid claimed sessions', async () => {
    const definitions = Array.from({ length: 33 }, (_, index) => ({
      ...relationship,
      relationshipId: `r${index + 1}`,
    }));
    const listed = definitions.map((definition) => genericSessionFor(definition.relationshipId));
    const adapter = createWorkspaceSyncMutagenAdapter({
      send: vi.fn(async () => listed),
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.rehydrate(definitions)).resolves.toHaveLength(33);
    await expect(adapter.list()).resolves.toHaveLength(33);
  });

  it('accepts the fork DTO shape for external://opaque-id without a persisted path', async () => {
    const send = vi.fn(async (command: { t: string }) => command.t === 'list' ? [] : genericSession({
      alpha: {
        protocol: 'external', host: deriveWorkspaceSyncEndpointId('r1', 'alpha'), path: '',
        connected: true, scanned: true,
      },
      beta: {
        protocol: 'external', host: deriveWorkspaceSyncEndpointId('r1', 'beta'), path: '',
        connected: true, scanned: true,
      },
    }));
    const adapter = createWorkspaceSyncMutagenAdapter({
      send,
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure(relationship)).resolves.toMatchObject({ relationshipId: 'r1' });
  });

  it('creates a persistent session paused, resumes it, then projects the bounded generic Session', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command);
      if (command.t === 'list') return [];
      return genericSession(command.t === 'create'
        ? { paused: true, status: 'disconnected', successfulCycles: 0 }
        : undefined);
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1', nowMs: () => 1234,
      resolveWorkspaceRef: async (id) => ({ machineId: id === 'a' ? 'm1' : 'm2', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure(relationship)).resolves.toEqual({
      relationshipId: 'r1', controllerMachineId: 'm1', state: 'watching', alphaPath: '/a', betaPath: '/b',
      mode: 'keep_synced', changedFiles: 0, conflictCount: 0, lastSuccessfulSyncAtMs: 1234,
    });
    expect(commands).toEqual([
      { t: 'list', requestId: 'request-1' },
      {
        t: 'create', requestId: 'request-1',
        session: {
          alpha: `external://${deriveWorkspaceSyncEndpointId('r1', 'alpha')}`,
          beta: `external://${deriveWorkspaceSyncEndpointId('r1', 'beta')}`,
          mode: 'one-way-safe',
          contentPolicy: { selection: 'all_files', extraIgnorePatterns: [], extraIncludePatterns: [], includeGitDirectory: false },
          name: 'r1',
          labels: {
            'external.owner': 'happier-workspace-sync',
            'external.relationship_id': 'r1',
            'external.endpoint_role': 'alpha|beta',
            'external.schema': 'workspace-sync-v1',
            'external.policy_digest': relationship.contentPolicy.policyDigest,
            'external.alpha_workspace_ref_id': 'a',
            'external.beta_workspace_ref_id': 'b',
            'external.controller_machine_id': 'm1',
            'external.operation_kind': 'relationship',
            'external.policy_selection': 'all_files',
            'external.include_git_directory': 'false',
          },
        },
      },
      { t: 'resume', requestId: 'request-1', sessionIdentifier: 'mutagen-session-1' },
    ]);
  });

  it('adopts one exact existing session and does not create a duplicate', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command);
      if (command.t === 'list') return [genericSession()];
      return genericSession();
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure(relationship)).resolves.toMatchObject({ relationshipId: 'r1', state: 'watching' });
    expect(commands).toEqual([{ t: 'list', requestId: 'request-1' }]);
  });

  it('refuses restart adoption when persisted labels do not prove current policy and endpoint identity', async () => {
    const send = vi.fn(async (command: { t: string }) => command.t === 'list'
      ? [genericSession({ labels: {
        'external.owner': 'happier-workspace-sync',
        'external.relationship_id': 'r1',
        'external.endpoint_role': 'alpha|beta',
        'external.schema': 'workspace-sync-v1',
      } })]
      : genericSession());
    const adapter = createWorkspaceSyncMutagenAdapter({
      send,
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure(relationship)).rejects.toMatchObject({ code: 'relationship_runtime_mismatch' });
    expect(send.mock.calls.map(([command]) => command.t)).toEqual(['list', 'terminate']);
  });

  it('fails closed when ensure discovers multiple or conflicting sessions for one product identity', async () => {
    for (const { sessions, expectedCode, expectedCommands } of [
      { sessions: [genericSession(), genericSession({ identifier: 'mutagen-session-2' })], expectedCode: 'relationship_definition_conflict', expectedCommands: 1 },
      { sessions: [genericSession({ mode: 'two-way-safe' })], expectedCode: 'relationship_runtime_mismatch', expectedCommands: 2 },
    ]) {
      const send = vi.fn(async (command: { t: string }) => command.t === 'list' ? sessions : genericSession());
      const adapter = createWorkspaceSyncMutagenAdapter({
        send, createRequestId: () => 'request-1',
        resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
      });

      await expect(adapter.ensure(relationship)).rejects.toMatchObject({ code: expectedCode });
      expect(send).toHaveBeenCalledTimes(expectedCommands);
    }
  });

  it('implements copy_once with a temporary generic session and engine-owned identifier', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command);
      if (command.t === 'list') return [];
      return genericSessionFor('copy-1', {
        identifier: 'mutagen-copy-session',
        paused: command.t === 'create',
        status: command.t === 'create' ? 'disconnected' : 'watching',
      });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });
    await expect(adapter.copyOnce(copyOnceOperation)).resolves.toMatchObject({ relationshipId: 'copy-1', mode: 'copy_once' });
    expect(commands.map((command) => (command as { t: string }).t)).toEqual(['list', 'create', 'resume', 'flush', 'terminate']);
    expect(commands.slice(2)).toEqual([
      { t: 'resume', requestId: 'request-1', sessionIdentifier: 'mutagen-copy-session' },
      { t: 'flush', requestId: 'request-1', sessionIdentifier: 'mutagen-copy-session' },
      { t: 'terminate', requestId: 'request-1', sessionIdentifier: 'mutagen-copy-session' },
    ]);
  });

  it('treats an exact copy_once session with a completed cycle as the recovered result', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const completed = genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      paused: false,
      status: 'watching',
      successfulCycles: 1,
    });
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list' ? [completed] : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1', nowMs: () => 1234,
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.copyOnce(copyOnceOperation)).resolves.toMatchObject({
      relationshipId: 'copy-1',
      lastSuccessfulSyncAtMs: 1234,
    });
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-copy-session'],
    ]);
  });

  it('discovers an exact persisted copy_once definition for restart recovery', async () => {
    const persisted = genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      labels: {
        ...labelsFor('copy-1'),
        'external.operation_kind': 'copy_once',
        'external.policy_selection': 'all_files',
        'external.include_git_directory': 'false',
      },
      ignore: { paths: ['.git/'] },
      paused: true,
      status: 'disconnected',
      successfulCycles: 0,
    });
    const send = vi.fn(async (command: { t: string }) => command.t === 'list' ? [persisted] : null);
    const adapter = createWorkspaceSyncMutagenAdapter({
      send,
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.discoverCopyOnceRecoveries()).resolves.toEqual([copyOnceOperation]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('terminates a claimed restart copy without sufficient exact policy labels', async () => {
    const persisted = genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      labels: {
        ...labelsFor('copy-1'),
        'external.operation_kind': 'copy_once',
        'external.policy_selection': 'all_files',
        'external.include_git_directory': 'false',
        'external.policy_digest': '0'.repeat(64),
      },
      paused: true,
      status: 'disconnected',
      successfulCycles: 0,
    });
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list' ? [persisted] : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send,
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.discoverCopyOnceRecoveries()).resolves.toEqual([]);
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-copy-session'],
    ]);
  });

  it('adopts an exact operation-tagged copy_once session instead of creating a duplicate', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const existing = genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      paused: true,
      status: 'disconnected',
      successfulCycles: 0,
    });
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      if (command.t === 'list') return [existing];
      return genericSessionFor('copy-1', {
        identifier: 'mutagen-copy-session',
        paused: false,
        status: 'watching',
        successfulCycles: command.t === 'flush' ? 1 : 0,
      });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.copyOnce(copyOnceOperation)).resolves.toMatchObject({
      relationshipId: 'copy-1',
      mode: 'copy_once',
    });
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['resume', 'mutagen-copy-session'],
      ['flush', 'mutagen-copy-session'],
      ['terminate', 'mutagen-copy-session'],
    ]);
  });

  it('retains and discovers an exact copy_once session after an indeterminate create response, then adopts it on retry', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    let created = false;
    const createdSession = genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      paused: true,
      status: 'disconnected',
      successfulCycles: 0,
    });
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      if (command.t === 'list') return created ? [createdSession] : [];
      if (command.t === 'create') {
        created = true;
        throw Object.assign(new Error('Create result was lost'), { code: 'indeterminate' });
      }
      if (command.t === 'terminate') {
        created = false;
        return null;
      }
      return genericSessionFor('copy-1', {
        identifier: 'mutagen-copy-session',
        paused: false,
        status: 'watching',
        successfulCycles: command.t === 'flush' ? 1 : 0,
      });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.copyOnce(copyOnceOperation)).rejects.toMatchObject({ code: 'indeterminate' });
    expect(created).toBe(true);
    await expect(adapter.get('copy-1')).resolves.toMatchObject({
      relationshipId: 'copy-1',
      mode: 'copy_once',
    });
    await expect(adapter.copyOnce(copyOnceOperation)).resolves.toMatchObject({
      relationshipId: 'copy-1',
      mode: 'copy_once',
    });
    expect(created).toBe(false);
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['create', undefined],
      ['list', undefined],
      ['get', 'mutagen-copy-session'],
      ['list', undefined],
      ['resume', 'mutagen-copy-session'],
      ['flush', 'mutagen-copy-session'],
      ['terminate', 'mutagen-copy-session'],
    ]);
  });

  it('keeps a completed copy_once recoverable until terminal session cleanup succeeds', async () => {
    const commands: string[] = [];
    let created = false;
    let terminateAttempts = 0;
    const completed = () => genericSessionFor('copy-1', {
      identifier: 'mutagen-copy-session',
      paused: false,
      status: 'watching',
      successfulCycles: 1,
    });
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command.t);
      if (command.t === 'list') return created ? [completed()] : [];
      if (command.t === 'create') {
        created = true;
        return genericSessionFor('copy-1', {
          identifier: 'mutagen-copy-session', paused: true, status: 'disconnected', successfulCycles: 0,
        });
      }
      if (command.t === 'terminate') {
        terminateAttempts += 1;
        if (terminateAttempts === 1) throw Object.assign(new Error('sidecar unavailable before cleanup dispatch'), { code: 'agent_unavailable' });
        created = false;
        return null;
      }
      return completed();
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send,
      createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.copyOnce(copyOnceOperation)).rejects.toMatchObject({ code: 'indeterminate' });
    expect(created).toBe(true);
    await expect(adapter.copyOnce(copyOnceOperation)).resolves.toMatchObject({ relationshipId: 'copy-1', mode: 'copy_once' });
    expect(created).toBe(false);
    expect(commands.filter((command) => command === 'create')).toHaveLength(1);
    expect(commands.filter((command) => command === 'terminate')).toHaveLength(2);
  });

  it.each([
    ['multiple', [
      genericSessionFor('copy-1', { identifier: 'mutagen-copy-1' }),
      genericSessionFor('copy-1', { identifier: 'mutagen-copy-2' }),
    ]],
    ['mismatched', [genericSessionFor('copy-1', { mode: 'two-way-safe' })]],
  ] as const)('fails closed on %s operation-tagged copy_once sessions', async (_case, sessions) => {
    const commands: Array<{ t: string }> = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command);
      return command.t === 'list' ? sessions : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.copyOnce(copyOnceOperation)).rejects.toMatchObject({ code: 'relationship_definition_conflict' });
    expect(commands.some(({ t }) => t === 'create' || t === 'terminate')).toBe(false);
  });

  it.each([
    ['keep_synced', 'one-way-safe'],
    ['mirror_exactly', 'one-way-replica'],
    ['keep_both_in_sync', 'two-way-safe'],
  ] as const)('maps product mode %s at the TypeScript adapter boundary', async (productMode, mutagenMode) => {
    const commands: Array<{ t: string; session?: { mode: string } }> = [];
    const send = vi.fn(async (command: { t: string; session?: { mode: string } }) => {
      commands.push(command);
      if (command.t === 'list') return [];
      return genericSession({ mode: mutagenMode });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await adapter.ensure({ ...relationship, mode: productMode });
    expect(commands[1]?.session?.mode).toBe(mutagenMode);
  });

  it('uses the runtime identifier for bounded conflict listing and validates the fork counts', async () => {
    const commands: unknown[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command);
      if (command.t === 'list') return [];
      if (command.t === 'list_conflicts') {
        return { totalCount: 3, shownCount: 1, truncatedCount: 2, conflicts: [{ root: 'src/a.ts', alphaChanges: [], betaChanges: [] }] };
      }
      return genericSession();
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await adapter.ensure(relationship);
    await expect(adapter.listConflicts('r1')).resolves.toMatchObject({ totalCount: 3, shownCount: 1, truncatedCount: 2 });
    expect(commands.at(-1)).toEqual({ t: 'list_conflicts', requestId: 'request-1', sessionIdentifier: 'mutagen-session-1', limit: 100 });
  });

  it('terminates a claimed session whose exact labels or opaque endpoints do not match settings before reporting the mismatch', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list'
        ? [genericSession({ labels: { 'external.owner': 'other' } })]
        : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1', nowMs: () => 1234,
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });
    await expect(adapter.ensure(relationship)).rejects.toMatchObject({ code: 'relationship_runtime_mismatch' });
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-session-1'],
    ]);
  });

  it('surfaces claimed-session cleanup failure and never creates a replacement beside it', async () => {
    const commands: string[] = [];
    const cleanupFailure = Object.assign(new Error('manager refused termination'), { code: 'engine_cleanup_failed' });
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command.t);
      if (command.t === 'list') return [genericSession({ mode: 'one-way-replica' })];
      if (command.t === 'terminate') throw cleanupFailure;
      return genericSession();
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure(relationship)).rejects.toBe(cleanupFailure);
    expect(commands).toEqual(['list', 'terminate']);
  });

  it('rehydrates exact settings-owned sessions and terminates stale manager state', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list'
        ? [genericSessionFor('r1'), genericSessionFor('stale')]
        : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.rehydrate([relationship])).resolves.toEqual([
      expect.objectContaining({ relationshipId: 'r1', state: 'watching' }),
    ]);
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-stale'],
    ]);
  });

  it('adopts a disabled relationship as paused and resumes it only after settings re-enable it', async () => {
    let paused = false;
    const commands: string[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command.t);
      if (command.t === 'list') return [genericSessionFor('r1', { paused })];
      if (command.t === 'pause') paused = true;
      if (command.t === 'resume') paused = false;
      return genericSessionFor('r1', { paused });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.rehydrate([{ ...relationship, enabled: false }])).resolves.toEqual([
      expect.objectContaining({ relationshipId: 'r1', state: 'paused' }),
    ]);
    expect(commands).toEqual(['list', 'pause']);

    commands.length = 0;
    await expect(adapter.rehydrate([{ ...relationship, enabled: true }])).resolves.toEqual([
      expect.objectContaining({ relationshipId: 'r1', state: 'watching' }),
    ]);
    expect(commands).toEqual(['list', 'resume']);
  });

  it('creates a missing disabled relationship in the paused state without resuming it', async () => {
    let created = false;
    const commands: string[] = [];
    const send = vi.fn(async (command: { t: string }) => {
      commands.push(command.t);
      if (command.t === 'list') return created ? [genericSessionFor('r1', { paused: true })] : [];
      if (command.t === 'create') {
        created = true;
        return genericSessionFor('r1', { paused: true, status: 'disconnected' });
      }
      return genericSessionFor('r1', { paused: true });
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.ensure({ ...relationship, enabled: false })).resolves.toMatchObject({ state: 'paused' });
    expect(commands).toEqual(['list', 'create']);
  });

  it('recreates a settings relationship when persisted Mutagen mode no longer matches', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list'
        ? [genericSessionFor('r1', { mode: 'two-way-safe' })]
        : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.rehydrate([relationship])).resolves.toEqual([]);
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-r1'],
    ]);
  });

  it('terminates a persisted relationship claimant with mismatched ownership labels during rehydration', async () => {
    const commands: Array<{ t: string; sessionIdentifier?: string }> = [];
    const send = vi.fn(async (command: { t: string; sessionIdentifier?: string }) => {
      commands.push(command);
      return command.t === 'list'
        ? [genericSessionFor('r1', { labels: { ...genericSessionFor('r1').labels, 'external.owner': 'other' } })]
        : null;
    });
    const adapter = createWorkspaceSyncMutagenAdapter({
      send, createRequestId: () => 'request-1',
      resolveWorkspaceRef: async (id) => ({ machineId: 'm1', rootPath: `/${id}` }),
    });

    await expect(adapter.rehydrate([relationship])).resolves.toEqual([]);
    expect(commands.map(({ t, sessionIdentifier }) => [t, sessionIdentifier])).toEqual([
      ['list', undefined],
      ['terminate', 'mutagen-r1'],
    ]);
  });
});
