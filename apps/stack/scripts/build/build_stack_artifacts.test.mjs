import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as buildModule from './build_stack_artifacts.mjs';
import { createRuntimeArtifactFingerprint } from './runtime_artifact_identity.mjs';
import { resolveRuntimeBuildRequestIdentity } from './runtime_build_request_identity.mjs';

test('runtime artifact identity inputs include only the toolchains consumed by each component', async () => {
  assert.equal(typeof buildModule.collectRuntimeBuildToolchainInputs, 'function');
  const calls = [];
  const inputs = await buildModule.collectRuntimeBuildToolchainInputs({
    selection: {
      components: { web: true, server: true, daemon: true },
    },
    env: { HAPPIER_BUN_PATH: '/toolchain/bun' },
    commandProbe: (command) => command === 'corepack',
    resolveBunCommandImpl: () => '/toolchain/bun',
    resolveYarnCommandImpl: () => ({ cmd: 'corepack', args: ['yarn'] }),
    runCaptureImpl: async (command, args) => {
      calls.push([command, args]);
      return command === '/toolchain/bun' ? '1.2.3\n' : '1.22.22\n';
    },
    nodeVersion: 'v22.22.1',
  });

  assert.deepEqual(inputs, {
    web: ['node=v22.22.1'],
    server: ['node=v22.22.1', 'bun=1.2.3'],
    daemon: ['node=v22.22.1', 'bun=1.2.3', 'yarn=1.22.22'],
  });
  assert.deepEqual(calls, [
    ['/toolchain/bun', ['--version']],
    ['corepack', ['yarn', '--version']],
  ]);

  const webOnly = await buildModule.collectRuntimeBuildToolchainInputs({
    selection: {
      components: { web: true, server: false, daemon: false },
    },
    runCaptureImpl: async () => {
      throw new Error('web-only builds must not probe Bun or Yarn');
    },
    nodeVersion: 'v22.22.1',
  });
  assert.deepEqual(webOnly, {
    web: ['node=v22.22.1'],
    server: [],
    daemon: [],
  });

  const serverOnly = await buildModule.collectRuntimeBuildToolchainInputs({
    selection: {
      components: { web: false, server: true, daemon: false },
    },
    commandProbe: (command) => command === 'bun',
    resolveBunCommandImpl: () => '/toolchain/bun',
    runCaptureImpl: async () => '1.2.3\n',
    nodeVersion: 'v22.22.1',
  });
  assert.deepEqual(serverOnly, {
    web: [],
    server: ['node=v22.22.1', 'bun=1.2.3'],
    daemon: [],
  });
});

test('server-only builds do not create or consume a web artifact', async () => {
  assert.equal(typeof buildModule.buildSelectedStackArtifacts, 'function');
  const calls = [];
  const artifacts = await buildModule.buildSelectedStackArtifacts({
    selection: {
      components: { web: false, server: true, daemon: false },
    },
    stackBaseDir: '/published/artifacts',
    buildComponent: async (component, _builder, options = {}) => {
      calls.push({ component, options });
      return {
        artifactDir: `/fresh/${component}-artifact`,
        manifest: { artifactFingerprint: `fresh-${component}` },
      };
    },
  });

  assert.deepEqual(calls, [{ component: 'server', options: {} }]);
  assert.deepEqual(Object.keys(artifacts), ['server']);
});

test('selected components build in a simple serial owner-local order without server-web coupling', async () => {
  assert.equal(typeof buildModule.buildSelectedStackArtifacts, 'function');
  const calls = [];

  const artifacts = await buildModule.buildSelectedStackArtifacts({
    selection: {
      components: { web: true, server: true, daemon: true },
    },
    stackBaseDir: '/published/artifacts',
    buildComponent: async (component, _builder, options = {}) => {
      calls.push({ component, options });
      return {
        artifactDir: `/fresh/${component}-artifact`,
        manifest: { artifactFingerprint: `fresh-${component}` },
      };
    },
  });

  assert.deepEqual(calls, [
    { component: 'web', options: {} },
    { component: 'server', options: {} },
    { component: 'daemon', options: {} },
  ]);
  assert.deepEqual(Object.keys(artifacts), ['web', 'server', 'daemon']);
});

