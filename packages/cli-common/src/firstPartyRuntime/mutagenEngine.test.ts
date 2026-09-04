import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  MUTAGEN_ENGINE_FORK_RELEASE_COMMIT,
  MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT,
  MUTAGEN_ENGINE_VERSION,
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
const FIXTURE_RELEASE_COMMIT = '3a4774da2a75a0d2a5343e4980d9a03aa44ca81c';
const APPROVED_FORK_RELEASE_COMMIT = '334d778e8c4bf055ad00e0f3991a8e5ed543950c';
const MUTAGEN_UMBRELLA_LICENSE = `Unless otherwise specified, all code in this repository is made available under
the terms of the MIT License, the text of which can be found below.

All code that resides under the sspl directory is made available under the terms
of the Server Side Public License, the text of which can be found in sspl/LICENSE.

MIT License
`;
const SSPL_V1_LICENSE = 'Server Side Public License\nVersion 1, October 16, 2018\n';

const VALID_MANIFEST = {
  schemaVersion: 1,
  component: 'mutagen-engine',
  engineVersion: '0.18.1',
  forkCommit: FIXTURE_RELEASE_COMMIT,
  sourceRepository: 'https://github.com/happier-dev/mutagen',
  sourceTag: 'mutagen-v0.18.1',
  sourceArchive: 'happier-mutagen-source-mutagen-v0.18.1.tar.gz',
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
  licensePolicy: 'mixed-mit-sspl',
  ssplEnabled: true,
  // Exact tags the fork release builds with: manager -tags mutagensidecar,
  // agent -tags mutagenagent, and both include the upstream SSPL implementation.
  buildTags: ['mutagensidecar', 'mutagensspl', 'mutagenagent'],
  managerBuildTags: ['mutagensidecar', 'mutagensspl'],
  agentBuildTags: ['mutagenagent', 'mutagensspl'],
  cgoEnabled: false,
  watcher: 'polling',
  managerSha256: createHash('sha256').update('manager').digest('hex'),
  agentSha256: createHash('sha256').update('agent').digest('hex'),
  releaseTag: 'mutagen-v0.18.1',
};

