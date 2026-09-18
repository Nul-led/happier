import { describe, expect, it, vi } from 'vitest';

import {
  computeWorkspaceSyncPolicyDigest,
  type AccountSettingsMutationResult,
  type WorkspaceSyncStatusV1,
} from '@happier-dev/protocol';

import {
  createWorkspaceSyncRelationshipOwner,
  type WorkspaceSyncRelationshipSettingsMutation,
} from './workspaceSyncRelationshipOwner';

const policy = Object.freeze({
  v: 1 as const,
  selection: 'all_files' as const,
  extraIgnorePatterns: Object.freeze([]),
  extraIncludePatterns: Object.freeze([]),
  policyDigest: computeWorkspaceSyncPolicyDigest({
    v: 1,
    selection: 'all_files',
    extraIgnorePatterns: [],
    extraIncludePatterns: [],
  }),
});

function status(id: string): WorkspaceSyncStatusV1 {
  return {
    relationshipId: id,
    controllerMachineId: 'machine_source',
    state: 'watching',
    alphaPath: '/source',
    betaPath: '/target',
    mode: 'keep_synced',
    changedFiles: 0,
    conflictCount: 0,
    lastSuccessfulSyncAtMs: 1,
  };
}

function createHarness() {
  let settings: Readonly<Record<string, unknown>> = { workspaceRefsV1: [], workspaceSyncRelationshipsV1: [] };
  let returnOutcomeUnknownAfterApplying = false;
  let returnOutcomeUnknownWithoutApplying = false;
  let failNextRead = false;
  const mutateSettings: WorkspaceSyncRelationshipSettingsMutation = vi.fn(async (mutate) => {
    if (returnOutcomeUnknownWithoutApplying) {
      returnOutcomeUnknownWithoutApplying = false;
      return { status: 'outcomeUnknown', lastKnownVersion: 1 } satisfies AccountSettingsMutationResult;
    }
    settings = await mutate(settings);
    if (returnOutcomeUnknownAfterApplying) {
      returnOutcomeUnknownAfterApplying = false;
      return { status: 'outcomeUnknown', lastKnownVersion: 1 } satisfies AccountSettingsMutationResult;
    }
    return { status: 'applied', version: 1, settings: settings as never } satisfies AccountSettingsMutationResult;
  });
  const ensureRelationship = vi.fn(async (definition) => status(definition.relationshipId));
  const flushRelationship = vi.fn(async (id: string) => status(id));
  const terminateRelationshipRuntime = vi.fn(async () => undefined);
  const commitRelationshipTarget = vi.fn(async () => undefined);
  const waitForSettingsReconciliation = vi.fn(async (_settingsVersion: number, _signal?: AbortSignal) => undefined);
  const owner = createWorkspaceSyncRelationshipOwner({
    localMachineId: 'machine_source',
    mutateSettings,
    readSettings: async () => {
      if (failNextRead) {
        failNextRead = false;
        throw new Error('settings read unavailable');
      }
      return settings;
    },
    ensureRelationship,
    flushRelationship,
    terminateRelationshipRuntime,
    commitRelationshipTarget,
    waitForSettingsReconciliation,
    createId: (() => {
      const values = ['source_ref', 'target_ref'];
      return () => values.shift() ?? 'unexpected_id';
    })(),
    deriveRelationshipId: (operationId) => operationId === 'handoff_1' ? 'relationship_1' : `relationship_${operationId}`,
    nowMs: () => 100,
  });
  return {
    owner,
    read: () => settings,
    mutateSettings,
    ensureRelationship,
    flushRelationship,
    terminateRelationshipRuntime,
    commitRelationshipTarget,
    waitForSettingsReconciliation,
    applyNextMutationWithUnknownOutcome: () => { returnOutcomeUnknownAfterApplying = true; },
    loseNextMutationOutcomeWithoutApplying: () => { returnOutcomeUnknownWithoutApplying = true; },
    failNextSettingsRead: () => { failNextRead = true; },
  };
}

const createInput = {
  operationId: 'handoff_1',
  serverId: 'server_a',
  sourceMachineId: 'machine_source',
  sourceRootPath: '/source',
  targetMachineId: 'machine_target',
  targetRootPath: '/target',
  mode: 'keep_synced' as const,
  contentPolicy: policy,
  targetBootstrap: 'use_existing' as const,
  flushBeforeCommit: true as const,
};

