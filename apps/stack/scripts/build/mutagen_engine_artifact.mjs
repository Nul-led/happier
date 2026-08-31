#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '../../../..');
const defaultPolicyPath = join(repoRoot, 'packages/cli-common/mutagen-engine.json');
const DEFAULT_VENDOR_ROOT = join(repoRoot, 'packages/cli-common/mutagen-engine/vendor');
export const MUTAGEN_SOURCE_METADATA_FILE = 'MUTAGEN-SOURCE.json';

/**
 * Exact Go build tags used for the pinned manager/agent pair, enforced by the
 * fork's tagcheck.go files: the manager (cmd/mutagen-sidecar) builds with
 * -tags mutagensidecar and the agent (cmd/mutagen-agent) with -tags
 * mutagenagent. Recorded in the artifact manifest so build identity stays
 * truthful; this list must match the fork release workflow's go build lines.
 */
const MUTAGEN_ENGINE_BUILD_TAGS = ['mutagenagent', 'mutagensidecar'];

export async function readMutagenEnginePolicy({ policyPath = defaultPolicyPath } = {}) {
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  if (!isRecord(policy) || policy.component !== 'mutagen-engine' || policy.schemaVersion !== 1) {
    throw new Error('[mutagen-engine] policy must describe schema version 1 of mutagen-engine');
  }
  return policy;
}

export function resolveMutagenForkSourceRoot({ repoRoot: root = repoRoot, sourceRoot, defaultSibling = '../happier-mutagen' } = {}) {
  const candidate = String(sourceRoot ?? process.env.HAPPIER_MUTAGEN_FORK_SOURCE_ROOT ?? '').trim()
    || resolve(resolve(root), defaultSibling);
  const resolvedRoot = resolve(candidate);
  const resolvedRepoRoot = resolve(root);
  const rel = relative(resolvedRepoRoot, resolvedRoot);
  if (!rel || (!rel.startsWith('..') && !rel.startsWith(`..${requirePathSeparator()}`))) {
    throw new Error('[mutagen-engine] fork source must remain outside the Happier workspace');
  }
  return resolvedRoot;
}

export async function inspectMutagenForkSource({
  sourceRoot,
  policy,
  execFileImpl = execFileAsync,
} = {}) {
  const resolvedPolicy = policy ?? await readMutagenEnginePolicy();
  const root = resolveMutagenForkSourceRoot({
    sourceRoot,
    defaultSibling: resolvedPolicy.sourceStrategy?.defaultSibling ?? '../happier-mutagen',
  });
  if (!await exists(root)) return blocked('mutagen_fork_source_unavailable', 'fork source directory does not exist', { sourceRoot: root });

  const fork = resolvedPolicy.fork ?? {};
  const upstream = resolvedPolicy.upstream ?? {};
  const toolchain = resolvedPolicy.toolchain ?? {};
  const expectedCommit = fork.releaseCommit ?? fork.sourceBaseCommit;
  const issues = [];
  const git = async (args) => {
    try {
      const result = await execFileImpl('git', ['-C', root, ...args], { maxBuffer: 2 * 1024 * 1024 });
      return String(result?.stdout ?? '').trim();
    } catch (error) {
      issues.push(`git ${args.join(' ')} failed: ${error instanceof Error ? error.message : String(error)}`);
      return '';
    }
  };
  const observedCommit = await git(['rev-parse', 'HEAD']);
  if (observedCommit !== expectedCommit) issues.push(`fork commit is ${observedCommit || '<unknown>'}, expected ${expectedCommit}`);
  const remote = await git(['remote', 'get-url', 'origin']);
  if (remote !== fork.remote) issues.push(`fork remote is ${remote || '<unknown>'}, expected ${fork.remote}`);
  const branch = await git(['branch', '--show-current']);
  if (branch !== fork.branch) issues.push(`fork branch is ${branch || '<unknown>'}, expected ${fork.branch}`);
  const dirty = await git(['status', '--porcelain', '--untracked-files=all']);
  if (dirty && fork.releaseCommit) issues.push('fork source checkout is dirty');

  try {
    await execFileImpl('git', ['-C', root, 'merge-base', '--is-ancestor', fork.transportSpikeCommit, 'HEAD'], { maxBuffer: 64 * 1024 });
  } catch {
    issues.push(`transport spike ${fork.transportSpikeCommit} is not reachable from HEAD`);
  }
  const upstreamCommit = await git(['rev-parse', `${upstream.tag}^{commit}`]);
  if (upstreamCommit && upstreamCommit !== upstream.commit) {
    issues.push(`upstream tag ${upstream.tag} resolves to ${upstreamCommit}, expected ${upstream.commit}`);
  }

  const goMod = await readOptional(join(root, 'go.mod'));
  const goMatch = /^go\s+([^\s]+)$/mu.exec(goMod ?? '');
  if (goMatch?.[1] !== toolchain.go) issues.push(`go.mod must pin Go ${toolchain.go}`);
  const forbiddenReferences = await findForbiddenSourceReferences(root);
  if (forbiddenReferences.length > 0) {
    issues.push(`fork source contains forbidden protocol/license references: ${forbiddenReferences.join(', ')}`);
  }
  const provenance = await readJson(join(root, 'fork-provenance.json'));
  const protocolValid = isRecord(provenance?.protocol)
    && provenance.protocol.urlShape === 'external://<opaque-endpoint-id>';
  if (!isRecord(provenance)
    || provenance.remote !== fork.remote
    || provenance.branch !== fork.branch
    || provenance.sourceBaseCommit !== fork.sourceBaseCommit
    || provenance.releaseCommit !== fork.releaseCommit
    || provenance.transportSpikeCommit !== fork.transportSpikeCommit
    || provenance.upstreamTag !== upstream.tag
    || provenance.upstreamCommit !== upstream.commit
    || provenance.toolchain?.go !== toolchain.go
    || !protocolValid) {
    issues.push('fork-provenance.json does not match the pinned source, toolchain, and opaque protocol policy');
  }
  if (issues.length > 0) {
    return blocked('mutagen_fork_source_unavailable', issues.join('; '), {
      sourceRoot: root,
      observedCommit,
      remote,
      branch,
      forbiddenReferences,
      issues,
    });
  }
  if (!fork.releaseCommit) {
    return blocked('mutagen_fork_release_commit_required', 'the implemented fork bytes are dirty and have no immutable release commit; commit them, then pin releaseCommit before materialization or publication', {
      sourceRoot: root,
      sourceBaseCommit: fork.sourceBaseCommit,
      observedCommit,
      remote,
      branch,
      dirty: Boolean(dirty),
    });
  }
  return {
    status: 'ok',
    sourceRoot: root,
    observedCommit,
    remote,
    branch,
    policy: resolvedPolicy,
  };
}

