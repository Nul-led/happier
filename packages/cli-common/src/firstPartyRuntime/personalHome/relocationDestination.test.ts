import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPersonalHomeRelocationDestinationOwner } from './relocationDestination.js';

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
    canonicalServerUrl: 'https://source.example.test',
    minimumOuterRevisionExclusive: 9,
  }));
  const activate = vi.fn(async () => undefined);
  const attestActive = vi.fn(async () => ({
    authenticated: true as const,
    homeServerIdentityId: 'srv_home_1',
    accountCount: 1,
    sessionCount: 0,
  }));
  const abortCandidate = vi.fn(async () => undefined);
  const owner = createPersonalHomeRelocationDestinationOwner({
    dataDir,
    quarantine,
    readServiceStatus: async () => ({ running: false, quarantined: true }),
    stageCandidate,
    activate,
    attestActive,
    abortCandidate,
  });
  const stage = {
    operationId: 'system-task:11111111-1111-4111-8111-111111111111',
    archivePath,
    bundleSha256,
    expectedHomeServerIdentityId: 'srv_home_1',
    expectedCanonicalServerUrl: 'https://source.example.test',
    sourceDescriptorRevision: 7,
  };
  return { dataDir, owner, stage, quarantine, stageCandidate, activate, attestActive, abortCandidate };
}

describe('destination-local Personal Home relocation owner', () => {
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
  });

  it('aborts a candidate once and quarantines an active destination before returning authority to source', async () => {
    const staged = await fixture();
    await staged.owner.stage(staged.stage);
    await expect(staged.owner.abort(staged.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    await expect(staged.owner.abort(staged.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    expect(staged.abortCandidate).toHaveBeenCalledTimes(1);

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
    await expect(active.owner.abort(active.stage.operationId)).resolves.toMatchObject({ status: 'aborted' });
    expect(active.quarantine).toHaveBeenCalledTimes(3);
    expect(active.abortCandidate).toHaveBeenCalledTimes(1);
  });
});