describe('WorkspaceSyncRelationshipOwner', () => {
  it('persists and reconciles disabled intent before target preparation, then enables only after READY commit', async () => {
    const harness = createHarness();
    let relationshipAtEnsure: unknown;
    let reconciliationsAtEnsure = 0;
    harness.ensureRelationship.mockImplementationOnce(async (definition) => {
      relationshipAtEnsure = (harness.read().workspaceSyncRelationshipsV1 as readonly unknown[])[0];
      reconciliationsAtEnsure = harness.waitForSettingsReconciliation.mock.calls.length;
      return status(definition.relationshipId);
    });
    const prepared = await harness.owner.prepareCreate(createInput);

    expect(harness.ensureRelationship).toHaveBeenCalledOnce();
    expect(harness.ensureRelationship).toHaveBeenCalledWith(
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: true }),
      undefined,
      expect.objectContaining({ transient: true }),
    );
    expect(harness.flushRelationship).toHaveBeenCalledWith('relationship_1', undefined);
    expect(relationshipAtEnsure).toEqual(expect.objectContaining({
      relationshipId: 'relationship_1',
      enabled: false,
    }));
    expect(reconciliationsAtEnsure).toBeGreaterThanOrEqual(2);
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: false }),
    ]);

    await prepared.commit();
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({
        relationshipId: 'relationship_1',
        alphaWorkspaceRefId: 'source_ref',
        betaWorkspaceRefId: 'target_ref',
        enabled: true,
      }),
    ]);
    expect(harness.commitRelationshipTarget).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'relationship_1' }));
  });

  it('keeps the durable relationship disabled until target READY commit succeeds', async () => {
    const harness = createHarness();
    const crashAtTargetCommit = new Error('injected process loss before target READY');
    let relationshipAtTargetCommit: unknown;
    harness.commitRelationshipTarget.mockImplementationOnce(async () => {
      relationshipAtTargetCommit = (harness.read().workspaceSyncRelationshipsV1 as readonly unknown[])[0];
      throw crashAtTargetCommit;
    });
    const prepared = await harness.owner.prepareCreate(createInput);

    await expect(prepared.commit()).rejects.toBe(crashAtTargetCommit);
    expect(relationshipAtTargetCommit).toEqual(expect.objectContaining({
      relationshipId: 'relationship_1',
      enabled: false,
    }));
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: false }),
    ]);
  });

  it('reuses only the exact Action-derived relationship and requires replacement for an occupied endpoint pair', async () => {
    const harness = createHarness();
    const first = await harness.owner.prepareCreate(createInput);
    await first.commit();
    const exact = await harness.owner.prepareCreate(createInput);
    expect(exact.relationship.relationshipId).toBe('relationship_1');
    expect(exact.reused).toBe(true);

    await expect(harness.owner.prepareCreate({ ...createInput, operationId: 'handoff_2' }))
      .rejects.toMatchObject({ code: 'relationship_replacement_required' });
    await expect(harness.owner.prepareCreate({ ...createInput, mode: 'mirror_exactly' }))
      .rejects.toMatchObject({ code: 'relationship_definition_conflict' });
    await expect(harness.owner.prepareCreate({ ...createInput, mode: 'mirror_exactly', operationId: 'handoff_3' }))
      .rejects.toMatchObject({ code: 'relationship_replacement_required' });
  });

  it('compensates a newly created engine session when the settings commit conflicts', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    const mutation = harness.mutateSettings as ReturnType<typeof vi.fn>;
    mutation.mockResolvedValueOnce({ status: 'conflict', currentVersion: 2 });

    await expect(prepared.commit()).rejects.toMatchObject({ code: 'workspace_sync_settings_conflict' });
    expect(harness.terminateRelationshipRuntime).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'relationship_1' }));
  });

  it('preserves the stable relationship transaction across an unknown settings outcome and retries idempotently', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    harness.loseNextMutationOutcomeWithoutApplying();
    harness.failNextSettingsRead();

    await expect(prepared.commit()).rejects.toMatchObject({ code: 'indeterminate' });
    expect(harness.terminateRelationshipRuntime).not.toHaveBeenCalled();
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: false }),
    ]);

    await expect(prepared.commit()).resolves.toMatchObject({ relationshipId: 'relationship_1' });
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1' }),
    ]);
  });

  it('compensates the durable relationship and engine when the enclosing target commit fails', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();

    await prepared.abort();

    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([]);
    expect(harness.terminateRelationshipRuntime).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'relationship_1' }));
  });

  it('restores a reused disabled relationship when target commit fails after temporary publication', async () => {
    const harness = createHarness();
    const first = await harness.owner.prepareCreate(createInput);
    await first.commit();
    await harness.owner.setEnabled('relationship_1', false);
    harness.terminateRelationshipRuntime.mockClear();

    const retried = await harness.owner.prepareCreate(createInput);
    await retried.commit();
    await retried.abort();

    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: false }),
    ]);
    expect(harness.terminateRelationshipRuntime).toHaveBeenCalledOnce();
  });

  it('uses settings as the sole durable pause/resume/stop lifecycle writer', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();

    await harness.owner.setEnabled('relationship_1', false);
    await harness.owner.setEnabled('relationship_1', true);
    await harness.owner.stop('relationship_1');

    expect(harness.terminateRelationshipRuntime).not.toHaveBeenCalled();
    expect(harness.waitForSettingsReconciliation).toHaveBeenCalledTimes(3);
    expect(harness.waitForSettingsReconciliation.mock.calls.map(([settingsVersion]) => settingsVersion))
      .toEqual([1, 1, 1]);
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([]);
  });

  it('compensates a determinate pause reconciliation failure back to the prior durable intent', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();
    harness.waitForSettingsReconciliation
      .mockRejectedValueOnce(Object.assign(new Error('engine rejected pause'), { code: 'engine_unavailable' }))
      .mockResolvedValueOnce(undefined);

    await expect(harness.owner.setEnabled('relationship_1', false))
      .rejects.toMatchObject({ code: 'engine_unavailable', message: 'engine rejected pause' });

    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: true }),
    ]);
    expect(harness.waitForSettingsReconciliation).toHaveBeenCalledTimes(2);
  });

  it('compensates a determinate stop reconciliation failure by restoring the removed relationship', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();
    harness.waitForSettingsReconciliation
      .mockRejectedValueOnce(Object.assign(new Error('engine rejected termination'), { code: 'engine_unavailable' }))
      .mockResolvedValueOnce(undefined);

    await expect(harness.owner.stop('relationship_1'))
      .rejects.toMatchObject({ code: 'engine_unavailable', message: 'engine rejected termination' });

    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: true }),
    ]);
    expect(harness.waitForSettingsReconciliation).toHaveBeenCalledTimes(2);
  });

  it('leaves indeterminate durable intent in place without unsafe compensation', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();
    harness.waitForSettingsReconciliation.mockRejectedValueOnce(
      Object.assign(new Error('pause dispatch outcome unknown'), { code: 'indeterminate' }),
    );

    await expect(harness.owner.setEnabled('relationship_1', false))
      .rejects.toMatchObject({ code: 'indeterminate' });

    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: false }),
    ]);
    expect(harness.waitForSettingsReconciliation).toHaveBeenCalledTimes(1);
  });

  it('preserves the transition failure together with compensation failure evidence', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();
    const transitionFailure = Object.assign(new Error('engine rejected pause'), { code: 'engine_unavailable' });
    const compensationFailure = new Error('engine rejected compensation');
    harness.waitForSettingsReconciliation
      .mockRejectedValueOnce(transitionFailure)
      .mockRejectedValueOnce(compensationFailure);

    const outcome = harness.owner.setEnabled('relationship_1', false).catch((error: unknown) => error);
    await expect(outcome).resolves.toBeInstanceOf(AggregateError);
    const failure = await outcome as AggregateError & { code?: string };
    expect(failure.code).toBe('engine_unavailable');
    expect(failure.errors).toEqual([transitionFailure, compensationFailure]);
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([
      expect.objectContaining({ relationshipId: 'relationship_1', enabled: true }),
    ]);
  });

  it('reports an outcome-unknown settings write as indeterminate without claiming engine reconciliation', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    harness.waitForSettingsReconciliation.mockClear();
    harness.applyNextMutationWithUnknownOutcome();

    await expect(harness.owner.stop('relationship_1')).rejects.toMatchObject({ code: 'indeterminate' });
    expect(harness.read().workspaceSyncRelationshipsV1).toEqual([]);
    expect(harness.waitForSettingsReconciliation).not.toHaveBeenCalled();
  });

  it('compensates a determinate engine failure but preserves an indeterminate operation for same-id settlement', async () => {
    const determinate = createHarness();
    determinate.ensureRelationship.mockRejectedValueOnce(Object.assign(new Error('rejected'), { code: 'target_unavailable' }));
    await expect(determinate.owner.prepareCreate(createInput)).rejects.toMatchObject({ code: 'target_unavailable' });
    expect(determinate.terminateRelationshipRuntime).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'relationship_1' }));

    const indeterminate = createHarness();
    indeterminate.ensureRelationship.mockRejectedValueOnce(Object.assign(new Error('unknown'), { code: 'indeterminate' }));
    await expect(indeterminate.owner.prepareCreate(createInput)).rejects.toMatchObject({ code: 'indeterminate' });
    expect(indeterminate.terminateRelationshipRuntime).not.toHaveBeenCalled();

    const retry = await indeterminate.owner.prepareCreate(createInput);
    expect(retry.relationship.relationshipId).toBe('relationship_1');
  });

  it('rejects malformed relationship settings without rewriting them as an empty desired set', async () => {
    const harness = createHarness();
    const prepared = await harness.owner.prepareCreate(createInput);
    await prepared.commit();
    const current = harness.read() as { workspaceSyncRelationshipsV1: unknown };
    current.workspaceSyncRelationshipsV1 = [{ malformed: true }];
    harness.waitForSettingsReconciliation.mockClear();

    await expect(harness.owner.setEnabled('relationship_1', false))
      .rejects.toMatchObject({ code: 'workspace_sync_settings_invalid' });
    expect(current.workspaceSyncRelationshipsV1).toEqual([{ malformed: true }]);
    expect(harness.waitForSettingsReconciliation).not.toHaveBeenCalled();
  });

  it('cleans up a disabled relationship that this transaction temporarily starts and then aborts', async () => {
    const harness = createHarness();
    const first = await harness.owner.prepareCreate(createInput);
    await first.commit();
    await harness.owner.setEnabled('relationship_1', false);
    harness.terminateRelationshipRuntime.mockClear();

    const retry = await harness.owner.prepareCreate(createInput);
    expect(retry.reused).toBe(true);
    await retry.abort();

    expect(harness.terminateRelationshipRuntime).toHaveBeenCalledWith(expect.objectContaining({ relationshipId: 'relationship_1' }));
  });
});