/**
 * Copy a verified external fork checkout into an ignored, reproducible vendor
 * tree.  The source checkout is never modified and failed validation leaves
 * any previous vendor tree untouched.
 */
export async function materializeMutagenForkSource({
  sourceRoot,
  vendorRoot = DEFAULT_VENDOR_ROOT,
  policy,
  execFileImpl = execFileAsync,
} = {}) {
  const resolvedPolicy = policy ?? await readMutagenEnginePolicy();
  const inspection = await inspectMutagenForkSource({ sourceRoot, policy: resolvedPolicy, execFileImpl });
  if (inspection.status !== 'ok') return inspection;
  const parent = dirname(resolve(vendorRoot));
  await mkdir(parent, { recursive: true });
  const stagingRoot = await mkdtemp(join(parent, '.mutagen-engine-vendor-'));
  const stagedVendorRoot = join(stagingRoot, basename(resolve(vendorRoot)));
  try {
    await cp(inspection.sourceRoot, stagedVendorRoot, {
      recursive: true,
      filter: (path) => {
        const rel = relative(inspection.sourceRoot, path).replaceAll('\\', '/');
        return rel === '' || (!rel.startsWith('.git/') && rel !== '.git' && !rel.startsWith('node_modules/'));
      },
    });
    const metadata = {
      schemaVersion: 1,
      source: {
        remote: resolvedPolicy.fork.remote,
        branch: resolvedPolicy.fork.branch,
        commit: inspection.observedCommit,
        transportSpikeCommit: resolvedPolicy.fork.transportSpikeCommit,
      },
      upstream: resolvedPolicy.upstream,
      toolchain: resolvedPolicy.toolchain,
      protocol: resolvedPolicy.protocol,
      license: resolvedPolicy.license,
      materializer: 'apps/stack/scripts/build/mutagen_engine_artifact.mjs',
    };
    await writeFile(join(stagedVendorRoot, MUTAGEN_SOURCE_METADATA_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
    await publishDirectory(stagedVendorRoot, resolve(vendorRoot));
    return { status: 'ok', vendorRoot: resolve(vendorRoot), metadata };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

/** Create the deterministic manager/agent metadata and checksums files. */
export async function buildMutagenEngineArtifactManifest({
  payloadRoot,
  engineVersion,
  targetTriple,
  policy,
} = {}) {
  const {
    assertMutagenEngineArtifactPayload,
    resolveMutagenEngineArtifactTarget,
    resolveMutagenEngineReleaseTag,
  } = await import('@happier-dev/cli-common/firstPartyRuntime');
  const resolvedPolicy = policy ?? await readMutagenEnginePolicy();
  if (!resolvedPolicy.fork?.releaseCommit) {
    throw new Error('[mutagen-engine] mutagen_fork_release_commit_required: commit the fork implementation and pin its full releaseCommit before building an artifact');
  }
  const target = targetTriple ?? resolveMutagenEngineArtifactTarget();
  if (!resolvedPolicy.targets?.includes(target)) throw new Error(`[mutagen-engine] unsupported target ${target}`);
  const root = resolve(payloadRoot);
  const managerPath = join(root, 'bin', 'happier-mutagen');
  const agentPath = join(root, 'bin', 'happier-mutagen-agent');
  await assertFiles([managerPath, agentPath, join(root, 'licenses', 'MUTAGEN-LICENSE'), join(root, 'licenses', 'THIRD-PARTY-NOTICES')]);
  const managerSha256 = await sha256File(managerPath);
  const agentSha256 = await sha256File(agentPath);
  const manifest = {
    format: 'happier-mutagen-engine',
    schemaVersion: 1,
    component: 'mutagen-engine',
    engineVersion: String(engineVersion ?? '').trim(),
    forkCommit: resolvedPolicy.fork.releaseCommit,
    forkBranch: resolvedPolicy.fork.branch,
    transportSpikeCommit: resolvedPolicy.fork.transportSpikeCommit,
    upstreamTag: resolvedPolicy.upstream.tag,
    upstreamCommit: resolvedPolicy.upstream.commit,
    toolchain: {
      go: resolvedPolicy.toolchain.go,
      goChecksum: resolvedPolicy.toolchain.distributionSha256?.[target],
    },
    protocolEpoch: resolvedPolicy.protocol.epoch,
    targetTriple: target,
    supportedTargets: resolvedPolicy.targets,
    managerPath: 'bin/happier-mutagen',
    agentPath: 'bin/happier-mutagen-agent',
    licensePolicy: resolvedPolicy.license.policy,
    ssplEnabled: false,
    buildTags: [...MUTAGEN_ENGINE_BUILD_TAGS],
    cgoEnabled: target.startsWith('darwin-'),
    watcher: target.startsWith('darwin-') ? 'fsevents' : target.startsWith('windows-') ? 'native' : 'polling',
    releaseTag: resolveMutagenEngineReleaseTag(engineVersion),
    managerSha256,
    agentSha256,
  };
  const manifestPath = join(root, '.happier-mutagen-engine.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, 'checksums.txt'), `${managerSha256}  bin/happier-mutagen\n${agentSha256}  bin/happier-mutagen-agent\n`);
  assertMutagenEngineArtifactPayload({
    payloadRoot: root,
    targetTriple: target,
    engineVersion: manifest.engineVersion,
    trustedForkReleaseCommit: resolvedPolicy.fork.releaseCommit,
  });
  return manifest;
}

async function publishDirectory(stagedPath, destinationPath) {
  const backupPath = `${destinationPath}.previous`;
  await rm(backupPath, { recursive: true, force: true });
  try {
    await rename(destinationPath, backupPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  try {
    await rename(stagedPath, destinationPath);
  } catch (error) {
    try { await rename(backupPath, destinationPath); } catch { /* retain failure context */ }
    throw error;
  }
  await rm(backupPath, { recursive: true, force: true });
}

async function assertFiles(paths) {
  await Promise.all(paths.map(async (path) => {
    const info = await lstat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`[mutagen-engine] required artifact file is missing: ${path}`);
  }));
}

async function sha256File(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readOptional(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

async function findForbiddenSourceReferences(root) {
  const matches = [];
  const visit = async (directory) => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !/\.(go|proto|json|md|yml|yaml)$/iu.test(entry.name)) continue;
      const relativePath = relative(root, path).replaceAll('\\', '/');
      if (relativePath === '.github/workflows/release-happier.yml') continue;
      if (/(^|\/)sspl(\/|$)|_sspl\./iu.test(relativePath)) {
        matches.push(relativePath);
        continue;
      }
      if (/_test\.go$/u.test(relativePath)) continue;
      const text = await readOptional(path);
      if (text == null) continue;
      if (/happier:\/\/|rootGrantId|[?&]path=|mutagensspl/iu.test(text)) {
        matches.push(relativePath);
      }
    }
  };
  await visit(root);
  return matches;
}

function blocked(reason, detail, extra = {}) {
  return { status: 'blocked', reason, detail, ...extra };
}

function isRecord(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function requirePathSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await materializeMutagenForkSource();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'ok') process.exitCode = 1;
}
