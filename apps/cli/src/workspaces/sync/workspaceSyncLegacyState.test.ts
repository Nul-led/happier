import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { inspectRetiredWorkspaceReplicationState } from './workspaceSyncLegacyState';

// First line of every released cli-v0.2.11 streaming source-offer file.
const SOURCE_OFFER_MAGIC = 'HAPPIER_WORKSPACE_REPLICATION_SOURCE_OFFER_V1';
const RELEASED_DIRECTION_SCOPE = {
  sourceMachineId: 'machine-a',
  sourceWorkspaceRoot: '/workspace/alpha',
  targetMachineId: 'machine-b',
  targetWorkspaceRoot: '/workspace/beta',
  mode: 'one_way_safe',
} as const;
const RELEASED_RELATIONSHIP_ID = 'rel_2teqJ4EEScvFRzDbDcbDoHyd7LWGG5enP7dXcJs0fDo';
const RELEASED_DIRECTION_ID = 'dir_mP-WeDnUSn5yRZP6Q3OagcOHEwhYXGc4ro02xYTcLAU';

// Golden record shapes copied from the immutable cli-v0.2.11 writer at
// 98ea8fb76733b1dd785d38c31360179cafa84824. Keep these literals independent
// of current replacement types so this test remains provenance evidence.
function releasedJobRecord(jobId: string) {
  return {
    schemaVersion: 1,
    jobId,
    createdAtMs: 1,
    updatedAtMs: 1,
    status: {
      status: 'pending',
      phase: 'planning',
      checkpoint: 'job_created',
      progressCounters: {
        plannedFiles: 0,
        plannedBytes: 0,
        transferredFiles: 0,
        transferredBytes: 0,
        appliedFiles: 0,
        appliedBytes: 0,
      },
      warnings: [],
      blockingDivergenceCandidates: [],
    },
  };
}

function releasedRelationshipRecord(relationshipId: string) {
  return {
    schemaVersion: 1,
    relationshipId,
    endpoints: [
      { machineId: 'machine-a', rootPath: '/workspace/alpha' },
      { machineId: 'machine-b', rootPath: '/workspace/beta' },
    ],
    config: { mode: 'one_way_safe' },
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

function releasedBaselineRecord() {
  const serializedScope = JSON.stringify(RELEASED_DIRECTION_SCOPE);
  return {
    schemaVersion: 1,
    cacheKey: `workspace-replication-baseline-v1-${createHash('sha256').update('workspace-replication-baseline-v1\n').update(serializedScope).digest('hex')}`,
    scope: RELEASED_DIRECTION_SCOPE,
    baseline: {
      manifestFingerprint: `sha256:${'b'.repeat(64)}`,
      manifest: { entries: [] },
      savedAtMs: 1,
    },
  };
}

function releasedLeaseRecord() {
  return {
    leaseId: 'lease-1',
    attempt: 1,
    ownerId: 'owner_a',
    acquiredAtMs: 1,
    renewedAtMs: 2,
    expiresAtMs: 3,
  };
}

async function makeServerDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'happier-workspace-sync-legacy-state-'));
}

/**
 * Stands in for the canonical Windows protected-ACL boundary (the real one
 * shells out to System32 tools). `rejectPaths` models every non-ok boundary
 * result the owner must fail closed on: a broad or inherited DACL, an
 * unresolved owner, a reparse point, or an unavailable PowerShell inspection.
 */
function windowsAclBoundaryStub(rejectPaths: readonly string[] = []) {
  const reject = (path: string) => {
    if (rejectPaths.includes(path)) throw new Error(`Windows protected path has an unsafe ACL entry: ${path}`);
  };
  return {
    verify: vi.fn(async (input: Readonly<{ path: string }>) => { reject(input.path); }),
    applyAndVerify: vi.fn(async (input: Readonly<{ path: string }>) => { reject(input.path); }),
  };
}

async function makeLegacyStateRoot(activeServerDir: string): Promise<string> {
  const stateRoot = join(activeServerDir, 'workspace-replication');
  await mkdir(join(stateRoot, 'cas'), { recursive: true });
  await mkdir(join(stateRoot, 'jobs'));
  await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
  await chmod(stateRoot, 0o700);
  return stateRoot;
}

