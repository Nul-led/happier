// @ts-check

/**
 * Release-side owner of the Happier Runner native-shell composition (Lane 13.5
 * §4–§6).
 *
 * The published Runner is never a bare Bun executable: the pinned Bun runtime
 * still honours `BUN_BE_BUN` and would expose its embedded CLI dispatcher to
 * anyone holding the artifact. The shipped product is the Rust shell from
 * `apps/cli/runner-native-shell`, which refuses unknown arguments and clears the
 * environment before spawning the Bun core as a nested sidecar. This module owns
 * the target matrix, the payload layout and the shell build plan so the builder,
 * the asset preparer and release admission all make the same decision.
 *
 * `packages/protocol/src/ephemeralRunner/runnerPackageLayout.ts` remains the
 * canonical product owner for the server, the creator client and this module.
 * The release pipeline deliberately does not import it: publishing installs
 * dependencies without guaranteeing a built Protocol dist, and a release build
 * must not fail on that. `runner-native-shell.test.mjs` pins this mirror to the
 * Protocol source so divergence is a loud failure rather than a second decision.
 */

import { chmod, lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { notarizeDarwinAppBundle, verifyDarwinAppBundleNotarizationEvidence } from '../notarize-standalone-binary.mjs';

export const RUNNER_NATIVE_SHELL_DIR = 'apps/cli/runner-native-shell';
export const RUNNER_CORE_SIDECAR_STEM = 'happier-runner-core';
/** The shell crate's `mainBinaryName`: what every Tauri build emits. */
export const RUNNER_SHELL_BINARY_STEM = 'happier-runner';
export const RUNNER_ACTIVATION_FILE_NAME = 'happier-runner.activation.json';

const MACOS_APP_ROOT = 'Happier Runner.app';
const WINDOWS_PAYLOAD_ROOT = 'Happier Runner';

/** @type {Readonly<Record<string, Readonly<{ payloadKind: 'appimage' | 'app-bundle' | 'portable-dir'; payloadRootName: string; executablePath: string; sidecarPath?: string }>>>} */
const PAYLOADS = Object.freeze({
  'linux-x64': { payloadKind: 'appimage', payloadRootName: 'happier-runner', executablePath: 'happier-runner' },
  'linux-arm64': { payloadKind: 'appimage', payloadRootName: 'happier-runner', executablePath: 'happier-runner' },
  'darwin-x64': {
    payloadKind: 'app-bundle',
    payloadRootName: MACOS_APP_ROOT,
    executablePath: `${MACOS_APP_ROOT}/Contents/MacOS/happier-runner`,
  },
  'darwin-arm64': {
    payloadKind: 'app-bundle',
    payloadRootName: MACOS_APP_ROOT,
    executablePath: `${MACOS_APP_ROOT}/Contents/MacOS/happier-runner`,
  },
  'windows-x64': {
    payloadKind: 'portable-dir',
    payloadRootName: WINDOWS_PAYLOAD_ROOT,
    executablePath: `${WINDOWS_PAYLOAD_ROOT}/Happier Runner.exe`,
    sidecarPath: `${WINDOWS_PAYLOAD_ROOT}/happier-runner-core.exe`,
  },
});

/**
 * Publication is deliberately incremental. A target is eligible only once its
 * immutable payload and applicable native trust evidence can be admitted by the
 * release owner. This is publication eligibility, not a claim that the product
 * journey has passed or that an artifact is currently available. Windows stays
 * declared but ineligible: its closed portable payload is composable here, and
 * Authenticode signing, timestamping and published-artifact evidence are the
 * release checks it still needs.
 */
export const RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS = Object.freeze(['linux-x64']);

/**
 * Target ids this owner declares a payload layout for: the full build matrix,
 * deliberately wider than {@link RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS}.
 * `runner-native-shell.test.mjs` pins this set, row by row, to the Protocol
 * layout owner's declared rows.
 */
export const RUNNER_PACKAGE_TARGET_IDS = Object.freeze(Object.keys(PAYLOADS));

/** Rust triples for every target the shell can be compiled for. */
const RUST_TARGETS = Object.freeze({
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'darwin-x64': 'x86_64-apple-darwin',
  'darwin-arm64': 'aarch64-apple-darwin',
  'windows-x64': 'x86_64-pc-windows-msvc',
});

/** @param {{ os: string; arch: string }} target */
export function runnerTargetId(target) {
  return `${target.os}-${target.arch}`;
}

/** @param {string} targetId */
export function resolveRunnerPackageLayout(targetId) {
  const payload = PAYLOADS[targetId];
  if (!payload) throw new Error(`[release] unknown Runner target: ${targetId}`);
  return {
    target: targetId,
    payloadKind: payload.payloadKind,
    payloadRootName: payload.payloadRootName,
    executablePath: payload.executablePath,
    ...(payload.sidecarPath === undefined ? {} : { sidecarPath: payload.sidecarPath }),
    // The shell resolves its activation file beside the executable it launches
    // and pops out of the macOS bundle only, so a portable directory payload
    // carries the activation JSON inside that directory.
    activationFilePath: payload.payloadKind === 'portable-dir'
      ? `${payload.payloadRootName}/${RUNNER_ACTIVATION_FILE_NAME}`
      : RUNNER_ACTIVATION_FILE_NAME,
  };
}

/** @param {string} value */
export function isRunnerTargetEligibleForPublication(value) {
  return RUNNER_PUBLICATION_ELIGIBLE_TARGET_IDS.includes(value) && Object.hasOwn(PAYLOADS, value);
}

/** @param {readonly { os: string; arch: string }[]} availableTargets */
export function resolveRunnerPublicationEligibleBinaryTargets(availableTargets) {
  return availableTargets.filter((target) => isRunnerTargetEligibleForPublication(runnerTargetId(target)));
}

/** @param {{ os: string; arch: string }} target */
export function resolveRunnerShellRustTarget(target) {
  const targetId = runnerTargetId(target);
  const rustTarget = RUST_TARGETS[targetId];
  if (!rustTarget) throw new Error(`[release] no Runner shell Rust target for ${targetId}`);
  return rustTarget;
}

/**
 * Tauri bundle identifier and its output directory for the target's single
 * one-shot payload. The two differ for macOS: the bundle is requested as `app`
 * but written under `bundle/macos`. A `portable-dir` payload has no Tauri
 * bundle at all — every Windows format Tauri can emit is an installer — so the
 * release packager composes the compiled shell and its sidecar itself.
 */
function resolveShellBundle(targetId) {
  const { payloadKind } = resolveRunnerPackageLayout(targetId);
  if (payloadKind === 'appimage') return { id: 'appimage', directory: 'appimage' };
  if (payloadKind === 'app-bundle') return { id: 'app', directory: 'macos' };
  if (payloadKind === 'portable-dir') return null;
  throw new Error(`[release] no one-shot Runner shell bundle for ${targetId}`);
}

/**
 * Exactly one bundle per invocation, or none for the composed portable payload.
 * `dmg`, `deb`, `rpm` and `nsis` are installer formats the one-shot Runner must
 * never publish, so they are never requested rather than filtered out
 * afterwards.
 *
 * @param {{ tauriBin: string; target: { os: string; arch: string }; version: string }} params
 * @returns {[string, string[]]}
 */
export function resolveRunnerShellBuildCommand({ tauriBin, target, version }) {
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedVersion) throw new Error('[release] Runner shell build requires a version');
  const bundle = resolveShellBundle(runnerTargetId(target));
  return [tauriBin, [
    'build',
    '--target', resolveRunnerShellRustTarget(target),
    ...(bundle ? ['--bundles', bundle.id] : ['--no-bundle']),
    '--config', JSON.stringify({ version: normalizedVersion }),
  ]];
}

