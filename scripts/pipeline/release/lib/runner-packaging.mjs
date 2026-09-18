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

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const RUNNER_NATIVE_SHELL_DIR = 'apps/cli/runner-native-shell';
export const RUNNER_CORE_SIDECAR_STEM = 'happier-runner-core';
export const RUNNER_ACTIVATION_FILE_NAME = 'happier-runner.activation.json';

const MACOS_APP_ROOT = 'Happier Runner.app';

/** @type {Readonly<Record<string, Readonly<{ payloadKind: 'appimage' | 'app-bundle' | 'exe'; payloadRootName: string; executablePath: string }>>>} */
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
  'windows-x64': { payloadKind: 'exe', payloadRootName: 'Happier Runner.exe', executablePath: 'Happier Runner.exe' },
});

/**
 * Publication is deliberately incremental. A target is eligible only once its
 * immutable payload and applicable native trust evidence can be admitted by the
 * release owner. This is publication eligibility, not a claim that the product
 * journey has passed or that an artifact is currently available. Windows stays
 * declared but ineligible: the approved
 * one-shot, no-installer contract has no Authenticode owner, and changing that
 * requires a plan amendment rather than a build flag.
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
    activationFileName: RUNNER_ACTIVATION_FILE_NAME,
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
  if (targetId.startsWith('windows-')) {
    throw new Error(
      '[release] Windows Runner packaging is not publication eligible: the one-shot no-installer contract has no Authenticode owner',
    );
  }
  const rustTarget = RUST_TARGETS[targetId];
  if (!rustTarget) throw new Error(`[release] no Runner shell Rust target for ${targetId}`);
  return rustTarget;
}

/**
 * Tauri bundle identifier and its output directory for the target's single
 * one-shot payload. The two differ for macOS: the bundle is requested as `app`
 * but written under `bundle/macos`.
 */
function resolveShellBundle(targetId) {
  const { payloadKind } = resolveRunnerPackageLayout(targetId);
  if (payloadKind === 'appimage') return { id: 'appimage', directory: 'appimage' };
  if (payloadKind === 'app-bundle') return { id: 'app', directory: 'macos' };
  throw new Error(`[release] no one-shot Runner shell bundle for ${targetId}`);
}

/**
 * Exactly one bundle per invocation. `dmg`, `deb`, `rpm` and `nsis` are installer
 * formats the one-shot Runner must never publish, so they are never requested
 * rather than filtered out afterwards.
 *
 * @param {{ tauriBin: string; target: { os: string; arch: string }; version: string }} params
 * @returns {[string, string[]]}
 */
export function resolveRunnerShellBuildCommand({ tauriBin, target, version }) {
  const normalizedVersion = String(version ?? '').trim();
  if (!normalizedVersion) throw new Error('[release] Runner shell build requires a version');
  return [tauriBin, [
    'build',
    '--target', resolveRunnerShellRustTarget(target),
    '--bundles', resolveShellBundle(runnerTargetId(target)).id,
    '--config', JSON.stringify({ version: normalizedVersion }),
  ]];
}

/** @param {{ shellDir: string; target: { os: string; arch: string } }} params */
export function resolveRunnerShellBundleDirectory({ shellDir, target }) {
  return join(
    shellDir,
    'target',
    resolveRunnerShellRustTarget(target),
    'release',
    'bundle',
    resolveShellBundle(runnerTargetId(target)).directory,
  );
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
 * The staged sidecar name Tauri's `externalBin` resolves for the compiled target.
 *
 * @param {{ shellDir: string; target: { os: string; arch: string } }} params
 */
export function resolveRunnerCoreSidecarPath({ shellDir, target }) {
  return join(shellDir, 'binaries', `${RUNNER_CORE_SIDECAR_STEM}-${resolveRunnerShellRustTarget(target)}`);
}
