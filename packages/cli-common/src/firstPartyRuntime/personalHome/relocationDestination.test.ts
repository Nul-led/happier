import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPersonalHomeRelocationDestinationAllowsActivation,
  assertPersonalHomeRelocationDestinationAllowsMaintenance,
  createPersonalHomeRelocationDestinationOwner,
  type PersonalHomeRelocationDestinationReceivedCandidate,
  type PersonalHomeRelocationDestinationStageInput,
} from './relocationDestination.js';
import { resolvePersonalHomeRuntimeLayout } from './layout.js';

/** Durable state left behind by a destination process killed inside the canonical
 * restore: the receiving marker is on disk and never advanced to `staged`. */
async function writeInterruptedReceivingMarker(dataDir: string, stage: PersonalHomeRelocationDestinationStageInput): Promise<void> {
  await mkdir(join(dataDir, '.operations'), { recursive: true, mode: 0o700 });
  await writeFile(join(dataDir, '.operations', 'relocation-destination.json'), `${JSON.stringify({
    version: 1,
    operationId: stage.operationId,
    status: 'receiving',
    bundleSha256: stage.bundleSha256,
    expectedHomeServerIdentityId: stage.expectedHomeServerIdentityId,
    expectedCanonicalServerUrl: stage.expectedCanonicalServerUrl,
    sourceDescriptorRevision: stage.sourceDescriptorRevision,
  })}\n`, { mode: 0o600 });
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const dataDir = await mkdtemp(join(tmpdir(), 'happier-relocation-destination-'));
  roots.push(dataDir);
  const archivePath = join(dataDir, 'incoming.tar');
  const bytes = Buffer.from('verified transferred home bytes');
  await writeFile(archivePath, bytes);
  const bundleSha256 = createHash('sha256').update(bytes).digest('hex');
  const quarantine = vi.fn(async () => undefined);
  const stageCandidate = vi.fn(async () => ({
    authenticated: true as const,
    homeServerIdentityId: 'srv_home_1',
    accountCount: 1,
    sessionCount: 0,
    connectionDescriptor: {
      v: 1 as const, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'https://source.example.test',
      revision: 10, endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
    },
  }));
  const activate = vi.fn(async () => undefined);
  const attestActive = vi.fn(async () => ({
    authenticated: true as const,
    homeServerIdentityId: 'srv_home_1',
    accountCount: 1,
    sessionCount: 0,
  }));
  const abortCandidate = vi.fn(async () => undefined);
  const inspectReceivedCandidate = vi.fn(async (): Promise<PersonalHomeRelocationDestinationReceivedCandidate> => ({ outcome: 'absent' }));
  const hasUploadReservation = vi.fn(async (): Promise<boolean> => false);
  const cleanupUploadReservation = vi.fn(async () => undefined);
  const preflightDestination = vi.fn(async () => undefined);
  const finalizeCandidate = vi.fn(async () => undefined);
  const owner = createPersonalHomeRelocationDestinationOwner({
    dataDir,
    readValidatedTarget: async () => ({
      layout: resolvePersonalHomeRuntimeLayout({ homeDir: dataDir, env: { HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir } }),
      canonicalServerUrl: 'https://source.example.test',
      homeServerIdentityId: null,
    }),
    quarantine,
    readServiceStatus: async () => ({ running: false, quarantined: true }),
    stageCandidate,
    inspectReceivedCandidate,
    activate,
    attestActive,
    abortCandidate,
    hasUploadReservation,
    cleanupUploadReservation,
    preflightDestination,
    finalizeCandidate,
  });
  const stage = {
    operationId: 'system-task:11111111-1111-4111-8111-111111111111',
    archivePath,
    bundleSha256,
    expectedHomeServerIdentityId: 'srv_home_1',
    expectedCanonicalServerUrl: 'https://source.example.test',
    sourceDescriptorRevision: 7,
  };
  return { dataDir, owner, stage, quarantine, stageCandidate, inspectReceivedCandidate, activate, attestActive, abortCandidate, hasUploadReservation, cleanupUploadReservation, preflightDestination, finalizeCandidate };
}