describe('Mutagen engine artifact contract', () => {
  it('pins the approved fork, upstream, toolchain, protocol, and target matrix', () => {
    expect(MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT).toMatch(/^[0-9a-f]{40}$/u);
    expect(MUTAGEN_ENGINE_FORK_RELEASE_COMMIT).toBe(APPROVED_FORK_RELEASE_COMMIT);
    expect(MUTAGEN_ENGINE_VERSION).toBe('0.18.1-happier.8');
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

  it('maps host platform values to the fixed release target matrix', () => {
    expect(resolveMutagenEngineArtifactTarget({ platform: 'darwin', arch: 'arm64' })).toBe('darwin-arm64');
    expect(resolveMutagenEngineArtifactTarget({ platform: 'linux', arch: 'x64' })).toBe('linux-amd64');
    expect(resolveMutagenEngineArtifactTarget({ platform: 'win32', arch: 'x64' })).toBe('windows-amd64');
    expect(() => resolveMutagenEngineArtifactTarget({ platform: 'linux', arch: 'arm' })).toThrow(/unsupported platform/i);
    expect(() => resolveMutagenEngineArtifactTarget({ platform: 'win32', arch: 'arm64' })).toThrow(/unsupported platform/i);
  });

  it('accepts only the approved mixed MIT and SSPL manager/agent manifest', () => {
    expect(assertMutagenEngineArtifactManifest(VALID_MANIFEST, {
      trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
    })).toMatchObject({
      schemaVersion: 1,
      component: 'mutagen-engine',
      targetTriple: 'linux-amd64',
      managerPath: 'bin/happier-mutagen',
      agentPath: 'bin/happier-mutagen-agent',
      licensePolicy: 'mixed-mit-sspl',
      ssplEnabled: true,
      sourceRepository: 'https://github.com/happier-dev/mutagen',
      sourceTag: 'mutagen-v0.18.1',
      sourceArchive: 'happier-mutagen-source-mutagen-v0.18.1.tar.gz',
      buildTags: ['mutagensidecar', 'mutagensspl', 'mutagenagent'],
      managerBuildTags: ['mutagensidecar', 'mutagensspl'],
      agentBuildTags: ['mutagenagent', 'mutagensspl'],
    });
  });

  it('never treats the source-base commit as the releasable artifact identity', () => {
    expect(FIXTURE_RELEASE_COMMIT).not.toBe(MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      forkCommit: MUTAGEN_ENGINE_FORK_SOURCE_BASE_COMMIT,
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/exact release commit/i);
    expect(() => assertMutagenEngineArtifactManifest(VALID_MANIFEST)).toThrow(/exact release commit/i);
  });

  it('rejects stale provenance, path-bearing protocol metadata, and unapproved license modes or tags', () => {
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
      licensePolicy: 'mit-only',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/SSPL|license/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      ssplEnabled: false,
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/SSPL|license/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      sourceRepository: 'https://example.invalid/mutagen',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/source repository/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      sourceTag: 'mutagen-v0.18.1-other',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/source tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      sourceArchive: 'source.tar.gz',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/source archive/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      managerBuildTags: ['mutagensidecar'],
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/manager build tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      agentBuildTags: ['mutagenagent'],
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/agent build tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      buildTags: ['mutagensidecar', 'mutagensspl'],
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/build tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      buildTags: [...VALID_MANIFEST.buildTags, 'experimental'],
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/build tag/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      watcher: 'fanotify-when-supported',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/watcher/i);
    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      rootGrantId: 'grant-01',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/unknown|field/i);

    expect(assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      targetTriple: 'darwin-arm64',
      toolchain: {
        ...VALID_MANIFEST.toolchain,
        goChecksum: MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256['darwin-arm64'],
      },
      buildTags: ['mutagensidecar', 'mutagensspl', 'mutagenagent'],
      agentBuildTags: ['mutagenagent', 'mutagensspl'],
      cgoEnabled: true,
      watcher: 'fsevents',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toMatchObject({
      targetTriple: 'darwin-arm64',
      agentBuildTags: ['mutagenagent', 'mutagensspl'],
    });
  });

  it('requires manager and agent binaries plus the license/checksum closure', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-mutagen-artifact-'));
    try {
      const paths = resolveMutagenEngineArtifactPaths(root, 'linux-amd64');
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(join(root, 'licenses'), { recursive: true });
      writeFileSync(paths.managerPath, 'manager');
      writeFileSync(paths.agentPath, 'agent');
      writeFileSync(paths.mutagenLicensePath, MUTAGEN_UMBRELLA_LICENSE);
      writeFileSync(paths.ssplLicensePath, SSPL_V1_LICENSE);
      writeFileSync(paths.thirdPartyNoticesPath, 'notices\n');
      const manifestText = JSON.stringify(VALID_MANIFEST);
      writeFileSync(paths.manifestPath, manifestText);
      const validChecksums = [
        `${VALID_MANIFEST.managerSha256}  bin/happier-mutagen`,
        `${VALID_MANIFEST.agentSha256}  bin/happier-mutagen-agent`,
        `${createHash('sha256').update(MUTAGEN_UMBRELLA_LICENSE).digest('hex')}  licenses/MUTAGEN-LICENSE`,
        `${createHash('sha256').update(SSPL_V1_LICENSE).digest('hex')}  licenses/SSPL-LICENSE`,
        `${createHash('sha256').update('notices\n').digest('hex')}  licenses/THIRD-PARTY-NOTICES`,
        `${createHash('sha256').update(manifestText).digest('hex')}  .happier-mutagen-engine.json`,
      ].join('\n').concat('\n');
      writeFileSync(paths.checksumsPath, validChecksums);
      chmodSync(paths.managerPath, 0o755);
      chmodSync(paths.agentPath, 0o755);

      expect(assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toMatchObject({ targetTriple: 'linux-amd64' });

      rmSync(paths.ssplLicensePath);
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/SSPL license.*missing/i);

      writeFileSync(paths.ssplLicensePath, '\n');
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/SSPL license/i);

      writeFileSync(paths.ssplLicensePath, SSPL_V1_LICENSE);
      writeFileSync(paths.checksumsPath, validChecksums.replace(VALID_MANIFEST.managerSha256, '0'.repeat(64)));
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/checksums/i);

      writeFileSync(paths.checksumsPath, validChecksums);
      writeFileSync(paths.ssplLicensePath, 'not an SSPL license\n');
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'linux-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/SSPL license/i);

      writeFileSync(paths.ssplLicensePath, SSPL_V1_LICENSE);

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

  it('requires the exact target-specific executable paths in manifests, payloads, and checksums', () => {
    expect(resolveMutagenEngineArtifactPaths('C:\\engine', 'windows-amd64')).toMatchObject({
      managerPath: join('C:\\engine', 'bin', 'happier-mutagen.exe'),
      agentPath: join('C:\\engine', 'bin', 'happier-mutagen-agent.exe'),
    });
    expect(resolveMutagenEngineArtifactPaths('/engine', 'linux-amd64')).toMatchObject({
      managerPath: join('/engine', 'bin', 'happier-mutagen'),
      agentPath: join('/engine', 'bin', 'happier-mutagen-agent'),
    });

    expect(() => assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      targetTriple: 'windows-amd64',
      toolchain: {
        ...VALID_MANIFEST.toolchain,
        goChecksum: MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256['windows-amd64'],
      },
      watcher: 'native',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toThrow(/canonical bin paths/i);

    expect(assertMutagenEngineArtifactManifest({
      ...VALID_MANIFEST,
      targetTriple: 'windows-amd64',
      toolchain: {
        ...VALID_MANIFEST.toolchain,
        goChecksum: MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256['windows-amd64'],
      },
      managerPath: 'bin/happier-mutagen.exe',
      agentPath: 'bin/happier-mutagen-agent.exe',
      watcher: 'native',
    }, { trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT })).toMatchObject({
      managerPath: 'bin/happier-mutagen.exe',
      agentPath: 'bin/happier-mutagen-agent.exe',
    });

    const root = mkdtempSync(join(tmpdir(), 'happier-mutagen-windows-artifact-'));
    try {
      const paths = resolveMutagenEngineArtifactPaths(root, 'windows-amd64');
      mkdirSync(join(root, 'bin'), { recursive: true });
      mkdirSync(join(root, 'licenses'), { recursive: true });
      writeFileSync(paths.managerPath, 'manager');
      writeFileSync(paths.agentPath, 'agent');
      writeFileSync(paths.mutagenLicensePath, MUTAGEN_UMBRELLA_LICENSE);
      writeFileSync(paths.ssplLicensePath, SSPL_V1_LICENSE);
      writeFileSync(paths.thirdPartyNoticesPath, 'notices\n');
      const manifest = {
        ...VALID_MANIFEST,
        targetTriple: 'windows-amd64',
        toolchain: {
          ...VALID_MANIFEST.toolchain,
          goChecksum: MUTAGEN_ENGINE_GO_DISTRIBUTION_SHA256['windows-amd64'],
        },
        managerPath: 'bin/happier-mutagen.exe',
        agentPath: 'bin/happier-mutagen-agent.exe',
        watcher: 'native',
      };
      const manifestText = JSON.stringify(manifest);
      writeFileSync(paths.manifestPath, manifestText);
      const checksumClosure = (managerPath: string, agentPath: string) => [
        `${VALID_MANIFEST.managerSha256}  ${managerPath}`,
        `${VALID_MANIFEST.agentSha256}  ${agentPath}`,
        `${createHash('sha256').update(MUTAGEN_UMBRELLA_LICENSE).digest('hex')}  licenses/MUTAGEN-LICENSE`,
        `${createHash('sha256').update(SSPL_V1_LICENSE).digest('hex')}  licenses/SSPL-LICENSE`,
        `${createHash('sha256').update('notices\n').digest('hex')}  licenses/THIRD-PARTY-NOTICES`,
        `${createHash('sha256').update(manifestText).digest('hex')}  .happier-mutagen-engine.json`,
      ].join('\n').concat('\n');

      writeFileSync(paths.checksumsPath, checksumClosure('bin/happier-mutagen', 'bin/happier-mutagen-agent'));
      expect(() => assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'windows-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toThrow(/checksums/i);

      writeFileSync(paths.checksumsPath, checksumClosure(manifest.managerPath, manifest.agentPath));
      expect(assertMutagenEngineArtifactPayload({
        payloadRoot: root,
        targetTriple: 'windows-amd64',
        trustedForkReleaseCommit: FIXTURE_RELEASE_COMMIT,
      })).toMatchObject({
        managerPath: manifest.managerPath,
        agentPath: manifest.agentPath,
      });
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
