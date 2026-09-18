#!/usr/bin/env node
// @ts-check

import { createWriteStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import archiver from 'archiver';
import { resolveReleaseArtifactArchiveName } from '@happier-dev/release-runtime/assets';
import { bundleWorkspaceDeps } from '../../../apps/cli/scripts/bundleWorkspaceDeps.mjs';

import {
  CLI_STACK_TARGETS, commandExists, compileBunBinary, ensureFileExists, execOrThrow, maybeSignFile,
  normalizeChannel, parseArgs, readVersionFromPackageJson, resolveRepoRoot, resolveTargets, writeChecksumsFile,
} from './lib/binary-release.mjs';
import {
  RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS,
  RUNNER_NATIVE_SHELL_DIR,
  resolveRunnerBundleArchiveCommand,
  resolveRunnerCoreSidecarPath,
  resolveRunnerPackageLayout,
  resolveRunnerShellBuildCommand,
  resolveRunnerShellPayload,
  runnerTargetId,
} from './lib/runner-packaging.mjs';
import { notarizeDarwinAppBundle, verifyDarwinAppBundleNotarizationEvidence } from './notarize-standalone-binary.mjs';

/**
 * Targets whose native shell the release owner knows how to compose. Windows is
 * absent: its approved one-shot, no-installer contract has no Authenticode owner
 * and adding one is a plan amendment, not a build flag.
 *
 * Building a target is not advertising product availability.
 * `RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS` is the release-admission allowlist
 * and is what the default matrix resolves to; a
 * Darwin build must be requested explicitly and must carry real Developer ID
 * signing inputs.
 */
export const RUNNER_BINARY_TARGETS = CLI_STACK_TARGETS.filter((target) =>
  target.os === 'linux' || target.os === 'darwin');

/** @param {{ os: string; arch: string }} target */
function isDarwinTarget(target) {
  return target.os === 'darwin';
}

/**
 * Package one built payload. Linux ships the single AppImage file that contains
 * the Bun core; macOS ships the signed, notarized and stapled app tree, which
 * only `ditto` can archive without losing bundle metadata.
 */
export async function packageRunnerBinary({ product = 'happier-runner', version, target, payloadPath, outDir }) {
  const layout = resolveRunnerPackageLayout(runnerTargetId(target));
  const archiveName = resolveReleaseArtifactArchiveName({
    product,
    version,
    os: target.os,
    arch: target.arch,
  });
  const archivePath = join(outDir, archiveName);
  if (layout.payloadKind === 'app-bundle') {
    if (process.platform !== 'darwin') {
      throw new Error('[release] macOS Runner packaging must run on macOS so the signed bundle survives archiving');
    }
    const [command, args] = resolveRunnerBundleArchiveCommand({ payloadPath, archivePath });
    await execOrThrow(command, args, { timeoutMs: 10 * 60_000 });
    return { name: archiveName, path: archivePath, os: target.os, arch: target.arch };
  }
  await chmod(payloadPath, 0o755);
  await new Promise((resolvePromise, reject) => {
    const output = createWriteStream(archivePath, { flags: 'wx', mode: 0o600 });
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolvePromise); output.on('error', reject); archive.on('error', reject);
    archive.pipe(output);
    archive.file(payloadPath, { name: layout.payloadRootName, mode: 0o755, date: new Date(0) });
    void archive.finalize();
  });
  return { name: archiveName, path: archivePath, os: target.os, arch: target.arch };
}

async function patchRunnerPackageVersion(repoRoot, nextVersion) {
  const packageJsonPath = join(repoRoot, 'apps', 'cli', 'package.json');
  const raw = await readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  const previousVersion = String(parsed.version ?? '').trim();
  if (!previousVersion) throw new Error(`[release] CLI package.json missing version: ${packageJsonPath}`);
  if (previousVersion === nextVersion) return async () => {};
  parsed.version = nextVersion;
  await writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return async () => { await writeFile(packageJsonPath, raw, 'utf8'); };
}

