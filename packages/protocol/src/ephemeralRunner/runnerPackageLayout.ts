import { RUNNER_ARTIFACT_TARGETS, type RunnerArtifactTarget } from './runnerArtifact.js';

/**
 * Canonical Happier Runner activation-package layout and publication-eligibility owner
 * (Lane 13.5 §5–§6).
 *
 * The release builder, release admission, the Home availability projection and
 * the creator-side package assembler must agree on exactly one immutable payload
 * shape per target and on exactly which targets the release pipeline may
 * publish. Publication eligibility is not product availability: the Home still
 * requires an exact artifact in the verified immutable release manifest. The
 * Temporary-computer Home feature itself is on by default
 * (`HAPPIER_FEATURE_SESSIONS_EPHEMERAL_RUNNER__ENABLED=0` is the operator
 * opt-out); release checks are separate from that feature decision.
 */

export const RUNNER_ACTIVATION_FILE_NAME = 'happier-runner.activation.json';

/**
 * `appimage` is one immutable executable file; `app-bundle` is the signed,
 * notarized and stapled macOS directory tree; `portable-dir` is the signed
 * closed portable directory holding the shell executable and its adjacent core
 * sidecar. The activation JSON always sits beside the executable the endpoint
 * launches — inside a `portable-dir` root, beside the payload root otherwise —
 * so per-request composition never reopens the payload.
 */
export type RunnerPackagePayloadKind = 'appimage' | 'app-bundle' | 'portable-dir';

export type RunnerPackageLayoutV1 = Readonly<{
  target: RunnerArtifactTarget;
  payloadKind: RunnerPackagePayloadKind;
  /** The single archive root entry: a file, or the payload directory. */
  payloadRootName: string;
  /** Archive-relative path of the executable the endpoint actually launches. */
  executablePath: string;
  /**
   * Archive-relative path of the core sidecar the shell resolves beside that
   * executable. Declared exactly for a `portable-dir` payload, whose closed
   * entry set pins it as its own archive entry; the macOS sidecar lives inside
   * the signed bundle the stapled ticket already covers, and the AppImage
   * carries its core inside the single executable.
   */
  sidecarPath?: string;
  /** Archive-relative path of the activation JSON the launched shell reads. */
  activationFilePath: string;
}>;

const MACOS_APP_ROOT = 'Happier Runner.app';
const WINDOWS_PAYLOAD_ROOT = 'Happier Runner';

const PAYLOADS: Readonly<Record<RunnerArtifactTarget, Readonly<{
  payloadKind: RunnerPackagePayloadKind;
  payloadRootName: string;
  executablePath: string;
  sidecarPath?: string;
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
  'windows-x64': {
    payloadKind: 'portable-dir',
    payloadRootName: WINDOWS_PAYLOAD_ROOT,
    executablePath: `${WINDOWS_PAYLOAD_ROOT}/Happier Runner.exe`,
    sidecarPath: `${WINDOWS_PAYLOAD_ROOT}/happier-runner-core.exe`,
  },
};

export function resolveRunnerPackageLayout(target: RunnerArtifactTarget): RunnerPackageLayoutV1 {
  const payload = PAYLOADS[target];
  return {
    target,
    payloadKind: payload.payloadKind,
    payloadRootName: payload.payloadRootName,
    executablePath: payload.executablePath,
    ...(payload.sidecarPath === undefined ? {} : { sidecarPath: payload.sidecarPath }),
    // The shell joins the activation file to the parent of the executable it
    // launches and pops out of the macOS bundle only
    // (`apps/cli/runner-native-shell/src/main.rs`), so a portable directory
    // payload carries its activation JSON inside that directory.
    activationFilePath: payload.payloadKind === 'portable-dir'
      ? `${payload.payloadRootName}/${RUNNER_ACTIVATION_FILE_NAME}`
      : RUNNER_ACTIVATION_FILE_NAME,
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
 * - `windows-x64`: payload shape is settled as the closed portable directory
 *   above — no installer, service, updater or registry mutation — and its
 *   Authenticode signing, timestamp and published-artifact evidence has not
 *   been produced.
 */
export const RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS: readonly RunnerArtifactTarget[] = Object.freeze(['linux-x64']);

export function isRunnerArtifactTargetEligibleForPublication(target: string): target is RunnerArtifactTarget {
  return RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS.includes(target as RunnerArtifactTarget)
    && RUNNER_ARTIFACT_TARGETS.includes(target as RunnerArtifactTarget);
}
