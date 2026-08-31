import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  MUTAGEN_ENGINE_FORK_RELEASE_COMMIT,
  MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT,
  MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256,
  MUTAGEN_ENGINE_PROTOCOL_EPOCH,
  MUTAGEN_ENGINE_SUPPORTED_TARGETS,
  MUTAGEN_ENGINE_UPSTREAM_COMMIT,
  MUTAGEN_ENGINE_UPSTREAM_TAG,
  MUTAGEN_ENGINE_GO_VERSION,
  assertMutagenEngineArtifactManifest,
  assertMutagenEngineArtifactPayload,
  resolveMutagenEngineArtifactPaths,
  resolveMutagenEngineArtifactTarget,
  resolveMutagenEngineDataLayout,
  resolveMutagenEngineReleaseTag,
} from './mutagenEngineArtifact.js';
import { prepareMutagenEnginePayloadFromGitHubRelease } from './prepareMutagenEnginePayloadFromGitHubRelease.js';

const FIXTURE_RELEASE_COMMIT = '3a4774da2a75a0d2a5343e4980d9a03aa44ca81c';

const VALID_MANIFEST = {
  schemaVersion: 1,
  component: 'mutagen-engine',
  engineVersion: '0.18.1',
  forkCommit: FIXTURE_RELEASE_COMMIT,
  upstreamTag: MUTAGEN_ENGINE_UPSTREAM_TAG,
  upstreamCommit: MUTAGEN_ENGINE_UPSTREAM_COMMIT,
  toolchain: {
    go: MUTAGEN_ENGINE_GO_VERSION,
    goChecksum: MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256['linux-amd64'],
  },
  protocolEpoch: MUTAGEN_ENGINE_PROTOCOL_EPOCH,
  targetTriple: 'linux-amd64',
  managerPath: 'bin/happier-mutagen',
  agentPath: 'bin/happier-mutagen-agent',
  licensePolicy: 'mit-only',
  ssplEnabled: false,
  // Exact tags the fork release builds with: manager -tags mutagensidecar,
  // agent -tags mutagenagent (enforced by the fork's tagcheck.go files).
  buildTags: ['mutagenagent', 'mutagensidecar'],
  cgoEnabled: false,
  watcher: 'polling',
  managerSha256: createHash('sha256').update('manager').digest('hex'),
  agentSha256: createHash('sha256').update('agent').digest('hex'),
};