/**
 * Compose the immutable payload for one target: compile the Bun core, stage it
 * as the shell's sidecar, then let the canonical Tauri CLI build the one-shot
 * bundle. The Bun core is never published on its own — the pinned runtime still
 * honours `BUN_BE_BUN`, and only the shell's argument refusal plus `env_clear`
 * keep the embedded dispatcher unreachable.
 */
async function buildRunnerPayload({ repoRoot, shellDir, entrypoint, target, version, tempDir }) {
  const corePath = join(tempDir, `happier-runner-core-${target.os}-${target.arch}${target.exeExt}`);
  await compileBunBinary({
    entrypoint,
    bunTarget: target.bunTarget,
    outfile: corePath,
    cwd: join(repoRoot, 'apps', 'cli'),
    externals: [],
    // Runner packages must not inherit ambient project configuration from the
    // directory where an operator launches the standalone executable.
    autoloadDotenv: false,
    autoloadBunfig: false,
  });
  const sidecarPath = resolveRunnerCoreSidecarPath({ shellDir, target });
  await mkdir(join(shellDir, 'binaries'), { recursive: true });
  await rm(sidecarPath, { force: true });
  await copyFile(corePath, sidecarPath);
  await chmod(sidecarPath, 0o755);

  const [command, args] = resolveRunnerShellBuildCommand({
    tauriBin: join(repoRoot, 'node_modules', '.bin', 'tauri'),
    target,
    version,
  });
  await execOrThrow(command, args, { cwd: shellDir, timeoutMs: 60 * 60_000 });
  return await resolveRunnerShellPayload({ shellDir, target });
}

/**
 * Apply the platform trust the target requires, then assert the exact archive
 * layout the creator-side assembler and release admission expect.
 */
async function finalizeRunnerPayload({ payloadPath, target, macOSSigningIdentity, macOSNotarizationOutput }) {
  const layout = resolveRunnerPackageLayout(runnerTargetId(target));
  if (layout.payloadKind === 'app-bundle') {
    if (!macOSSigningIdentity || !macOSNotarizationOutput) {
      throw new Error(
        '[release] macOS Runner artifacts require --macos-signing-identity and --macos-notarization-output; '
        + 'an unsigned or ad-hoc signed Runner is a trust-critical executable and is never published',
      );
    }
    notarizeDarwinAppBundle({
      bundlePath: payloadPath,
      mainExecutableName: 'happier-runner',
      identity: macOSSigningIdentity,
      outPath: macOSNotarizationOutput,
    });
    verifyDarwinAppBundleNotarizationEvidence({
      bundlePath: payloadPath,
      evidencePath: macOSNotarizationOutput,
    });
    await ensureFileExists(join(payloadPath, 'Contents', 'Info.plist'));
    await ensureFileExists(join(payloadPath, 'Contents', 'MacOS', 'happier-runner'));
    await ensureFileExists(join(payloadPath, 'Contents', 'MacOS', 'happier-runner-core'));
    await ensureFileExists(join(payloadPath, 'Contents', '_CodeSignature', 'CodeResources'));
    return payloadPath;
  }
  const payload = await lstat(payloadPath);
  if (!payload.isFile()) throw new Error(`[release] Runner AppImage payload is not a file: ${payloadPath}`);
  await chmod(payloadPath, 0o755);
  return payloadPath;
}