describe('destination-local Personal Home relocation owner', () => {
  it('preflights an absent destination before reporting it safe to reserve', async () => {
    const { owner, stage, preflightDestination } = await fixture();
    preflightDestination.mockRejectedValueOnce(new Error('destination contains unrelated Personal Home data'));

    await expect(owner.status(stage.operationId)).rejects.toThrow('unrelated Personal Home data');
    expect(preflightDestination).toHaveBeenCalledTimes(1);
  });

  it('admits stopped maintenance only for the exact receiving relocation operation', async () => {
    const { dataDir, stage, owner } = await fixture();
    await writeInterruptedReceivingMarker(dataDir, stage);

    await expect(assertPersonalHomeRelocationDestinationAllowsMaintenance(dataDir, {
      operationId: stage.operationId,
      action: 'attest',
    })).resolves.toBeUndefined();
    await expect(assertPersonalHomeRelocationDestinationAllowsMaintenance(dataDir, {
      operationId: 'system-task:22222222-2222-4222-8222-222222222222',
      action: 'materialize_endpoint',
    })).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED' });

    await owner.stage(stage);
    await expect(assertPersonalHomeRelocationDestinationAllowsMaintenance(dataDir, {
      operationId: stage.operationId,
      action: 'attest',
    })).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED' });
  });

  it('persists a quarantined stage result and returns it without replay after a lost response', async () => {
    const { owner, stage, quarantine, stageCandidate } = await fixture();

    await expect(owner.stage(stage)).resolves.toMatchObject({
      operationId: stage.operationId,
      status: 'quarantined',
      bundleSha256: stage.bundleSha256,
      homeServerIdentityId: 'srv_home_1',
      authenticated: true,
      accountCount: 1,
      sessionCount: 0,
    });
    await expect(owner.stage(stage)).resolves.toMatchObject({ status: 'quarantined' });

    expect(stageCandidate).toHaveBeenCalledTimes(1);
    expect(quarantine).toHaveBeenCalledTimes(2);
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({ status: 'quarantined' });
  });

  it('reconciles an interrupted receiving candidate whose canonical restore already completed', async () => {
    const { dataDir, owner, stage, stageCandidate, inspectReceivedCandidate } = await fixture();
    await writeInterruptedReceivingMarker(dataDir, stage);
    inspectReceivedCandidate.mockResolvedValueOnce({
      outcome: 'restored',
      authenticated: true,
      homeServerIdentityId: 'srv_home_1',
      accountCount: 1,
      sessionCount: 0,
      connectionDescriptor: {
        v: 1 as const, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'https://source.example.test',
        revision: 10, endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
      },
    });

    await expect(owner.stage(stage)).resolves.toMatchObject({
      operationId: stage.operationId,
      status: 'quarantined',
      bundleSha256: stage.bundleSha256,
      homeServerIdentityId: 'srv_home_1',
      authenticated: true,
      accountCount: 1,
      sessionCount: 0,
      connectionDescriptor: { revision: 10 },
    });
    expect(stageCandidate).not.toHaveBeenCalled();
    expect(inspectReceivedCandidate).toHaveBeenCalledTimes(1);
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({ status: 'quarantined' });
    await expect(assertPersonalHomeRelocationDestinationAllowsActivation(dataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED',
    });
  });

  it('runs the canonical restore when an interrupted receiving candidate was never mutated', async () => {
    const { dataDir, owner, stage, stageCandidate, inspectReceivedCandidate } = await fixture();
    await writeInterruptedReceivingMarker(dataDir, stage);

    await expect(owner.stage(stage)).resolves.toMatchObject({ status: 'quarantined', homeServerIdentityId: 'srv_home_1' });
    expect(inspectReceivedCandidate).toHaveBeenCalledTimes(1);
    expect(stageCandidate).toHaveBeenCalledTimes(1);
  });

  it('keeps an ambiguous interrupted candidate in typed recovery with its artifacts retained', async () => {
    const { dataDir, owner, stage, stageCandidate, abortCandidate, inspectReceivedCandidate } = await fixture();
    await writeInterruptedReceivingMarker(dataDir, stage);
    inspectReceivedCandidate.mockResolvedValueOnce({ outcome: 'ambiguous', reason: 'the restore journal is still promoting' });

    await expect(owner.stage(stage)).rejects.toMatchObject({ code: 'relocation_destination_recovery_required' });
    expect(stageCandidate).not.toHaveBeenCalled();
    expect(abortCandidate).not.toHaveBeenCalled();
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({
      status: 'recovery_required',
      failureCode: 'relocation_destination_recovery_required',
    });
    await expect(owner.stage(stage)).rejects.toMatchObject({ code: 'relocation_destination_recovery_required' });
    await expect(assertPersonalHomeRelocationDestinationAllowsActivation(dataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED',
    });
  });

  it('activates only after a matching published descriptor advances the source revision and retries idempotently', async () => {
    const { dataDir, owner, stage, activate, attestActive } = await fixture();
    await owner.stage(stage);
    activate.mockImplementationOnce(async () => {
      const marker = JSON.parse(await readFile(join(dataDir, '.operations', 'relocation-destination.json'), 'utf8')) as { status?: unknown };
      expect(marker.status).toBe('activating');
    });
    const input = {
      operationId: stage.operationId,
      publishedDescriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 10,
        endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
      },
    };

    await expect(owner.commit(input)).resolves.toMatchObject({ status: 'active' });
    await expect(owner.commit(input)).resolves.toMatchObject({ status: 'active' });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(attestActive).toHaveBeenCalledTimes(1);
  });

  it('reports candidate cleanup attention after activation and converges it on commit retry', async () => {
    const { owner, stage, finalizeCandidate, activate } = await fixture();
    await owner.stage(stage);
    finalizeCandidate.mockRejectedValueOnce(new Error('rollback artifact busy'));
    const input = {
      operationId: stage.operationId,
      publishedDescriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 10,
        endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
      },
    };

    await expect(owner.commit(input)).resolves.toMatchObject({ status: 'active', cleanupNeedsAttention: true });
    await expect(owner.commit(input)).resolves.not.toHaveProperty('cleanupNeedsAttention');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(finalizeCandidate).toHaveBeenCalledTimes(2);
  });

  it('re-quarantines an ambiguous activation and can safely retry commit', async () => {
    const { owner, stage, quarantine, attestActive } = await fixture();
    await owner.stage(stage);
    attestActive.mockRejectedValueOnce(new Error('readiness response lost'));
    const input = {
      operationId: stage.operationId,
      publishedDescriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 10,
        endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
      },
    };

    await expect(owner.commit(input)).rejects.toThrow('readiness response lost');
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({
      status: 'recovery_required',
      failureCode: 'activation_failed',
    });
    await expect(owner.commit(input)).resolves.toMatchObject({ status: 'active' });
    expect(quarantine).toHaveBeenCalledTimes(3);
  });

  it('rejects destination commit when authenticated data counts drift from the staged candidate', async () => {
    const { owner, stage, attestActive } = await fixture();
    await owner.stage(stage);
    attestActive.mockResolvedValueOnce({
      authenticated: true,
      homeServerIdentityId: 'srv_home_1',
      accountCount: 2,
      sessionCount: 0,
    });
    await expect(owner.commit({
      operationId: stage.operationId,
      publishedDescriptor: {
        v: 1, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'https://source.example.test',
        revision: 10, endpoints: [{ kind: 'https', url: 'https://source.example.test' }],
      },
    })).rejects.toMatchObject({ code: 'relocation_destination_recovery_required' });
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({ status: 'recovery_required' });
  });

  it('fails closed on changed retry facts, a stale descriptor, or a bundle digest mismatch', async () => {
    const { owner, stage, stageCandidate } = await fixture();
    await expect(owner.stage({ ...stage, bundleSha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'relocation_bundle_mismatch' });
    expect(stageCandidate).not.toHaveBeenCalled();
    await expect(owner.status(stage.operationId)).resolves.toEqual({ operationId: stage.operationId, status: 'absent' });

    const retry = await fixture();
    await retry.owner.stage(retry.stage);
    await expect(retry.owner.stage({ ...retry.stage, sourceDescriptorRevision: 8 })).rejects.toMatchObject({ code: 'relocation_operation_conflict' });
    await expect(retry.owner.commit({
      operationId: retry.stage.operationId,
      publishedDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 7,
        endpoints: [{ kind: 'https', url: 'https://source.example.test' }],
      },
    })).rejects.toMatchObject({ code: 'invalid_relocation_operation' });
    await expect(retry.owner.commit({
      operationId: retry.stage.operationId,
      publishedDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 9,
        endpoints: [{ kind: 'https', url: 'https://source.example.test' }],
      },
    })).rejects.toMatchObject({ code: 'invalid_relocation_operation' });
    await expect(retry.owner.commit({
      operationId: retry.stage.operationId,
      publishedDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 10,
        endpoints: [{ kind: 'https', url: 'https://stale.example.test' }],
      },
    })).rejects.toMatchObject({ code: 'invalid_relocation_operation' });
  });

  it('aborts a verified candidate once and idempotently', async () => {
    const staged = await fixture();
    await staged.owner.stage(staged.stage);
    await expect(staged.owner.abort(staged.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    await expect(staged.owner.abort(staged.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    expect(staged.abortCandidate).toHaveBeenCalledTimes(1);
  });

  it('permits a later prepare after a different destination operation was aborted', async () => {
    const staged = await fixture();
    await staged.owner.stage(staged.stage);
    await expect(staged.owner.abort(staged.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });

    const nextStage = {
      ...staged.stage,
      operationId: 'system-task:22222222-2222-4222-8222-222222222222',
    };
    await expect(staged.owner.stage(nextStage)).resolves.toMatchObject({
      operationId: nextStage.operationId,
      status: 'quarantined',
    });
    expect(staged.stageCandidate).toHaveBeenCalledTimes(2);
  });

  it('refuses to abort an activated destination that may already be the writable Home', async () => {
    const active = await fixture();
    await active.owner.stage(active.stage);
    await active.owner.commit({
      operationId: active.stage.operationId,
      publishedDescriptor: {
        v: 1,
        homeServerIdentityId: 'srv_home_1',
        canonicalServerUrl: 'https://source.example.test',
        revision: 10,
        endpoints: [{ kind: 'https', url: 'https://source.example.test' }],
      },
    });

    await expect(active.owner.abort(active.stage.operationId)).rejects.toMatchObject({
      code: 'relocation_destination_already_active',
    });
    expect(active.abortCandidate).not.toHaveBeenCalled();
    expect(active.quarantine).toHaveBeenCalledTimes(2);
    await expect(active.owner.status(active.stage.operationId)).resolves.toMatchObject({ status: 'active' });
  });

  it('never erases destination data whose relocation ownership the durable facts cannot prove', async () => {
    const { owner, stage, stageCandidate, abortCandidate, cleanupUploadReservation } = await fixture();
    stageCandidate.mockRejectedValueOnce(new Error('Destination Personal Home contains data; explicit overwrite confirmation is required'));

    await expect(owner.stage(stage)).rejects.toThrow('explicit overwrite confirmation is required');
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({
      status: 'recovery_required',
      failureCode: 'stage_failed',
    });

    await expect(owner.abort(stage.operationId)).resolves.toMatchObject({
      status: 'recovery_required',
      failureCode: 'stage_failed',
    });
    expect(abortCandidate).not.toHaveBeenCalled();
    expect(cleanupUploadReservation).not.toHaveBeenCalled();
    await expect(owner.status(stage.operationId)).resolves.toMatchObject({ status: 'recovery_required' });
  });

  it('stops an interrupted receiving candidate in typed recovery instead of erasing it on abort', async () => {
    const { dataDir, owner, stage, abortCandidate } = await fixture();
    await writeInterruptedReceivingMarker(dataDir, stage);

    await expect(owner.abort(stage.operationId)).resolves.toMatchObject({
      status: 'recovery_required',
      failureCode: 'destination_ownership_unproven',
    });
    expect(abortCandidate).not.toHaveBeenCalled();
    await expect(assertPersonalHomeRelocationDestinationAllowsActivation(dataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_DESTINATION_ACTIVATION_BLOCKED',
    });
  });

  it('cleans the exact destination upload reservation when aborting a staged candidate', async () => {
    const { owner, stage, cleanupUploadReservation } = await fixture();
    await owner.stage(stage);

    await expect(owner.abort(stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    expect(cleanupUploadReservation).toHaveBeenCalledTimes(1);
    expect(cleanupUploadReservation).toHaveBeenCalledWith(stage.operationId);
  });

  it('removes an orphaned upload reservation when aborting an operation whose transfer failed before stage', async () => {
    const { owner, stage, quarantine, hasUploadReservation, cleanupUploadReservation } = await fixture();
    hasUploadReservation.mockResolvedValueOnce(true);

    await expect(owner.abort(stage.operationId)).resolves.toEqual({ operationId: stage.operationId, status: 'absent' });
    expect(cleanupUploadReservation).toHaveBeenCalledTimes(1);
    expect(cleanupUploadReservation).toHaveBeenCalledWith(stage.operationId);
    expect(quarantine).not.toHaveBeenCalled();
    await expect(owner.status(stage.operationId)).resolves.toEqual({ operationId: stage.operationId, status: 'absent' });
  });

  it('keeps aborting an operation with no destination state and no reservation rejected as not staged', async () => {
    const { owner, stage, cleanupUploadReservation } = await fixture();

    await expect(owner.abort(stage.operationId)).rejects.toMatchObject({ code: 'relocation_destination_not_staged' });
    expect(cleanupUploadReservation).not.toHaveBeenCalled();
  });

  it('reports typed transfer-cleanup attention on abort without failing it and converges on retry', async () => {
    const { owner, stage, cleanupUploadReservation } = await fixture();
    await owner.stage(stage);
    cleanupUploadReservation.mockRejectedValueOnce(new Error('temporary upload removal failed'));

    expect(await owner.abort(stage.operationId)).toMatchObject({ status: 'aborted', transferCleanupNeedsAttention: true });
    const status = await owner.status(stage.operationId);
    expect(status).toMatchObject({ status: 'aborted', transferCleanupNeedsAttention: true });

    await expect(owner.stage({
      ...stage,
      operationId: 'system-task:33333333-3333-4333-8333-333333333333',
    })).rejects.toMatchObject({ code: 'relocation_operation_conflict' });

    await expect(owner.abort(stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    await expect(owner.status(stage.operationId)).resolves.not.toHaveProperty('transferCleanupNeedsAttention');
    expect(cleanupUploadReservation).toHaveBeenCalledTimes(2);
  });

  it('reports typed transfer-cleanup attention when an orphaned reservation cannot be removed', async () => {
    const { owner, stage, hasUploadReservation, cleanupUploadReservation } = await fixture();
    hasUploadReservation.mockResolvedValueOnce(true);
    cleanupUploadReservation.mockRejectedValueOnce(new Error('temporary upload removal failed'));

    await expect(owner.abort(stage.operationId)).resolves.toEqual({
      operationId: stage.operationId,
      status: 'absent',
      transferCleanupNeedsAttention: true,
    });
  });
});
