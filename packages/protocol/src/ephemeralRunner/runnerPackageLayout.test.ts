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
      expect(layout.activationFileName).toBe(RUNNER_ACTIVATION_FILE_NAME);
      expect(layout.executablePath.startsWith(layout.payloadRootName)).toBe(true);
    }
  });

  it('publishes the Linux payload as one self-contained executable root', () => {
    expect(resolveRunnerPackageLayout('linux-x64')).toEqual({
      target: 'linux-x64',
      payloadKind: 'appimage',
      payloadRootName: 'happier-runner',
      executablePath: 'happier-runner',
      activationFileName: RUNNER_ACTIVATION_FILE_NAME,
    });
    expect(resolveRunnerPackageLayout('linux-arm64').payloadKind).toBe('appimage');
  });

  it('publishes the macOS payload as the signed app bundle the endpoint launches', () => {
    expect(resolveRunnerPackageLayout('darwin-arm64')).toEqual({
      target: 'darwin-arm64',
      payloadKind: 'app-bundle',
      payloadRootName: 'Happier Runner.app',
      executablePath: 'Happier Runner.app/Contents/MacOS/happier-runner',
      activationFileName: RUNNER_ACTIVATION_FILE_NAME,
    });
  });

  it('keeps the Windows payload shape declared without making it publication eligible', () => {
    expect(resolveRunnerPackageLayout('windows-x64').payloadRootName).toBe('Happier Runner.exe');
    expect(isRunnerArtifactTargetEligibleForPublication('windows-x64')).toBe(false);
  });

  it('makes only targets with implemented release admission eligible for publication', () => {
    expect(RUNNER_PUBLICATION_ELIGIBLE_ARTIFACT_TARGETS).toEqual(['linux-x64']);
    expect(isRunnerArtifactTargetEligibleForPublication('linux-x64')).toBe(true);
    expect(isRunnerArtifactTargetEligibleForPublication('darwin-arm64')).toBe(false);
    expect(isRunnerArtifactTargetEligibleForPublication('not-a-target')).toBe(false);
  });
});
