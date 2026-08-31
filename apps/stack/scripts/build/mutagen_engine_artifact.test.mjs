import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildMutagenEngineArtifactManifest,
  inspectMutagenForkSource,
  materializeMutagenForkSource,
  readMutagenEnginePolicy,
} from './mutagen_engine_artifact.mjs';

const FORK_SOURCE_BASE_COMMIT = 'f5ed5c91fa6c934f5678393c56d00362d6443a1d';
const FORK_RELEASE_COMMIT = '3a4774da2a75a0d2a5343e4980d9a03aa44ca81c';
const SPIKE_COMMIT = 'cd8069cf8b945dfa0d0f47d8685322c6f1e16e44';
const UPSTREAM_COMMIT = 'a225ae50aee3d7ebb59139203cb84e8a6a3ff4bf';

test('fork source inspection and materialization consume only the pinned clean checkout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-mutagen-source-'));
  const vendorRoot = await mkdtemp(join(tmpdir(), 'happier-mutagen-vendor-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
    git('init', '-b', 'happier/external-stream-v1');
    git('config', 'user.name', 'Mutagen Artifact Test');
    git('config', 'user.email', 'mutagen-artifact-test@example.invalid');
    git('remote', 'add', 'origin', 'https://github.com/happier-dev/mutagen.git');
    await writeFile(join(root, 'go.mod'), 'module github.com/mutagen-io/mutagen\n\ngo 1.22.12\n');
    await writeFile(join(root, 'README.md'), 'external stream source\n');
    git('add', 'go.mod', 'README.md');
    git('commit', '-m', 'test: establish source basis');
    const sourceBaseCommit = git('rev-parse', 'HEAD');
    git('tag', 'v0.18.1');
    await writeFile(join(root, 'fork-provenance.json'), `${JSON.stringify({
      remote: 'https://github.com/happier-dev/mutagen.git',
      branch: 'happier/external-stream-v1',
      sourceBaseCommit,
      transportSpikeCommit: sourceBaseCommit,
      upstreamTag: 'v0.18.1',
      upstreamCommit: sourceBaseCommit,
      toolchain: { go: '1.22.12' },
      protocol: { epoch: 'external-stream-v1', urlShape: 'external://<opaque-endpoint-id>' },
    }, null, 2)}\n`);
    git('add', 'fork-provenance.json');
    git('commit', '-m', 'chore: record stable fork provenance');
    const releaseCommit = git('rev-parse', 'HEAD');
    const defaultPolicy = await readMutagenEnginePolicy();
    const policy = {
      ...defaultPolicy,
      fork: {
        ...defaultPolicy.fork,
        sourceBaseCommit,
        releaseCommit,
        implementationState: 'immutable-release',
        transportSpikeCommit: sourceBaseCommit,
      },
      upstream: { tag: 'v0.18.1', commit: sourceBaseCommit },
    };

    const inspected = await inspectMutagenForkSource({ sourceRoot: root, policy });
    assert.equal(inspected.status, 'ok');
    const result = await materializeMutagenForkSource({
      sourceRoot: root,
      vendorRoot: join(vendorRoot, 'vendor'),
      policy,
    });
    assert.equal(result.status, 'ok');
    assert.equal(await readFile(join(result.vendorRoot, 'README.md'), 'utf8'), 'external stream source\n');
    assert.equal(await readFile(join(root, 'README.md'), 'utf8'), 'external stream source\n');
    const sourceMetadata = JSON.parse(await readFile(join(result.vendorRoot, 'MUTAGEN-SOURCE.json'), 'utf8'));
    assert.equal(sourceMetadata.source.commit, releaseCommit);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(vendorRoot, { recursive: true, force: true });
  }
});