/** @param {{ shellDir: string; target: { os: string; arch: string } }} params */
export function resolveRunnerShellBundleDirectory({ shellDir, target }) {
  const bundle = resolveShellBundle(runnerTargetId(target));
  const releaseDir = join(shellDir, 'target', resolveRunnerShellRustTarget(target), 'release');
  return bundle ? join(releaseDir, 'bundle', bundle.directory) : releaseDir;
}

/**
 * Locate the one payload the shell build produced. A build that emits zero or
 * several candidates is a packaging defect, not something to disambiguate by
 * guessing a name: the bundler's arch suffix is tooling-owned and the release
 * archive must contain exactly the reviewed bytes.
 *
 * @param {{ shellDir: string; target: { os: string; arch: string } }} params
 */
export async function resolveRunnerShellPayload({ shellDir, target }) {
  const bundleDir = resolveRunnerShellBundleDirectory({ shellDir, target });
  const layout = resolveRunnerPackageLayout(runnerTargetId(target));
  const entries = await readdir(bundleDir).catch(() => {
    throw new Error(`[release] Runner shell build produced no bundle directory: ${bundleDir}`);
  });
  if (layout.payloadKind === 'portable-dir') {
    // Tauri emits the crate's `mainBinaryName`; the user-facing payload name is
    // applied when the packager composes the payload directory.
    const built = `${RUNNER_SHELL_BINARY_STEM}.exe`;
    if (!entries.includes(built)) {
      throw new Error(`[release] Runner shell build produced no ${built} in ${bundleDir}`);
    }
    return join(bundleDir, built);
  }
  if (layout.payloadKind === 'appimage') {
    const candidates = entries.filter((name) => name.endsWith('.AppImage')).sort();
    if (candidates.length === 0) {
      throw new Error(`[release] Runner shell build produced no AppImage in ${bundleDir}`);
    }
    if (candidates.length !== 1) {
      throw new Error(`[release] Runner shell build must produce exactly one AppImage: ${candidates.join(', ')}`);
    }
    return join(bundleDir, candidates[0]);
  }
  const candidates = entries.filter((name) => name === layout.payloadRootName);
  if (candidates.length !== 1) {
    throw new Error(`[release] Runner shell build produced no ${layout.payloadRootName} in ${bundleDir}`);
  }
  return join(bundleDir, layout.payloadRootName);
}