describe('Mutagen engine artifact contract', () => {
  it('pins the approved fork, upstream, toolchain, protocol, and target matrix', () => {
    expect(MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
    expect(MUTAGEN_ENGINE_FORK_RELEASE_COMMIT).toBeNull();
    expect(MUTAGEN_ENGINE_UPSTREAM_COMMIT).toBe('a225ae50aee3d7ebb59139203cb84e8a6a3ff4bf');
    expect(MUTAGEN_ENGINE_UPSTREAM_TAG).toBe('v0.18.1');
    expect(MUTAGEN_ENGINE_GO_VERSION).toBe('1.22.12');
    expect(MUTAGEN_ENGINE_PROTOCOL_EPOCH).toBe('external-stream-v1');
    expect(MUTAGEN_ENGINE_SUPPORTED_TARGETS).toEqual([
      'darwin-arm64',
      'darwin-amd64',
      'linux-amd64',
      'linux-arm64',
      'windows-amd64',
    ]);
  });

  it('resolves only immutable engine release tags', () => {
    expect(resolveMutagenEngineReleaseTag('0.18.1')).toBe('mutagen-v0.18.1');
    expect(resolveMutagenEngineReleaseTag('0.18.1-happier.2')).toBe('mutagen-v0.18.1-happier.2');
    expect(() => resolveMutagenEngineReleaseTag('')).toThrow(/engine version/i);
    expect(() => resolveMutagenEngineReleaseTag('latest')).toThrow(/engine version/i);
    expect(() => resolveMutagenEngineReleaseTag('mutagen-v0.18.1')).toThrow(/engine version/i);
  });

  it('blocks release preparation until the dirty implementation has an immutable commit', async () => {
    await expect(prepareMutagenEnginePayloadFromGitHubRelease({
      channel: 'stable',
      engineVersion: '0.18.1',
    })).rejects.toThrow(/mutagen_fork_release_commit_required/u);
  });

  it('maps host platform values to the fixed release target matrix', () => {
    expect(resolveMutagenEngineArtifactTarget({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64');
    expect(resolveMutagenEngineArtifactTarget({ platform: 'linux', arch: 'x64' })).toBe('linux-amd64');
    expect(resolveMutagenEngineArtifactTarget({ platform: 'win32', arch: 'x64' })).toBe('windows-amd64');
    expect(() => resolveMutagenEngineArtifactTarget({ platform: 'linux', arch: 'arm' })).toThrow(/unsupported platform/i);
    expect(() => resolveMutagenEngineArtifactTarget({ platform: 'win32', arch: 'arm64' })).toThrow(/unsupported platform/i);
  });

  it('accepts a complete non-SSPL manager/agent manifest', () => {
    expect(assertMutagenEngineArtifactManifest(VALID_MANIFEST, {
      trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
    })).toMatchObject({
      schemaVersion: 1,
      component: 'mutagen-engine',
      targetTriple: 'linux-amd64',
      managerPath: 'bin/happier-mutagen',
      agentPath: 'bin/happier-mutagen-agent',
      ssplEnabled: false,
      buildTags: ['mutagenagent', 'mutagensidecar'],
    });
  });

  it('never treats the source-base commit as the releasable artifact identity', () => {
    expect(FIXTURE_RELEASE_COMMIT).not.toBe(MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      forkCommit: MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT,
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/exact release commit/i);
    expect(() => assertMutagenEngineArtifactManifest(VALID_MANIFEST)).toThrow(
      /mutagen_fork_release_commit_required/u,
    );
  });

  it('rejects stale provenance, path-bearing protocol metadata, and SSPL builds', () => {
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      forkCommit: '5582f67145136047dda45d17c97bdfc8a0a97bf0',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/fork commit/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      protocol: 'external://id?path=/tmp/root&rootGrantId=grant',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/protocol/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      ssplEnabled: true,
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/SSPL|license/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      buildTags: ['mutagensspl'],
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/SSPL|build tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      rootGrantId: 'grant-01',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/unknown|field/i);
  });

  it('requires manager and agent binaries plus the license/checksum closure', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-mutagen-artifact-'));
    try {
      const paths = resolveMutagenEngineArtifactPaths(root);
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(join(root, 'licenses'), { recursive: true });
      writeFileSync(paths.managerPath, 'manager');
      writeFileSync(paths.agentPath, 'agent');
      writeFileSync(paths.mutagenLicensePath, 'MIT\n');
      writeFileSync(paths.thirdPartyNoticesPath, 'notices\n');
      writeFileSync(paths.checksumsPath, `${VALID_MANIFEST.managerSha256}  bin/happier-mutagen\n${VALID_MANIFEST.agentSha256}  bin/happier-mutagen-agent\n`);
      writeFileSync(paths.manifestPath, JSON.stringify(VALID_MANIFEST));
      chmodSync(paths.managerPath, 0o755);
      chmodSync(paths.agentPath, 0o755);

      expect(assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toMatchObject({ targetTriple: 'linux-amd64' });

      writeFileSync(paths.checksumsPath, `${'0'.repeat(64)}  bin/happier-mutagen\n${VALID_MANIFEST.agentSha256}  bin/happier-mutagen-agent\n`);
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/checksums/i);

      rmSync(paths.agentPath);
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/agent/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps managed data, broker, and staging paths isolated from stack dev-target data', () => {
    const layout = resolveMutagenEngineDataLayout({
      daemonDataRoot: '/home/tester/.happier/daemon',
      stackDevTargetMutagenDataDir: '/home/tester/.happier-stack/stacks/dev/mutagen/data',
    });
    expect(layout.dataDir).toBe('/home/tester/.happier/daemon/workspace-sync/mutagen/data');
    expect(layout.brokerDir).toBe('/home/tester/.happier/daemon/workspace-sync/mutagen/broker');
    expect(layout.stagingDir).toBe('/home/tester/.happier/daemon/workspace-sync/mutagen/staging');
    expect(() => resolveMutagenEngineDataLayout({
      daemonDataRoot: '/tmp/daemon',
      stackDevTargetMutagenDataDir: '/tmp/daemon/workspace-sync/mutagen/data',
    })).toThrow(/dev-target|isolat|data directory/i);
  });
});