test('stale source provenance is blocked before any vendor replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'happier-mutagen-stale-'));
  const vendorRoot = await mkdtemp(join(tmpdir(), 'happier-mutagen-stale-vendor-'));
  try {
    await writeFile(join(root, 'go.mod'), 'module github.com/mutagen-io/mutagen\n\ngo 1.22.0\n');
    await writeFile(join(root, 'fork-provenance.json'), JSON.stringify({
      forkCommitFull: '5582f67145136047dda45d17c97bdfc8a0a97bf0',
      protocol: 'external://id?path=/tmp/root&rootGrantId=grant',
    }));
    const result = await materializeMutagenForkSource({
      sourceRoot: root,
      vendorRoot: join(vendorRoot, 'vendor'),
      execFileImpl: async (_command, args) => {
        const joined = args.join(' ');
        if (joined.includes('rev-parse HEAD')) return { stdout: `${FORK_SOURCE_BASE_COMMIT}\n` };
        if (joined.includes('remote get-url origin')) return { stdout: 'https://github.com/happier-dev/mutagen.git\n' };
        if (joined.includes('branch --show-current')) return { stdout: 'happier/external-stream-v1\n' };
        if (joined.includes('status --porcelain')) return { stdout: '' };
        if (joined.includes('rev-parse v0.18.1')) return { stdout: `${UPSTREAM_COMMIT}\n` };
        if (joined.includes('merge-base --is-ancestor')) return { stdout: '' };
        throw new Error(`unexpected git invocation: ${joined}`);
      },
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.reason, 'mutagen_fork_source_unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(vendorRoot, { recursive: true, force: true });
  }
});

test('engine artifact manifest records the exact release commit, distinct from its source base', async () => {
  const payloadRoot = await mkdtemp(join(tmpdir(), 'happier-mutagen-payload-'));
  try {
    await mkdir(join(payloadRoot, 'bin'), { recursive: true });
    await mkdir(join(payloadRoot, 'licenses'), { recursive: true });
    const managerPath = join(payloadRoot, 'bin', 'happier-mutagen');
    const agentPath = join(payloadRoot, 'bin', 'happier-mutagen-agent');
    await writeFile(managerPath, 'manager-bytes');
    await writeFile(agentPath, 'agent-bytes');
    await chmod(managerPath, 0o755);
    await chmod(agentPath, 0o755);
    await writeFile(join(payloadRoot, 'licenses', 'MUTAGEN-LICENSE'), 'MIT\n');
    await writeFile(join(payloadRoot, 'licenses', 'THIRD-PARTY-NOTICES'), 'third-party notices\n');
    const defaultPolicy = await readMutagenEnginePolicy();
    const policy = {
      ...defaultPolicy,
      fork: {
        ...defaultPolicy.fork,
        releaseCommit: FORK_RELEASE_COMMIT,
        implementationState: 'immutable-release',
      },
    };

    const manifest = await buildMutagenEngineArtifactManifest({
      payloadRoot,
      engineVersion: '0.18.1',
      targetTriple: 'linux-amd64',
      policy,
    });

    assert.notEqual(FORK_RELEASE_COMMIT, defaultPolicy.fork.sourceBaseCommit);
    assert.equal(manifest.forkCommit, FORK_RELEASE_COMMIT);

    // The fork's tagcheck.go files make these tags load-bearing: the manager
    // (cmd/mutagen-sidecar) builds with -tags mutagensidecar and the agent
    // (cmd/mutagen-agent) with -tags mutagenagent. The manifest must record
    // exactly the tags the pair was built with, never an empty list.
    assert.deepEqual(manifest.buildTags, ['mutagenagent', 'mutagensidecar']);
    const stored = JSON.parse(
      await readFile(join(payloadRoot, '.happier-mutagen-engine.json'), 'utf8'),
    );
    assert.deepEqual(stored.buildTags, ['mutagenagent', 'mutagensidecar']);
    assert.equal(stored.forkCommit, FORK_RELEASE_COMMIT);
  } finally {
    await rm(payloadRoot, { recursive: true, force: true });
  }
});