/**
 * Archive one built payload root. `ditto` is the only archiver that preserves a
 * signed macOS bundle's symlinks, modes and resource metadata, so the release
 * ZIP contains exactly the stapled tree Gatekeeper accepted.
 *
 * @param {{ payloadPath: string; archivePath: string }} params
 * @returns {[string, string[]]}
 */
export function resolveRunnerBundleArchiveCommand({ payloadPath, archivePath }) {
  return ['ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', payloadPath, archivePath]];
}

/**
 * The staged sidecar name Tauri's `externalBin` resolves for the compiled
 * target. Windows sidecars carry the executable extension Tauri expects.
 *
 * @param {{ shellDir: string; target: { os: string; arch: string } }} params
 */
export function resolveRunnerCoreSidecarPath({ shellDir, target }) {
  const rustTarget = resolveRunnerShellRustTarget(target);
  const extension = rustTarget.includes('-windows-') ? '.exe' : '';
  return join(shellDir, 'binaries', `${RUNNER_CORE_SIDECAR_STEM}-${rustTarget}${extension}`);
}

function runNativeCommand([command, args]) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function requireWindowsSigningIdentity(value) {
  const identity = String(value ?? '').trim();
  if (!/^[a-f0-9]{40}$/iu.test(identity)) {
    throw new Error('[release] --windows-signing-identity requires the signing certificate SHA-1 thumbprint');
  }
  return identity.toUpperCase();
}