test('assertSelectedBuildPrerequisites does not require bun for web-only builds', () => {
  assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
  assert.doesNotThrow(() =>
    buildModule.assertSelectedBuildPrerequisites({
      selection: {
        components: {
          web: true,
          server: false,
          daemon: false,
        },
      },
      commandProbe: () => false,
    }),
  );
});

test('assertSelectedBuildPrerequisites fails fast when server artifacts need bun', () => {
  assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
  assert.throws(
    () =>
      buildModule.assertSelectedBuildPrerequisites({
        selection: {
          components: {
            web: false,
            server: true,
            daemon: false,
          },
        },
        commandProbe: () => false,
        env: {
          HOME: '/definitely-missing-home',
          BUN_INSTALL: '',
          USERPROFILE: '',
        },
      }),
    /bun.*required.*server/i,
  );
});

test('assertSelectedBuildPrerequisites fails fast for activate-runtime builds before web export starts', () => {
    assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
    assert.throws(
    () =>
      buildModule.assertSelectedBuildPrerequisites({
        selection: {
          components: {
            web: true,
            server: true,
            daemon: true,
          },
        },
        commandProbe: () => false,
        env: {
          HOME: '/definitely-missing-home',
          BUN_INSTALL: '',
          USERPROFILE: '',
        },
      }),
    /bun.*server and daemon/i,
  );
});

test('assertSelectedBuildPrerequisites fails fast when daemon artifacts need yarn or corepack', () => {
  assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
  assert.throws(
    () =>
      buildModule.assertSelectedBuildPrerequisites({
        selection: {
          components: {
            web: false,
            server: false,
            daemon: true,
          },
        },
        commandProbe: (cmd) => cmd === 'bun',
      }),
    /yarn or corepack/i,
  );
});

test('assertSelectedBuildPrerequisites fails fast when daemon support needs Go', () => {
  assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
  assert.throws(
    () =>
      buildModule.assertSelectedBuildPrerequisites({
        selection: {
          components: {
            web: false,
            server: false,
            daemon: true,
          },
        },
        commandProbe: (cmd) => cmd === 'bun' || cmd === 'yarn',
      }),
    /go.*required.*daemon support/i,
  );
});

