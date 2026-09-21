import { describe, expect, it } from 'vitest';

import { RUNNER_ARTIFACT_TARGETS } from './runnerArtifact.js';
import {
  RUNNER_ACTIVATION_FILE_NAME,
  RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS,
  isRunnerArtifactTargetEligibleForPublication,
  resolveRunnerPackageLayout,
} from './runnerPackageLayout.js';

describe('Runner package layout', () => {
  it('gives every declared target exactly one payload layout', () => {
    for (const target of RUNNER_ARTIFACT_TARGETS) {
      const layout = resolveRunnerPackageLayout(target);
      expect(layout.activationFilePath.endsWith(RUNNER_ACTIVATION_FILE_NAME)).toBe(true);
      expect(layout.executablePath.startsWith(layout.payloadRootName)).toBe(true);
    }
  });

  it('publishes the Linux payload as one self-contained executable root', () => {
    expect(resolveRunnerPackageLayout('linux-x64')).toEqual({
      target: 'linux-x64',
      payloadKind: 'appimage',
      payloadRootName: 'happier-runner',
      executablePath: 'happier-runner',
      activationFilePath: RUNNER_ACTIVATION_FILE_NAME,
    });
    expect(resolveRunnerPackageLayout('linux-arm64').payloadKind).toBe('appimage');
  });

  it('publishes the macOS payload as the signed app bundle the endpoint launches', () => {
    expect(resolveRunnerPackageLayout('darwin-arm64')).toEqual({
      target: 'darwin-arm64',
      payloadKind: 'app-bundle',
      payloadRootName: 'Happier Runner.app',
      executablePath: 'Happier Runner.app/Contents/MacOS/happier-runner',
      activationFilePath: RUNNER_ACTIVATION_FILE_NAME,
    });
  });

  it('models the Windows payload as the closed portable directory with its pinned core sidecar', () => {
    // The shell resolves both its core sidecar and its activation file beside
    // the executable it launches (`runner-native-shell/src/main.rs`), so the
    // Windows payload is one directory holding all three and the activation
    // JSON is written inside it rather than beside the payload root.
    expect(resolveRunnerPackageLayout('windows-x64')).toEqual({
      target: 'windows-x64',
      payloadKind: 'portable-dir',
      payloadRootName: 'Happier Runner',
      executablePath: 'Happier Runner/Happier Runner.exe',
      sidecarPath: 'Happier Runner/happier-runner-core.exe',
      activationFilePath: `Happier Runner/${RUNNER_ACTIVATION_FILE_NAME}`,
    });
    expect(isRunnerArtifactTargetEligibleForPublication('windows-x64')).toBe(false);
  });

  it('makes only targets with implemented release admission eligible for publication', () => {
    expect(RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS).toEqual(['linux-x64']);
    expect(isRunnerArtifactTargetEligibleForPublication('linux-x64')).toBe(true);
    expect(isRunnerArtifactTargetEligibleForPublication('darwin-arm64')).toBe(false);
    expect(isRunnerArtifactTargetEligibleForPublication('not-a-target')).toBe(false);
  });
});