/** Verify the exact publisher and timestamp as well as native Authenticode trust. */
export async function verifyWindowsRunnerPayload({
  payloadPath, windowsSigningIdentity, platform = process.platform, runCommand = runNativeCommand,
}) {
  const identity = requireWindowsSigningIdentity(windowsSigningIdentity);
  if (platform !== 'win32') throw new Error('[release] Windows Runner Authenticode verification must run on Windows');
  const layout = resolveRunnerPackageLayout('windows-x64');
  for (const entryPath of [layout.executablePath, layout.sidecarPath]) {
    const file = join(payloadPath, basename(entryPath));
    if (!(await lstat(file)).isFile()) throw new Error(`[release] Runner payload file is missing: ${entryPath}`);
    // SignTool warnings (including a missing timestamp with /tw) are nonzero
    // exits, so the command boundary rejects them just like trust failures.
    runCommand(['signtool.exe', ['verify', '/pa', '/all', '/tw', file]]);
    const literalPath = `'${file.replaceAll("'", "''")}'`;
    const script = `$ErrorActionPreference = 'Stop'; $signature = Get-AuthenticodeSignature -LiteralPath ${literalPath}; `
      + '[pscustomobject]@{ status = $signature.Status.ToString(); thumbprint = $signature.SignerCertificate.Thumbprint; '
      + 'timestamped = $null -ne $signature.TimeStamperCertificate } | ConvertTo-Json -Compress';
    let facts;
    try {
      facts = JSON.parse(runCommand(['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]]));
    } catch (cause) {
      throw new Error(`[release] Runner Authenticode publisher verification failed: ${entryPath}`, { cause });
    }
    if (facts?.status !== 'Valid' || String(facts?.thumbprint ?? '').toUpperCase() !== identity || facts?.timestamped !== true) {
      throw new Error(`[release] Runner Authenticode publisher or timestamp is invalid: ${entryPath}`);
    }
  }
}

/** Apply native trust before the immutable payload is archived. */
export async function finalizeRunnerPayload({
  payloadPath, target, macOSSigningIdentity, macOSNotarizationOutput,
  windowsSigningIdentity, windowsTimestampUrl, platform = process.platform, runCommand = runNativeCommand,
}) {
  const layout = resolveRunnerPackageLayout(runnerTargetId(target));
  if (layout.payloadKind === 'app-bundle') {
    if (!macOSSigningIdentity || !macOSNotarizationOutput) {
      throw new Error('[release] macOS Runner artifacts require --macos-signing-identity and --macos-notarization-output');
    }
    notarizeDarwinAppBundle({
      bundlePath: payloadPath,
      mainExecutableName: 'happier-runner',
      identity: macOSSigningIdentity,
      outPath: macOSNotarizationOutput,
    });
    verifyDarwinAppBundleNotarizationEvidence({ bundlePath: payloadPath, evidencePath: macOSNotarizationOutput });
    for (const relativePath of ['Contents/Info.plist', 'Contents/MacOS/happier-runner', 'Contents/MacOS/happier-runner-core', 'Contents/_CodeSignature/CodeResources']) {
      if (!(await lstat(join(payloadPath, relativePath))).isFile()) throw new Error(`[release] Runner payload file is missing: ${relativePath}`);
    }
    return payloadPath;
  }
  if (layout.sidecarPath) {
    const identity = requireWindowsSigningIdentity(windowsSigningIdentity);
    let timestampUrl;
    try { timestampUrl = new URL(String(windowsTimestampUrl ?? '')); } catch {}
    if (!timestampUrl || !['https:', 'http:'].includes(timestampUrl.protocol)) {
      throw new Error('[release] --windows-timestamp-url requires an explicit RFC 3161 HTTP(S) endpoint');
    }
    if (platform !== 'win32') throw new Error('[release] Windows Runner Authenticode signing must run on Windows');
    for (const entryPath of [layout.executablePath, layout.sidecarPath]) {
      const file = join(payloadPath, basename(entryPath));
      if (!(await lstat(file)).isFile()) throw new Error(`[release] Runner payload file is missing: ${entryPath}`);
      runCommand(['signtool.exe', [
        'sign', '/sha1', identity, '/fd', 'SHA256', '/tr', String(windowsTimestampUrl), '/td', 'SHA256', '/d', 'Happier Runner', file,
      ]]);
    }
    await verifyWindowsRunnerPayload({ payloadPath, windowsSigningIdentity: identity, platform, runCommand });
    return payloadPath;
  }
  const payload = await lstat(payloadPath);
  if (!payload.isFile()) throw new Error(`[release] Runner AppImage payload is not a file: ${payloadPath}`);
  await chmod(payloadPath, 0o755);
  return payloadPath;
}