test('assertSelectedBuildPrerequisites accepts bun from BUN_INSTALL even when PATH probe misses it', () => {
  assert.equal(typeof buildModule.assertSelectedBuildPrerequisites, 'function');
  const tempRoot = mkdtempSync(join(tmpdir(), 'stack-build-prereq-bun-'));
  try {
    const bunInstallDir = join(tempRoot, '.bun');
    const bunBinDir = join(bunInstallDir, 'bin');
    const bunPath = join(bunBinDir, process.platform === 'win32' ? 'bun.exe' : 'bun');
    mkdirSync(bunBinDir, { recursive: true });
    writeFileSync(bunPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', {
      mode: 0o755,
    });

    assert.doesNotThrow(() =>
      buildModule.assertSelectedBuildPrerequisites({
        selection: {
          components: {
            web: false,
            server: true,
            daemon: false,
          },
        },
        commandProbe: () => false,
        env: {
          BUN_INSTALL: bunInstallDir,
        },
      }),
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('the artifact coordinator settles daemon workspace publication before capturing build identities', async () => {
  assert.equal(typeof buildModule.buildRuntimeArtifactComponents, 'function');
  const events = [];
  const stackBaseDir = '/stacks/repository-producer';
  const fixtureRepoRoot = mkdtempSync(join(tmpdir(), 'runtime-build-preidentity-publication-'));
  const fixtureStackRoot = join(fixtureRepoRoot, 'apps', 'stack');
  mkdirSync(fixtureStackRoot, { recursive: true });
  const installedWorkspacePath = join(
    fixtureRepoRoot,
    'apps',
    'cli',
    'node_modules',
    '@happier-dev',
    'protocol',
    'dist',
    'identity.txt',
  );
  mkdirSync(join(installedWorkspacePath, '..'), { recursive: true });
  writeFileSync(installedWorkspacePath, 'stale', 'utf8');

  try {
    const result = await buildModule.buildRuntimeArtifactComponents({
      rootDir: fixtureStackRoot,
      stackBaseDir,
      selection: {
        components: { web: false, server: true, daemon: true },
        activateRuntime: false,
        forceRebuild: false,
      },
      env: {},
      assertSelectedBuildPrerequisitesImpl: () => {},
      prepareCliBinaryArtifactWorkspacePublicationImpl: async ({ repoRoot }) => {
        assert.equal(repoRoot, fixtureRepoRoot);
        events.push('daemon-workspace-publication');
        writeFileSync(installedWorkspacePath, 'settled', 'utf8');
      },
      collectBuildSourceMetadataImpl: async ({ rootDir }) => {
        assert.equal(rootDir, fixtureStackRoot);
        events.push('source-metadata');
        return {
          repoDir: fixtureRepoRoot,
          sourceFingerprint: 'provenance-a',
          builtAt: '2026-08-16T12:00:00.000Z',
          serverComponent: 'happier-server-light',
          dbProvider: 'sqlite',
        };
      },
      resolveRuntimeBuildRequestIdentityImpl: async () => {
        assert.equal(readFileSync(installedWorkspacePath, 'utf8'), 'settled');
        events.push('build-request-identity');
        return {
          sourceMetadata: {
            repoDir: fixtureRepoRoot,
            sourceFingerprint: 'provenance-a',
            builtAt: '2026-08-16T12:00:00.000Z',
            serverComponent: 'happier-server-light',
            dbProvider: 'sqlite',
          },
          artifactFingerprints: { server: 'server-code-a', daemon: 'daemon-code-a' },
          supportArtifactFingerprints: { server: 'server-support-a', daemon: 'daemon-support-a' },
        };
      },
      withWorkspaceBundleLockImpl: async (fn, options) => {
        assert.equal(
          options.lockPath,
          events.includes('server-payload')
            ? join(stackBaseDir, 'artifacts', 'daemon', 'daemon-code-a.lock')
            : join(stackBaseDir, 'artifacts', 'server', 'server-code-a.lock'),
        );
        assert.equal(options.lockPath.includes('/runtime/'), false);
        events.push(`component-lock:${options.lockPath.includes(join('artifacts', 'daemon')) ? 'daemon' : 'server'}`);
        return await fn({ waited: false });
      },
      buildSelectedStackArtifactsImpl: async ({ buildComponent }) => ({
        server: await buildComponent('server', async (input) => {
          assert.deepEqual(events, [
            'source-metadata',
            'daemon-workspace-publication',
            'build-request-identity',
            'component-lock:server',
          ]);
          assert.equal(input.supportArtifactFingerprint, 'server-support-a');
          events.push('server-payload');
          return {
            artifactDir: '/stacks/repository-producer/artifacts/server/server-code-a',
            manifest: {
              component: 'server',
              artifactFingerprint: 'server-code-a',
              serverSupportArtifactFingerprint: 'server-support-a',
            },
          };
        }),
        daemon: await buildComponent('daemon', async (input) => {
          assert.deepEqual(events, [
            'source-metadata',
            'daemon-workspace-publication',
            'build-request-identity',
            'component-lock:server',
            'server-payload',
            'component-retention:server',
            'component-retention:server-support',
            'component-lock:daemon',
          ]);
          assert.equal(input.supportArtifactFingerprint, 'daemon-support-a');
          events.push('daemon-payload');
          return {
            artifactDir: '/stacks/repository-producer/artifacts/daemon/daemon-code-a',
            manifest: {
              component: 'daemon',
              artifactFingerprint: 'daemon-code-a',
              daemonSupportArtifactFingerprint: 'daemon-support-a',
            },
          };
        }),
      }),
      pruneComponentArtifactsImpl: async ({ component }) => events.push(`component-retention:${component}`),
    });

    assert.deepEqual(events, [
      'source-metadata',
      'daemon-workspace-publication',
      'build-request-identity',
      'component-lock:server',
      'server-payload',
      'component-retention:server',
      'component-retention:server-support',
      'component-lock:daemon',
      'daemon-payload',
      'component-retention:daemon',
      'component-retention:daemon-support',
    ]);
    assert.equal(readFileSync(installedWorkspacePath, 'utf8'), 'settled');
    assert.equal(result.artifacts.server.manifest.artifactFingerprint, 'server-code-a');
    assert.equal(result.artifacts.daemon.manifest.artifactFingerprint, 'daemon-code-a');
  } finally {
    rmSync(fixtureRepoRoot, { recursive: true, force: true });
  }
});

test('same component identity builds once while its waiter reuses the published object', async () => {
  assert.equal(typeof buildModule.buildComponentArtifactWithIdentityLock, 'function');
  const stackBaseDir = mkdtempSync(join(tmpdir(), 'runtime-component-identity-lock-'));
  const completedPath = join(stackBaseDir, 'artifact-published');
  let expensiveBuilds = 0;
  const buildArtifact = async () => {
    if (existsSync(completedPath)) return { reused: true };
    expensiveBuilds += 1;
    await new Promise((resolve) => setTimeout(resolve, 75));
    writeFileSync(completedPath, 'published\n', 'utf8');
    return { reused: false };
  };

  try {
    const [first, second] = await Promise.all([
      buildModule.buildComponentArtifactWithIdentityLock({
        stackBaseDir,
        component: 'server',
        artifactFingerprint: 'same-server-code',
        buildArtifact,
      }),
      buildModule.buildComponentArtifactWithIdentityLock({
        stackBaseDir,
        component: 'server',
        artifactFingerprint: 'same-server-code',
        buildArtifact,
      }),
    ]);

    assert.equal(expensiveBuilds, 1);
    assert.deepEqual([first.reused, second.reused].sort(), [false, true]);
  } finally {
    rmSync(stackBaseDir, { recursive: true, force: true });
  }
});

test('repository publication holds the runtime lock only for producer snapshot commit and never selects a consumer', async () => {
  assert.equal(typeof buildModule.publishBuiltRepositoryRuntimeSnapshot, 'function');
  const events = [];
  let runtimeLockHeld = false;
  const authority = {
    consumerStackName: 'source-main',
    consumerStackBaseDir: '/stacks/source-main',
    producerStackName: 'repo-producer',
    producerStackBaseDir: '/stacks/repo-producer',
  };
  const artifacts = Object.fromEntries(['web', 'server', 'daemon'].map((component) => [component, {
    artifactDir: `/stacks/repo-producer/artifacts/${component}/${component}-new`,
    manifest: { artifactFingerprint: `${component}-new` },
  }]));

  const result = await buildModule.publishBuiltRepositoryRuntimeSnapshot({
    authority,
    selection: {
      components: { web: true, server: true, daemon: true },
      activateRuntime: true,
    },
    requestedComponents: ['web', 'server', 'daemon'],
    sourceMetadata: {
      serverComponent: 'happier-server-light',
      dbProvider: 'sqlite',
      sourceFingerprint: 'provenance-only',
      builtAt: '2026-08-16T12:00:00.000Z',
    },
    artifacts,
    env: {},
    retentionPolicy: { runtimeSnapshotKeepCount: 2, artifactKeepCount: 2 },
    withWorkspaceBundleLockImpl: async (fn, options) => {
      assert.equal(options.lockPath, join(authority.producerStackBaseDir, 'runtime', 'build.lock'));
      runtimeLockHeld = true;
      try {
        return await fn({ waited: false });
      } finally {
        runtimeLockHeld = false;
      }
    },
    inspectActiveRuntimeSnapshotImpl: async () => {
      assert.equal(runtimeLockHeld, true);
      events.push('validate-current');
      return { valid: false, manifest: null, snapshot: null };
    },
    publishRuntimeSnapshotImpl: async (input) => {
      assert.equal(runtimeLockHeld, true);
      assert.equal(input.pruneAfterPublish, false);
      events.push('publish-manifest');
      return {
        snapshotId: input.snapshotId,
        snapshotPath: `/stacks/repo-producer/runtime/builds/${input.snapshotId}`,
        reused: false,
      };
    },
    selectRuntimeSnapshotImpl: async (input) => {
      assert.equal(runtimeLockHeld, true);
      assert.equal(input.consumerStackBaseDir, authority.producerStackBaseDir);
      events.push('select-producer');
      return {
        snapshotId: input.snapshotId,
        snapshotPath: `/stacks/repo-producer/runtime/builds/${input.snapshotId}`,
        currentPath: '/stacks/repo-producer/runtime/current.json',
      };
    },
    pruneRuntimeSnapshotsImpl: async () => {
      assert.equal(runtimeLockHeld, false);
      events.push('retention');
    },
  });

  assert.deepEqual(events, ['validate-current', 'publish-manifest', 'select-producer', 'retention']);
  assert.equal(result.selected, false);
  assert.equal(result.components.join(','), 'web,server,daemon');
  assert.equal(result.snapshotId.length > 0, true);
});

test('repository publication preflight forwards daemon without reading stale installed workspace identity', async () => {
  assert.equal(typeof buildModule.resolveRepositoryRuntimePublicationComponents, 'function');
  const fixtureRepoRoot = mkdtempSync(join(tmpdir(), 'runtime-publication-preflight-'));
  const installedWorkspacePath = join(fixtureRepoRoot, 'apps', 'cli', 'node_modules', 'identity.txt');
  mkdirSync(join(installedWorkspacePath, '..'), { recursive: true });
  writeFileSync(installedWorkspacePath, 'stale-installed-workspace', 'utf8');
  const staleDaemonArtifactFingerprint = createRuntimeArtifactFingerprint({
    component: 'daemon',
    sourceMetadata: {
      repoDir: fixtureRepoRoot,
      sourceFingerprint: 'source-a',
      builtAt: '2026-08-16T12:00:00.000Z',
      serverComponent: 'happier-server-light',
      dbProvider: 'sqlite',
    },
    componentSourceFingerprint: 'daemon-source-a',
    supportArtifactFingerprint: 'daemon-support-a',
    toolchainInputs: [],
  });

  let identityResolutionCalls = 0;
  try {
    const result = await buildModule.resolveRepositoryRuntimePublicationComponents({
      rootDir: fixtureRepoRoot,
      authority: { producerStackBaseDir: '/stacks/repo-producer' },
      requestedComponents: ['daemon'],
      inspectActiveRuntimeSnapshotImpl: async () => ({
        valid: true,
        snapshot: { snapshotId: 'snapshot-current' },
        manifest: {
          components: {
            daemon: { artifactFingerprint: staleDaemonArtifactFingerprint },
          },
        },
      }),
      resolveRuntimeBuildRequestIdentityImpl: async (input) => {
        identityResolutionCalls += 1;
        return await resolveRuntimeBuildRequestIdentity({
          ...input,
          sourceMetadata: {
            repoDir: fixtureRepoRoot,
            sourceFingerprint: 'source-a',
            builtAt: '2026-08-16T12:00:00.000Z',
            serverComponent: 'happier-server-light',
            dbProvider: 'sqlite',
          },
          assertSelectedBuildPrerequisitesImpl: () => {},
          collectRuntimeBuildToolchainInputsImpl: async () => ({ daemon: [] }),
          collectRuntimeComponentSourceFingerprintsImpl: async () => {
            assert.equal(readFileSync(installedWorkspacePath, 'utf8'), 'stale-installed-workspace');
            return { daemon: 'daemon-source-a' };
          },
          resolveDaemonSupportArtifactFingerprintImpl: async () => 'daemon-support-a',
        });
      },
    });

    assert.deepEqual(result, {
      components: ['daemon'],
      currentSnapshotId: 'snapshot-current',
    });
    assert.equal(identityResolutionCalls, 0);
  } finally {
    rmSync(fixtureRepoRoot, { recursive: true, force: true });
  }
});

test('repository publication preflight filters non-daemon identities while forwarding daemon', async () => {
  assert.equal(typeof buildModule.resolveRepositoryRuntimePublicationComponents, 'function');
  const result = await buildModule.resolveRepositoryRuntimePublicationComponents({
    rootDir: '/repo',
    authority: { producerStackBaseDir: '/stacks/repo-producer' },
    requestedComponents: ['daemon', 'server', 'outside-domain'],
    inspectActiveRuntimeSnapshotImpl: async () => ({
      valid: true,
      snapshot: { snapshotId: 'snapshot-current' },
      manifest: {
        components: {
          server: { artifactFingerprint: 'server-current' },
          daemon: { artifactFingerprint: 'daemon-old' },
        },
      },
    }),
    resolveRuntimeBuildRequestIdentityImpl: async ({ selection }) => {
      assert.deepEqual(selection.components, { web: false, server: true, daemon: false, tauri: false });
      return { artifactFingerprints: { server: 'server-current' } };
    },
  });

  assert.deepEqual(result, {
    components: ['daemon'],
    currentSnapshotId: 'snapshot-current',
  });
});