async function main() {
  const repoRoot = resolveRepoRoot();
  const { kv } = parseArgs(process.argv.slice(2));
  if (!commandExists('bun')) throw new Error('[release] bun is required to build Runner binaries');
  if (!commandExists('cargo')) throw new Error('[release] cargo is required to build the Runner native shell');
  const channel = normalizeChannel(kv.get('--channel'));
  const version = String(kv.get('--version') ?? '').trim() || readVersionFromPackageJson(join(repoRoot, 'apps', 'cli', 'package.json'));
  const entrypoint = join(repoRoot, 'apps', 'cli', 'src', 'ephemeralRunner', 'main.ts');
  await ensureFileExists(entrypoint);
  const shellDir = join(repoRoot, RUNNER_NATIVE_SHELL_DIR);
  await ensureFileExists(join(shellDir, 'tauri.conf.json'));
  const macOSSigningIdentity = String(kv.get('--macos-signing-identity') ?? '').trim();
  const macOSNotarizationOutput = String(kv.get('--macos-notarization-output') ?? '').trim();
  // Publication-eligible targets are the default matrix. A Darwin build is an
  // explicit signing-bearing request whose artifact remains unavailable to Homes
  // until release admission and the product activation gates are satisfied.
  const targets = resolveTargets({
    availableTargets: RUNNER_BINARY_TARGETS,
    requested: kv.get('--targets') ?? RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS.join(','),
  });
  if (targets.some(isDarwinTarget) && process.platform !== 'darwin') {
    throw new Error('[release] macOS Runner artifacts must be built, signed and stapled on macOS');
  }
  const outDir = join(repoRoot, 'dist', 'release-assets', 'runner');
  const tempDir = join(repoRoot, 'dist', 'release-assets', '.tmp-runner-binaries', `build-${process.pid}-${randomUUID()}`);
  await mkdir(tempDir, { recursive: true }); await mkdir(outDir, { recursive: true });
  const restorePackageVersion = await patchRunnerPackageVersion(repoRoot, version);
  try {
    // The standalone core resolves private workspace imports through the CLI's
    // artifact-mode publication tree. Refresh it from current source after the
    // release version is applied so both the binary and manifest have one identity.
    await bundleWorkspaceDeps({
      repoRoot,
      happyCliDir: join(repoRoot, 'apps', 'cli'),
      publicationMode: 'artifact',
    });
    const artifacts = [];
    for (const target of targets) {
      const built = await buildRunnerPayload({ repoRoot, shellDir, entrypoint, target, version, tempDir });
      const payloadPath = await finalizeRunnerPayload({
        payloadPath: built,
        target,
        macOSSigningIdentity,
        macOSNotarizationOutput,
      });
      const hostOs = process.platform === 'win32' ? 'windows' : process.platform;
      const hostArch = process.arch === 'x64' ? 'x64' : process.arch === 'arm64' ? 'arm64' : process.arch;
      if (target.os === hostOs && target.arch === hostArch) {
        const layout = resolveRunnerPackageLayout(runnerTargetId(target));
        const probe = layout.payloadKind === 'app-bundle'
          ? join(payloadPath, 'Contents', 'MacOS', 'happier-runner')
          : payloadPath;
        // AppImages need FUSE to self-mount; extraction keeps the probe usable
        // on hosts and CI images that do not provide it.
        await execOrThrow(probe, ['--version'], {
          cwd: tempDir,
          timeoutMs: 60_000,
          env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1' },
        });
      }
      const artifact = await packageRunnerBinary({ version, target, payloadPath, outDir });
      const { verifyReleaseArchiveAdmission } = await import('./verify-artifacts.mjs');
      const entries = await verifyReleaseArchiveAdmission({ archivePath: artifact.path, archiveName: artifact.name });
      const archive = await lstat(artifact.path);
      artifacts.push({ ...artifact, archiveMetadata: { sizeBytes: archive.size, entries } });
    }
    const checksumsPath = await writeChecksumsFile({ product: 'happier-runner', version, artifacts, outDir });
    const signaturePath = await maybeSignFile({ path: checksumsPath, trustedComment: `happier-runner ${version} ${channel}` });
    console.log(JSON.stringify({ product: 'happier-runner', channel, version, artifacts: artifacts.map(({ name }) => name), checksums: checksumsPath, signature: signaturePath }, null, 2));
  } finally {
    await restorePackageVersion();
    await rm(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith('build-runner-binaries.mjs')) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
