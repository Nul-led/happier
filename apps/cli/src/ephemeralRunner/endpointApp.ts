import { join } from 'node:path';

import type { RunnerArtifactIdentityV1 } from '@happier-dev/protocol/ephemeralRunner/runnerArtifact';

import { readOrCreateInstallationIdentity } from '@/daemon/identity/store';
import {
  createEphemeralRunnerController,
  type EphemeralRunnerControllerResult,
  type EphemeralRunnerDependencies,
  type EphemeralRunnerEndpointUi,
} from './controlPlane';
import {
  assertRunnerArtifactMatchesCurrentExecutable,
  readVerifiedEphemeralRunnerActivationFile,
} from './activationFile';
import { createEphemeralRunnerLocalState, type EphemeralRunnerLocalState } from './localState';
import { bindEphemeralRunnerShutdown } from './shutdown';
import { bindProcessLogger, Logger } from '@/ui/logger';

/**
 * Standalone Runner composition root. Dependencies are explicit so this entry
 * cannot discover Account storage, daemon services, or caller-supplied runtime
 * authority. Production packaging supplies only the reviewed/scoped adapters.
 */
export async function runEphemeralRunner<Manifest, Materialized, Preparation>(input: Readonly<{
  activationFilePath: string;
  artifact: RunnerArtifactIdentityV1;
  dependencies: EphemeralRunnerDependencies<Manifest, Materialized, Preparation>;
  ui: EphemeralRunnerEndpointUi<Manifest>;
  localState?: EphemeralRunnerLocalState;
  localStateParentDirectory?: string;
  signal?: AbortSignal;
}>): Promise<EphemeralRunnerControllerResult> {
  const activation = await readVerifiedEphemeralRunnerActivationFile(input.activationFilePath, {
    artifact: input.artifact,
  });
  let localState: EphemeralRunnerLocalState | null = input.localState ?? null;
  const ownsLocalState = input.localState === undefined;
  let restoreProcessLogger: (() => void) | null = null;
  try {
    assertRunnerArtifactMatchesCurrentExecutable(activation.binding.artifact);
    if (localState === null) {
      localState = await createEphemeralRunnerLocalState({
        activationId: activation.binding.activationId,
        ...(input.localStateParentDirectory
          ? { parentDirectory: input.localStateParentDirectory }
          : {}),
      });
    }
    const createdLocalState = localState;
    restoreProcessLogger = bindProcessLogger(new Logger({
      logFilePath: join(createdLocalState.homeDirectory, 'logs', 'runner.log'),
      redactFileOutput: true,
      allowDangerousRemoteLogging: false,
      pruneCurrentProcessLogs: false,
    }));
    const installation = await readOrCreateInstallationIdentity(
      join(createdLocalState.homeDirectory, 'installation-identity.json'),
    );
    const controller = createEphemeralRunnerController({
      activation,
      home: activation.document.home,
      localState: Object.freeze({
        ...createdLocalState,
        async dispose() {
          restoreProcessLogger?.();
          restoreProcessLogger = null;
          if (ownsLocalState) await createdLocalState.dispose();
        },
      }),
      installation,
      dependencies: input.dependencies,
      ui: input.ui,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const unbindShutdown = bindEphemeralRunnerShutdown({ requestClose: controller.requestClose });
    try {
      return await controller.run();
    } finally {
      unbindShutdown();
    }
  } finally {
    // Controller owns normal terminal cleanup. These idempotent fallbacks cover
    // setup failures before it exists.
    restoreProcessLogger?.();
    restoreProcessLogger = null;
    if (ownsLocalState) await localState?.dispose().catch(() => undefined);
    activation.dispose();
  }
}
