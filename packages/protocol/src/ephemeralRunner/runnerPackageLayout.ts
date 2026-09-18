import { RUNNER_ARTIFACT_TARGETS, type RunnerArtifactTarget } from './runnerArtifact.js';

/**
 * Canonical Happier Runner activation-package layout and publication-eligibility owner
 * (Lane 13.5 §5–§6).
 *
 * The release builder, release admission, the Home availability projection and
 * the creator-side package assembler must agree on exactly one immutable payload
 * shape per target and on exactly which targets the release pipeline may
 * publish. Publication eligibility is not product availability: the Home still
 * requires an exact artifact in the verified immutable release manifest, and
 * the Temporary-computer feature remains disabled until the composed live
 * certification passes.
 */

export const RUNNER_ACTIVATION_FILE_NAME = 'happier-runner.activation.json';

/**
 * `appimage` and `exe` are one immutable executable file; `app-bundle` is the
 * signed, notarized and stapled macOS directory tree. The activation JSON always
 * sits beside the payload root so per-request composition never reopens it.
 */
export type RunnerPackagePayloadKind = 'appimage' | 'app-bundle' | 'exe';

export type RunnerPackageLayoutV1 = Readonly<{
  target: RunnerArtifactTarget;
  payloadKind: RunnerPackagePayloadKind;
  /** The single archive root entry: a file, or the macOS bundle directory. */
  payloadRootName: string;
  /** Archive-relative path of the executable the endpoint actually launches. */
  executablePath: string;
  activationFileName: typeof RUNNER_ACTIVATION_FILE_NAME;
}>;

const MACOS_APP_ROOT = 'Happier Runner.app';

const PAYLOADS: Readonly<Record<RunnerArtifactTarget, Readonly<{
  payloadKind: RunnerPackagePayloadKind;
  payloadRootName: string;
  executablePath: string;
}>>> = {
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
};

export function resolveRunnerPackageLayout(target: RunnerArtifactTarget): RunnerPackageLayoutV1 {
  const payload = PAYLOADS[target];
  return {
    target,
    payloadKind: payload.payloadKind,
    payloadRootName: payload.payloadRootName,
    executablePath: payload.executablePath,
    activationFileName: RUNNER_ACTIVATION_FILE_NAME,
  };
}

/**
 * Publication is deliberately incremental (umbrella §6.0). A target belongs here
 * only once the release owner can produce and admit its immutable payload and
 * applicable native-trust evidence. This allowlist does not certify the product
 * journey or make a Home expose an artifact that has not actually published:
 *
 * - `linux-x64`: one-shot AppImage whose Rust shell owns the Bun core.
 * - `linux-arm64`/`darwin-*`: payload shape is settled, release/platform proof
 *   (Developer ID signing, notarization, stapling) has not been produced.
 * - `windows-x64`: the approved one-shot, no-installer contract conflicts with
 *   the shell's `externalBin`/NSIS packaging, and no Authenticode owner exists.
 *   It stays declared but publication-ineligible until that contract is amended.
 */
export const RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS: readonly RunnerArtifactTarget[] = Object.freeze(['linux-x64']);

export function isRunnerArtifactTargetEligibleForPublication(target: string): target is RunnerArtifactTarget {
  return RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS.includes(target as RunnerArtifactTarget)
    && RUNNER_ARTIFACT_TARGETS.includes(target as RunnerArtifactTarget);
}
