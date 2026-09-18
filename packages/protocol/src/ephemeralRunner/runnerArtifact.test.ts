import { describe, expect, it } from 'vitest';

import {
  RUNNER_ARTIFACT_PRODUCT,
  RUNNER_ARTIFACT_TARGETS,
  RunnerArtifactArchiveMetadataV1Schema,
  RunnerArtifactAvailabilityProjectionV1Schema,
  RunnerArtifactIdentityV1Schema,
  VerifiedRunnerArtifactV1Schema,
  runnerArtifactTargetForPlatform,
  runnerArtifactTargetPlatform,
} from './runnerArtifact.js';

describe('Runner artifact identity', () => {
  it('advertises exactly the approved initial target ids', () => {
    expect(RUNNER_ARTIFACT_TARGETS).toEqual([
      'linux-x64',
      'linux-arm64',
      'darwin-x64',
      'darwin-arm64',
      'windows-x64',
    ]);
  });

  it('pins one immutable product/version/target/digest identity', () => {
    const identity = RunnerArtifactIdentityV1Schema.parse({
      product: RUNNER_ARTIFACT_PRODUCT,
      version: '0.3.0',
      target: 'darwin-arm64',
      sha256: 'a'.repeat(64),
    });
    expect(identity).toEqual({
      product: 'happier-runner',
      version: '0.3.0',
      target: 'darwin-arm64',
      sha256: 'a'.repeat(64),
    });
  });

  it('rejects another product, an unknown target, a non-digest and unknown fields', () => {
    const base = {
      product: RUNNER_ARTIFACT_PRODUCT,
      version: '0.3.0',
      target: 'linux-x64',
      sha256: 'b'.repeat(64),
    };
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, product: 'happier' }).success).toBe(false);
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, target: 'windows-arm64' }).success).toBe(false);
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, sha256: 'A'.repeat(64) }).success).toBe(false);
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, sha256: 'b'.repeat(63) }).success).toBe(false);
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, version: '' }).success).toBe(false);
    expect(RunnerArtifactIdentityV1Schema.safeParse({ ...base, url: 'https://example.test/a' }).success).toBe(false);
  });

  it('maps each target to the release manifest platform vocabulary in both directions', () => {
    for (const target of RUNNER_ARTIFACT_TARGETS) {
      const platform = runnerArtifactTargetPlatform(target);
      expect(runnerArtifactTargetForPlatform(platform)).toBe(target);
    }
    expect(runnerArtifactTargetPlatform('windows-x64')).toEqual({ os: 'windows', arch: 'x64' });
    expect(runnerArtifactTargetForPlatform({ os: 'win32', arch: 'x64' })).toBeNull();
    expect(runnerArtifactTargetForPlatform({ os: 'windows', arch: 'arm64' })).toBeNull();
  });

  it('projects only verified immutable artifacts through the availability contract', () => {
    const artifact = {
      identity: {
        product: RUNNER_ARTIFACT_PRODUCT,
        version: '0.3.0',
        target: 'linux-x64',
        sha256: 'c'.repeat(64),
      },
      channel: 'stable',
      url: 'https://example.test/happier-runner.tar.gz',
      checksumsUrl: 'https://example.test/checksums.txt',
      checksumsSignatureUrl: 'https://example.test/checksums.txt.minisig',
      sizeBytes: 123,
      entries: [{ path: 'happier-runner', kind: 'file', sizeBytes: 100, mode: 0o755 }],
    };

    expect(VerifiedRunnerArtifactV1Schema.parse(artifact)).toEqual(artifact);
    expect(RunnerArtifactAvailabilityProjectionV1Schema.parse({
      status: 'available',
      artifacts: [artifact],
    })).toEqual({ status: 'available', artifacts: [artifact] });
    expect(VerifiedRunnerArtifactV1Schema.safeParse({ ...artifact, trusted: true }).success).toBe(false);
    expect(VerifiedRunnerArtifactV1Schema.safeParse({ ...artifact, sizeBytes: 0 }).success).toBe(false);
    expect(VerifiedRunnerArtifactV1Schema.safeParse({ ...artifact, entries: [] }).success).toBe(false);
    const duplicatePathEntries = [
      artifact.entries[0],
      { ...artifact.entries[0], path: 'HAPPIER-RUNNER' },
    ];
    expect(RunnerArtifactArchiveMetadataV1Schema.safeParse({
      sizeBytes: artifact.sizeBytes,
      entries: duplicatePathEntries,
    }).success).toBe(false);
    expect(VerifiedRunnerArtifactV1Schema.safeParse({
      ...artifact,
      entries: duplicatePathEntries,
    }).success).toBe(false);
    expect(RunnerArtifactAvailabilityProjectionV1Schema.safeParse({
      status: 'available',
      artifacts: [{ ...artifact, entries: duplicatePathEntries }],
    }).success).toBe(false);
    expect(RunnerArtifactAvailabilityProjectionV1Schema.safeParse({
      status: 'available',
      artifacts: [{ ...artifact, identity: { ...artifact.identity, sha256: 'C'.repeat(64) } }],
    }).success).toBe(false);
  });
});