describe('inspectRetiredWorkspaceReplicationState', () => {
  it('reports an absent legacy state root without creating anything', async () => {
    const activeServerDir = await makeServerDir();

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    })).resolves.toEqual({
      status: 'absent',
      path: join(activeServerDir, 'workspace-replication'),
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines an exact, owned v1 state root and writes a bounded retirement marker', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'cas'), { recursive: true });
    await mkdir(join(stateRoot, 'jobs'));
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o700);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    });

    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-abc123');
    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      schemaVersion: 1,
      quarantinePath,
    });
    await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    const marker = JSON.parse(await readFile(join(quarantinePath, 'retirement.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_700_000_000_000,
      installationId: 'installation-test',
    });
    expect(typeof marker.inventoryHash).toBe('string');
    expect((await stat(quarantinePath)).mode & 0o777).toBe(0o700);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines the released root shape that also carries offers and scope-leases children', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    // Provenance: released engine cli-v0.2.11. The paths owner creates
    // cas/jobs/relationships/staging, the source-offer store creates
    // `offers/` with `offer_<id>.txt` payloads whose first line is the
    // stream magic, and the scope-lease owner creates
    // `scope-leases/<rel>__<dir>/lease/lease.json` lease records.
    await mkdir(join(stateRoot, 'cas'), { recursive: true });
    await mkdir(join(stateRoot, 'jobs'));
    await mkdir(join(stateRoot, 'relationships'), { recursive: true });
    await mkdir(join(stateRoot, 'staging'), { recursive: true });
    await mkdir(join(stateRoot, 'offers'));
    await writeFile(join(stateRoot, 'offers', 'offer_1.txt'), `${SOURCE_OFFER_MAGIC}\n${JSON.stringify({
      offerId: 'offer_1',
      relationshipId: 'rel_1',
      directionId: 'dir_1',
      sourceFingerprint: `sha256:${'a'.repeat(64)}`,
    })}\n`);
    await mkdir(join(stateRoot, 'scope-leases', 'rel_1__dir_1', 'lease'), { recursive: true });
    await writeFile(join(stateRoot, 'scope-leases', 'rel_1__dir_1', 'lease', 'lease.json'), JSON.stringify({
      ownerId: 'owner_a',
      acquiredAtMs: 1,
      renewedAtMs: 2,
      expiresAtMs: 3,
    }));
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o700);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'offers',
    });

    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-offers');
    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      quarantinePath,
    });
    await expect(stat(join(quarantinePath, 'offers', 'offer_1.txt'))).resolves.toBeTruthy();
    await expect(stat(join(quarantinePath, 'scope-leases', 'rel_1__dir_1', 'lease', 'lease.json'))).resolves.toBeTruthy();
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('enumerates only the retired engine lock/temp names instead of matching arbitrary lock/temp-shaped children', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o700);
    // An unrelated child that merely looks like a lock is not provenance of
    // the retired engine and must fail closed instead of being quarantined.
    await writeFile(join(stateRoot, 'something.lock'), 'not ours');

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readFile(join(stateRoot, 'something.lock'), 'utf8')).resolves.toBe('not ours');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed on writer leftovers at the state root: the released engine never emits them there', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o700);
    // writeJsonAtomic leftovers and lease-writer artifacts live inside the
    // store directories, never at the state root. A root-level temp shape is
    // not released provenance and must fail closed.
    await writeFile(join(stateRoot, '.tmp-4242-1700000000000-deadbeef.json'), '{}');
    await writeFile(join(stateRoot, 'lease.0f1e2d3c-4b5a-4987-8765-fedcba987654.tmp'), '{}');
    await mkdir(join(stateRoot, 'lease.tmp-0f1e2d3c-4b5a-4987-8765-fedcba987655'));

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readFile(join(stateRoot, '.tmp-4242-1700000000000-deadbeef.json'), 'utf8')).resolves.toBe('{}');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines writer leftovers kept inside the released store directories and a relationship record location', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    // Job records plus a writeJsonAtomic leftover inside jobs/.
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await writeFile(join(stateRoot, 'jobs', '.tmp-4242-1700000000000-deadbeef.json'), '{}');
    // Relationship record location with its baselines subtree and a leftover
    // writeJsonAtomic temp beside the record.
    await mkdir(join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, 'directionalBaselines', RELEASED_DIRECTION_ID), { recursive: true });
    await writeFile(join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, 'relationship.json'), JSON.stringify(releasedRelationshipRecord(RELEASED_RELATIONSHIP_ID)));
    await writeFile(join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, '.tmp-4242-1700000000000-cafebabe.json'), '{}');
    await writeFile(join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, 'directionalBaselines', RELEASED_DIRECTION_ID, 'baseline.json'), JSON.stringify(releasedBaselineRecord()));
    // Scope-lease location with both released leftover shapes.
    const scopeLeaseName = `${RELEASED_RELATIONSHIP_ID}__${RELEASED_DIRECTION_ID}`;
    await mkdir(join(stateRoot, 'scope-leases', scopeLeaseName, 'lease'), { recursive: true });
    const temporaryLeaseDirectory = join(stateRoot, 'scope-leases', scopeLeaseName, 'lease.tmp-0f1e2d3c-4b5a-4987-8765-fedcba987655');
    await mkdir(temporaryLeaseDirectory);
    await writeFile(join(temporaryLeaseDirectory, 'lease.json'), JSON.stringify(releasedLeaseRecord()));
    await writeFile(join(stateRoot, 'scope-leases', scopeLeaseName, 'lease', 'lease.json'), JSON.stringify(releasedLeaseRecord()));
    await writeFile(join(stateRoot, 'scope-leases', scopeLeaseName, 'lease', 'lease.0f1e2d3c-4b5a-4987-8765-fedcba987654.tmp'), '{}');
    // CAS shard layout with a partial blob write inside a shard directory.
    await mkdir(join(stateRoot, 'cas', 'sha256', 'aa'), { recursive: true });
    await writeFile(join(stateRoot, 'cas', 'sha256', 'aa', `${'a'.repeat(64)}`), 'blob bytes');
    await writeFile(join(stateRoot, 'cas', 'sha256', 'aa', '0f1e2d3c-4b5a-4987-8765-fedcba987654.part'), 'partial');
    // Staging carries only the job lease and received blob-pack partial trees.
    await mkdir(join(stateRoot, 'staging', 'job-1', 'lease'), { recursive: true });
    await writeFile(join(stateRoot, 'staging', 'job-1', 'lease', 'lease.json'), JSON.stringify(releasedLeaseRecord()));
    await mkdir(join(stateRoot, 'staging', 'job-1', 'blob-packs', 'pack_1'), { recursive: true });
    await writeFile(join(
      stateRoot,
      'staging',
      'job-1',
      'blob-packs',
      'pack_1',
      `${'b'.repeat(64)}-0f1e2d3c-4b5a-4987-8765-fedcba987654.part`,
    ), 'partial');
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'storetemps',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
    });
    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-storetemps');
    await expect(stat(join(quarantinePath, 'relationships', RELEASED_RELATIONSHIP_ID, 'relationship.json'))).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it.each([
    {
      label: 'an arbitrary directional baseline record',
      arrange: async (stateRoot: string) => {
        const baselineDirectory = join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, 'directionalBaselines', RELEASED_DIRECTION_ID);
        await mkdir(baselineDirectory, { recursive: true });
        await writeFile(join(stateRoot, 'relationships', RELEASED_RELATIONSHIP_ID, 'relationship.json'), JSON.stringify(releasedRelationshipRecord(RELEASED_RELATIONSHIP_ID)));
        await writeFile(join(baselineDirectory, 'baseline.json'), JSON.stringify({ schemaVersion: 1 }));
      },
    },
    {
      label: 'an arbitrary CAS shard entry',
      arrange: async (stateRoot: string) => {
        await mkdir(join(stateRoot, 'cas', 'sha256', 'ab'), { recursive: true });
        await writeFile(join(stateRoot, 'cas', 'sha256', 'ab', 'not-a-released-cas-entry'), 'unknown');
      },
    },
    {
      label: 'an arbitrary staging entry',
      arrange: async (stateRoot: string) => {
        await mkdir(join(stateRoot, 'staging', 'job-1'), { recursive: true });
        await writeFile(join(stateRoot, 'staging', 'job-1', 'unrelated.json'), '{}');
      },
    },
    {
      label: 'a magic-prefixed but malformed source offer',
      arrange: async (stateRoot: string) => {
        await mkdir(join(stateRoot, 'offers'), { recursive: true });
        await writeFile(join(stateRoot, 'offers', 'offer_bad.txt'), `${SOURCE_OFFER_MAGIC}\n{"arbitrary":true}\n`);
      },
    },
    {
      label: 'a lease record with fields the released writer never emits',
      arrange: async (stateRoot: string) => {
        await mkdir(join(stateRoot, 'scope-leases', 'rel_abc__dir_1', 'lease'), { recursive: true });
        await writeFile(join(stateRoot, 'scope-leases', 'rel_abc__dir_1', 'lease', 'lease.json'), JSON.stringify({
          ...releasedLeaseRecord(),
          arbitrary: true,
        }));
      },
    },
    {
      label: 'an empty lease acquisition directory',
      arrange: async (stateRoot: string) => {
        await mkdir(join(stateRoot, 'scope-leases', 'rel_abc__dir_1', 'lease'), { recursive: true });
        await writeFile(join(stateRoot, 'scope-leases', 'rel_abc__dir_1', 'lease', 'lease.json'), JSON.stringify(releasedLeaseRecord()));
        await mkdir(join(stateRoot, 'scope-leases', 'rel_abc__dir_1', 'lease.tmp-0f1e2d3c-4b5a-4987-8765-fedcba987655'));
      },
    },
  ])('leaves the state untouched when it contains $label', async ({ arrange }) => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    await arrange(stateRoot);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when a released record candidate is malformed instead of skipping it', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    // A candidate at a released record location that is not valid JSON is a
    // malformed candidate: classification must fail closed, not succeed.
    await writeFile(join(stateRoot, 'jobs', 'job-2.json'), '{not json');
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readFile(join(stateRoot, 'jobs', 'job-2.json'), 'utf8')).resolves.toBe('{not json');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when a released record candidate lacks the stable released discriminator', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    // Valid JSON at the record location, but missing the released disk
    // record discriminators (schemaVersion 1 and a jobId).
    await writeFile(join(stateRoot, 'jobs', 'stray.json'), JSON.stringify({ status: 'pending' }));
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('leaves a superficial schema-version-and-id job lookalike untouched', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify({
      schemaVersion: 1,
      jobId: 'job-1',
    }));
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readFile(join(stateRoot, 'jobs', 'job-1.json'), 'utf8')).resolves.toContain('"jobId":"job-1"');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('requires released record identity to match its job filename and relationship directory', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await mkdir(join(stateRoot, 'relationships', 'rel_location'), { recursive: true });
    await writeFile(
      join(stateRoot, 'jobs', 'job-location.json'),
      JSON.stringify(releasedJobRecord('job-record')),
    );
    await writeFile(
      join(stateRoot, 'relationships', 'rel_location', 'relationship.json'),
      JSON.stringify(releasedRelationshipRecord('rel_record')),
    );
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'unrecognized_child',
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when a record location entry is a symlink', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await mkdir(join(activeServerDir, 'elsewhere'), { recursive: true });
    await symlink(join(activeServerDir, 'elsewhere'), join(stateRoot, 'relationships'));
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(stat(stateRoot)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed on a same-filesystem Linux mount replacement before inspecting or moving it', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    const canonicalStateRoot = await realpath(stateRoot);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'linux',
      readLinuxMountInfo: async () => `44 32 0:31 / ${canonicalStateRoot} rw,relatime - ext4 /dev/test rw\n`,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'mount_replacement',
      path: stateRoot,
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when the bounded record traversal is exhausted before completing', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    for (let index = 0; index < 2_100; index += 1) {
      await writeFile(join(stateRoot, 'jobs', `job-${index}.json`), JSON.stringify(releasedJobRecord(`job-${index}`)));
    }
    await chmod(stateRoot, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(stat(join(stateRoot, 'jobs', 'job-0.json'))).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('leaves a state root untouched when an unknown immediate child is present', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await writeFile(join(stateRoot, 'unexpected.txt'), 'do not touch');

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(readFile(join(stateRoot, 'unexpected.txt'), 'utf8')).resolves.toBe('do not touch');
    await expect(readdir(activeServerDir)).resolves.toContain('workspace-replication');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('still classifies a valid retired-v1 quarantine as unsupported on restart', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'cas'), { recursive: true });
    await mkdir(join(stateRoot, 'jobs'));
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o700);

    const first = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'abc123',
    });
    if (first.status !== 'legacy_workspace_sync_state_unsupported') throw new Error('expected quarantine on first startup');
    const { quarantinePath, inventoryHash } = first;

    // A later restart sees the live root absent and must not forget the quarantine.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir, installationId: 'installation-test' })).resolves.toEqual({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      path: quarantinePath,
      quarantinePath,
      schemaVersion: 1,
      inventoryHash,
    });
    // The recognized quarantine is reported, never deleted or re-quarantined.
    await expect(stat(quarantinePath)).resolves.toBeTruthy();
    await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    // Repeated restarts stay stable and read-only.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      quarantinePath,
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it.each([0o750, 0o705, 0o701])(
    'fails closed when an existing retired quarantine has group/other permissions (%o)',
    async (mode) => {
      if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
      const activeServerDir = await makeServerDir();
      const stateRoot = await makeLegacyStateRoot(activeServerDir);
      const first = await inspectRetiredWorkspaceReplicationState({
        activeServerDir,
        installationId: 'installation-test',
        nowMs: 1_700_000_000_000,
        randomSuffix: `mode-${mode.toString(8)}`,
      });
      if (first.status !== 'legacy_workspace_sync_state_unsupported') {
        throw new Error('expected quarantine on first startup');
      }
      await chmod(first.quarantinePath, mode);

      await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
        status: 'legacy_workspace_sync_state_unknown',
        reason: 'malformed_retired_quarantine',
        path: first.quarantinePath,
      });
      await expect(stat(first.quarantinePath)).resolves.toBeTruthy();
      await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });

      await rm(activeServerDir, { recursive: true, force: true });
    },
  );

  it('fails unknown when more than one valid retired quarantine is present', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    const quarantine = async (nowMs: number, randomSuffix: string) => {
      await mkdir(join(stateRoot, 'jobs'), { recursive: true });
      await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
      await chmod(stateRoot, 0o700);
      await inspectRetiredWorkspaceReplicationState({
        activeServerDir,
        installationId: 'installation-test',
        nowMs,
        randomSuffix,
      });
    };

    await quarantine(1_700_000_000_000, 'first');
    await quarantine(1_700_000_000_001, 'second');

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'multiple_retired_quarantines',
    });
    await expect(readdir(activeServerDir)).resolves.toEqual(expect.arrayContaining([
      'workspace-replication.retired-v1-1700000000000-first',
      'workspace-replication.retired-v1-1700000000001-second',
    ]));

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown and leaves the directory untouched when a retired-v1-shaped directory has no valid marker', async () => {
    const activeServerDir = await makeServerDir();
    const fake = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-junk');
    await mkdir(join(fake, 'jobs'), { recursive: true });
    await writeFile(join(fake, 'jobs', 'job-1.json'), JSON.stringify({ schemaVersion: 1 }));

    // No marker at all.
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Malformed marker payload.
    await writeFile(join(fake, 'retirement.json'), JSON.stringify({ detectedSchemaVersion: 7 }));
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Marker timestamp disagreeing with the plan-owned directory name.
    await writeFile(join(fake, 'retirement.json'), JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_234_567_890_123,
      installationId: 'installation-test',
      inventoryHash: 'a'.repeat(64),
    }));
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // A symlink is never authoritative.
    const linked = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-link');
    await symlink(fake, linked);
    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    // Never deleted or re-quarantined.
    await expect(stat(fake)).resolves.toBeTruthy();
    await expect(readFile(join(fake, 'retirement.json'), 'utf8')).resolves.toBe(JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_234_567_890_123,
      installationId: 'installation-test',
      inventoryHash: 'a'.repeat(64),
    }));
    await expect(readFile(join(fake, 'jobs', 'job-1.json'), 'utf8')).resolves.toBe('{"schemaVersion":1}');

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('completes a private quarantine after a crash between rename and retirement marker publication', async () => {
    const activeServerDir = await makeServerDir();
    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-after-rename');
    await mkdir(join(quarantinePath, 'jobs'), { recursive: true });
    await writeFile(join(quarantinePath, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(quarantinePath, 0o700);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-after-rename',
      nowMs: 1_700_000_000_001,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      quarantinePath,
      inventoryHash: expect.any(String),
    });
    const marker = JSON.parse(await readFile(join(quarantinePath, 'retirement.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_700_000_000_000,
      installationId: 'installation-after-rename',
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown when the retirement marker inventory hash no longer matches the directory', async () => {
    const activeServerDir = await makeServerDir();
    const drifted = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-drift');
    await mkdir(join(drifted, 'staging'), { recursive: true });
    await writeFile(join(drifted, 'retirement.json'), JSON.stringify({
      detectedSchemaVersion: 1,
      detectedAtMs: 1_700_000_000_000,
      installationId: 'installation-test',
      inventoryHash: 'f'.repeat(64),
    }));

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
    });
    await expect(stat(drifted)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails unknown without mutation when a marked quarantine has nested content drift', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    const first = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'nested-drift',
    });
    if (first.status !== 'legacy_workspace_sync_state_unsupported') {
      throw new Error('expected quarantine on first startup');
    }
    const jobPath = join(first.quarantinePath, 'jobs', 'job-1.json');
    await writeFile(jobPath, JSON.stringify({ schemaVersion: 1, injected: true }));

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'malformed_retired_quarantine',
      path: first.quarantinePath,
    });
    await expect(readFile(jobPath, 'utf8')).resolves.toBe('{"schemaVersion":1,"injected":true}');
    await expect(stat(stateRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('ignores similarly named directories that do not match the exact plan-owned quarantine shape', async () => {
    const activeServerDir = await makeServerDir();
    await mkdir(join(activeServerDir, 'workspace-replication.retired-v1'), { recursive: true });
    await mkdir(join(activeServerDir, 'workspace-replication.backed-up-by-user'), { recursive: true });

    await expect(inspectRetiredWorkspaceReplicationState({ activeServerDir })).resolves.toMatchObject({
      status: 'absent',
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed when the state root is group/other writable', async () => {
    if (process.platform === 'win32' || typeof process.getuid !== 'function') return;
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o777);

    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
    })).resolves.toMatchObject({ status: 'legacy_workspace_sync_state_unknown' });
    await expect(stat(stateRoot)).resolves.toBeTruthy();

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed on Windows when the canonical protected-ACL boundary rejects, however private the POSIX mode looks', async () => {
    const activeServerDir = await makeServerDir();
    const canonicalServerDir = await realpath(activeServerDir);
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    const canonicalStateRoot = join(canonicalServerDir, 'workspace-replication');

    // The state root is 0o700 and owned by this user: POSIX mode bits are never
    // a Windows privacy proof.
    const rejectedState = windowsAclBoundaryStub([canonicalStateRoot]);
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'win32',
      windowsAclBoundary: rejectedState,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'ownership_or_permissions',
    });
    expect(rejectedState.verify).toHaveBeenCalledWith({ path: canonicalStateRoot, kind: 'directory' });

    // The containing active server directory carries the same requirement.
    const rejectedParent = windowsAclBoundaryStub([canonicalServerDir]);
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'win32',
      windowsAclBoundary: rejectedParent,
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'parent_ownership_or_permissions',
    });

    // Nothing was quarantined or otherwise mutated.
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('quarantines on Windows once the protected-ACL boundary verifies, and protects the quarantine natively', async () => {
    const activeServerDir = await makeServerDir();
    await makeLegacyStateRoot(activeServerDir);
    const windowsAclBoundary = windowsAclBoundaryStub();

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'winok',
      platform: 'win32',
      windowsAclBoundary,
    });

    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-winok');
    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      classification: 'retired_v1',
      quarantinePath,
    });
    expect(windowsAclBoundary.applyAndVerify).toHaveBeenCalledWith({ path: quarantinePath, kind: 'directory' });

    // A restart re-proves the quarantine through the same boundary and fails
    // closed when it can no longer be proven private.
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      platform: 'win32',
      windowsAclBoundary: windowsAclBoundaryStub([quarantinePath]),
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'malformed_retired_quarantine',
    });
    await expect(inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      platform: 'win32',
      windowsAclBoundary: windowsAclBoundaryStub(),
    })).resolves.toMatchObject({
      status: 'legacy_workspace_sync_state_unsupported',
      quarantinePath,
    });

    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed with private permissions before the visible rename when POSIX hardening is refused', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'chmodfail',
      platform: 'linux',
      setPosixPrivatePermissions: async () => {
        throw Object.assign(new Error('chmod denied'), { code: 'EPERM' });
      },
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'quarantine_permissions_failed',
      // The reported path must be the one that actually exists.
      path: stateRoot,
    });
    // The failed hardening step must not leave a visible quarantine behind.
    await expect(stat(join(
      activeServerDir,
      'workspace-replication.retired-v1-1700000000000-chmodfail',
    ))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('rejects a non-private released root without invoking a POSIX mutation hook', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    await chmod(stateRoot, 0o755);

    const setPosixPrivatePermissions = vi.fn(async () => undefined);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'chmodnoop',
      platform: 'linux',
      setPosixPrivatePermissions,
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'ownership_or_permissions',
      path: stateRoot,
    });
    expect(setPosixPrivatePermissions).not.toHaveBeenCalled();
    expect((await stat(stateRoot)).mode & 0o777).toBe(0o755);
    await expect(stat(join(
      activeServerDir,
      'workspace-replication.retired-v1-1700000000000-chmodnoop',
    ))).rejects.toMatchObject({ code: 'ENOENT' });
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('leaves a 0755 released root untouched because privacy must be proven before inspection', async () => {
    const activeServerDir = await makeServerDir();
    const stateRoot = join(activeServerDir, 'workspace-replication');
    await mkdir(join(stateRoot, 'jobs'), { recursive: true });
    await writeFile(join(stateRoot, 'jobs', 'job-1.json'), JSON.stringify(releasedJobRecord('job-1')));
    await chmod(stateRoot, 0o755);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'hardened',
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'ownership_or_permissions',
      path: stateRoot,
    });
    expect((await stat(stateRoot)).mode & 0o777).toBe(0o755);
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('fails closed on Windows before the rename when the protected-ACL boundary cannot harden the source', async () => {
    const activeServerDir = await makeServerDir();
    const canonicalServerDir = await realpath(activeServerDir);
    const stateRoot = await makeLegacyStateRoot(activeServerDir);
    const canonicalStateRoot = join(canonicalServerDir, 'workspace-replication');
    // The boundary accepts inspection of the source but cannot apply the
    // protected ACL: hardening fails before anything becomes visible.
    const failingApply = windowsAclBoundaryStub([canonicalStateRoot]);
    failingApply.verify = vi.fn(async () => {});

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      platform: 'win32',
      windowsAclBoundary: failingApply,
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'quarantine_permissions_failed',
      path: join(activeServerDir, 'workspace-replication'),
    });
    await expect(stat(stateRoot)).resolves.toBeTruthy();
    await expect(readdir(activeServerDir)).resolves.toEqual(['workspace-replication']);
    await rm(activeServerDir, { recursive: true, force: true });
  });

  it('reports the existing quarantine path when post-rename Windows hardening fails', async () => {
    const activeServerDir = await makeServerDir();
    await makeLegacyStateRoot(activeServerDir);
    const quarantinePath = join(activeServerDir, 'workspace-replication.retired-v1-1700000000000-winlate');
    const boundary = windowsAclBoundaryStub([quarantinePath]);

    const result = await inspectRetiredWorkspaceReplicationState({
      activeServerDir,
      installationId: 'installation-test',
      nowMs: 1_700_000_000_000,
      randomSuffix: 'winlate',
      platform: 'win32',
      windowsAclBoundary: boundary,
    });

    expect(result).toMatchObject({
      status: 'legacy_workspace_sync_state_unknown',
      reason: 'quarantine_permissions_failed',
      path: quarantinePath,
    });
    // The rename already happened, so the reported path is the quarantine.
    await expect(stat(quarantinePath)).resolves.toBeTruthy();
    await rm(activeServerDir, { recursive: true, force: true });
  });
});
