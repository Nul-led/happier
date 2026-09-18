import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

import type { MachineInstallationIdentityV1 } from '@happier-dev/protocol';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol/auth/accountDirectory';
import { decodeBase64, encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { sealBoxBundle } from '@happier-dev/protocol/crypto/boxBundle';
import { signMachineInstallationProof } from '@happier-dev/protocol/machines/identity/installationIdentity';
import type { RunnerActivationBindingV1 } from '@happier-dev/protocol/ephemeralRunner/activation';
import {
  signRunnerClaimV1,
  signRunnerEndpointFactsV1,
  verifyRunnerClaimV1,
  type RunnerClaimV1,
  type RunnerEndpointFactsContentV1,
  type RunnerEndpointFactsV1,
} from '@happier-dev/protocol/ephemeralRunner/endpoint';
import { signRunnerConsentV1, type RunnerConsentV1 } from '@happier-dev/protocol/ephemeralRunner/consent';
import type { RunnerReadinessV1 } from '@happier-dev/protocol/ephemeralRunner/readiness';
import type { RunnerActivationProgressPhaseV1 } from '@happier-dev/protocol/ephemeralRunner/progress';
import tweetnacl from 'tweetnacl';

import packageJson from '../../package.json';
import type { VerifiedEphemeralRunnerActivationFile } from './activationFile';
import type { EphemeralRunnerLocalState } from './localState';

export type EphemeralRunnerEndpointPhase =
  | 'connecting'
  | 'selecting_folder'
  | 'reviewing'
  | 'installing_agent'
  | 'checking_ai_access'
  | 'waiting_for_materialization'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'completed'
  | 'failed';

export type EphemeralRunnerConnectionState = 'connected' | 'reconnecting';

export type EphemeralRunnerEndpointFailure = Readonly<{
  kind: 'before_session' | 'session_runtime_or_stop';
  message: string;
}>;

export type EphemeralRunnerEndpointSnapshot = Readonly<{
  phase: EphemeralRunnerEndpointPhase;
  connection: EphemeralRunnerConnectionState;
  /** Closed, user-safe presentation. Raw provider/runtime errors never reach a shell. */
  failure?: EphemeralRunnerEndpointFailure;
  /** Recovery is safe only before the activation has materialized a Session. */
  canRetry?: boolean;
}>;

export type VerifiedEphemeralRunnerReview<Manifest> = Readonly<{
  manifest: Manifest;
  launchManifestCommitment: string;
  /** The creator's original prepared-submission commitment, always carried by the activation binding. */
  authoringCommitment: string;
  directory: string;
}>;

export type EphemeralRunnerControlPlaneConnection<Manifest> = Readonly<{
  claim(input: Readonly<{ claim: RunnerClaimV1; signal: AbortSignal }>): Promise<unknown>;
  storeEndpointFacts(input: Readonly<{
    endpointFacts: RunnerEndpointFactsV1;
    endpointFactsContent: RunnerEndpointFactsContentV1;
    signal: AbortSignal;
  }>): Promise<void>;
  reportProgress(input: Readonly<{ phase: RunnerActivationProgressPhaseV1; signal: AbortSignal }>): Promise<void>;
  /** Opens and strictly verifies the canonical sealed review projection. */
  waitForReview(input: Readonly<{
    binding: RunnerActivationBindingV1;
    claim: RunnerClaimV1;
    runnerBoxSecretKey: Uint8Array;
    directory: string;
    signal: AbortSignal;
  }>): Promise<VerifiedEphemeralRunnerReview<Manifest>>;
  submitConsent(input: Readonly<{ consent: RunnerConsentV1; signal: AbortSignal }>): Promise<void>;
  submitReadiness(input: Readonly<{ readiness: RunnerReadinessV1; signal: AbortSignal }>): Promise<void>;
  decline(input: Readonly<{ claim: RunnerClaimV1; signal: AbortSignal }>): Promise<void>;
  onConnectionState(listener: (state: EphemeralRunnerConnectionState) => void): () => void;
  close(): Promise<void>;
}>;

export type EphemeralRunnerRuntimeHandle = Readonly<{
  terminal: Promise<Readonly<{ status: 'completed' }> | Readonly<{ status: 'failed'; error: Error }>>;
  stop(): Promise<void>;
}>;

export type EphemeralRunnerDependencies<Manifest, Materialized, Preparation> = Readonly<{
  createConnection(input: Readonly<{
    home: HomeConnectionDescriptorV1;
    /** Activation-local home; auth transport identity must never fall back to persistent CLI state. */
    homeDirectory: string;
    binding: RunnerActivationBindingV1;
    activationSecretKey: Uint8Array;
    installation: MachineInstallationIdentityV1;
    signal: AbortSignal;
  }>): Promise<EphemeralRunnerControlPlaneConnection<Manifest>>;
  prepareAgent(input: Readonly<{
    manifest: Manifest;
    environment: NodeJS.ProcessEnv;
    homeDirectory: string;
    signal: AbortSignal;
  }>): Promise<Preparation>;
  /** Releases request-scoped Agent/plugin preparation on every terminal path. */
  releasePreparation(input: Readonly<{ preparation: Preparation }>): Promise<void>;
  /** Lane 10's fixed readiness application. This seam cannot carry a prompt or inference request. */
  checkNonInferenceReadiness(input: Readonly<{
    binding: RunnerActivationBindingV1;
    claim: RunnerClaimV1;
    consent: RunnerConsentV1;
    manifest: Manifest;
    launchManifestCommitment: string;
    /** Process-local opening key for the endpoint-authenticated sealed bootstrap. */
    runnerBoxSecretKey: Uint8Array;
    /** Process-local signing custody; the callee must not retain either key. */
    activationSecretKey: Uint8Array;
    installationSecretKey: Uint8Array;
    homeDirectory: string;
    preparation: Preparation;
    signal: AbortSignal;
  }>): Promise<Readonly<{ status: 'ready'; readiness: RunnerReadinessV1 }> | Readonly<{ status: 'denied' | 'unavailable'; reason: string }>>;
  materialize(input: Readonly<{
    binding: RunnerActivationBindingV1;
    claim: RunnerClaimV1;
    consent: RunnerConsentV1;
    manifest: Manifest;
    launchManifestCommitment: string;
    /** Process-local key that opens the creator-sealed runtime bootstrap. */
    runnerBoxSecretKey: Uint8Array;
    preparation: Preparation;
    signal: AbortSignal;
  }>): Promise<Materialized>;
  startSession(input: Readonly<{
    binding: RunnerActivationBindingV1;
    manifest: Manifest;
    materialized: Materialized;
    preparation: Preparation;
    localState: EphemeralRunnerLocalState;
    signal: AbortSignal;
    /** The ordinary Session/process terminal owner, exposed before Agent admission. */
    onRuntimeStopReady(stop: () => Promise<void>): void;
  }>): Promise<EphemeralRunnerRuntimeHandle>;
  /** Releases process-local bootstrap custody after the ordinary Session runtime has terminated. */
  releaseMaterialized(input: Readonly<{
    materialized: Materialized;
  }>): Promise<void>;
}>;

export type EphemeralRunnerEndpointUi<Manifest> = Readonly<{
  selectDirectory(input: Readonly<{ signal: AbortSignal }>): Promise<string | null>;
  reviewAndRequestConsent(input: Readonly<{
    review: VerifiedEphemeralRunnerReview<Manifest>;
    signal: AbortSignal;
  }>): Promise<boolean>;
  confirmActiveClose(input: Readonly<{
    phase: Extract<EphemeralRunnerEndpointPhase, 'starting' | 'running'>;
    signal: AbortSignal;
  }>): Promise<'stop' | 'keep_open'>;
  requestFailureRecovery(input: Readonly<{
    failure: EphemeralRunnerEndpointFailure;
    canRetry: boolean;
    signal: AbortSignal;
  }>): Promise<'retry' | 'exit'>;
  bindControls(controls: Readonly<{
    requestStop(): Promise<'kept_open' | 'stopped'>;
  }>): () => void;
  present(snapshot: EphemeralRunnerEndpointSnapshot): void;
}>;

export type EphemeralRunnerControllerResult =
  | Readonly<{ status: 'completed' }>
  | Readonly<{ status: 'retry_requested' }>
  | Readonly<{ status: 'declined' | 'cancelled' }>
  | Readonly<{ status: 'failed'; error: Error }>;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Ephemeral Runner failed');
}

function endpointFailure(canRetry: boolean): EphemeralRunnerEndpointFailure {
  return canRetry
    ? Object.freeze({
        kind: 'before_session',
        message: 'The request could not be prepared. Check the activation and try again.',
      })
    : Object.freeze({
        kind: 'session_runtime_or_stop',
        message: 'The local Agent has stopped. Open the ordinary Session in Happier for details.',
      });
}

export function createEphemeralRunnerController<Manifest, Materialized, Preparation>(input: Readonly<{
  activation: Pick<VerifiedEphemeralRunnerActivationFile, 'binding' | 'activationSecretKey'>;
  home: HomeConnectionDescriptorV1;
  localState: EphemeralRunnerLocalState;
  installation: MachineInstallationIdentityV1;
  dependencies: EphemeralRunnerDependencies<Manifest, Materialized, Preparation>;
  ui: EphemeralRunnerEndpointUi<Manifest>;
  signal?: AbortSignal;
}>) {
  const lifetime = new AbortController();
  let externalStopRequested = false;
  const externalAbort = () => {
    externalStopRequested = true;
    lifetime.abort(input.signal?.reason);
  };
  input.signal?.addEventListener('abort', externalAbort, { once: true });
  let phase: EphemeralRunnerEndpointPhase = 'connecting';
  let connectionState: EphemeralRunnerConnectionState = 'connected';
  let connection: EphemeralRunnerControlPlaneConnection<Manifest> | null = null;
  let runtime: EphemeralRunnerRuntimeHandle | null = null;
  let runtimeStopOwner: (() => Promise<void>) | null = null;
  let runtimeStartPromise: Promise<EphemeralRunnerRuntimeHandle> | null = null;
  let runtimeStopPromise: Promise<void> | null = null;
  let materialized: Materialized | null = null;
  let preparation: Preparation | null = null;
  let activeClaim: RunnerClaimV1 | null = null;
  let runPromise: Promise<EphemeralRunnerControllerResult> | null = null;
  let stopPromise: Promise<void> | null = null;
  let stopFailure: Error | null = null;
  let cleanupPromise: Promise<void> | null = null;
  let releaseMaterializedPromise: Promise<void> | null = null;
  let releasePreparationPromise: Promise<void> | null = null;
  let unsubscribeConnection: (() => void) | null = null;
  let unbindUiControls: (() => void) | null = null;
  let closeDecisionPromise: Promise<'kept_open' | 'stopped'> | null = null;

  const present = (nextPhase: EphemeralRunnerEndpointPhase, canRetry?: boolean) => {
    phase = nextPhase;
    input.ui.present(Object.freeze({
      phase,
      connection: connectionState,
      ...(nextPhase === 'failed' && canRetry !== undefined
        ? { failure: endpointFailure(canRetry) }
        : {}),
      ...(canRetry !== undefined ? { canRetry } : {}),
    }));
  };
  const cleanup = async () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      unsubscribeConnection?.();
      unsubscribeConnection = null;
      unbindUiControls?.();
      unbindUiControls = null;
      if (preparation !== null) {
        releasePreparationPromise ??= input.dependencies.releasePreparation({ preparation });
        await releasePreparationPromise.catch(() => undefined);
      }
      await connection?.close().catch(() => undefined);
      connection = null;
      try {
        await input.localState.dispose();
      } finally {
        input.activation.activationSecretKey.fill(0);
        lifetime.abort();
        input.signal?.removeEventListener('abort', externalAbort);
      }
    })();
    return cleanupPromise;
  };
  const releaseMaterializedOnce = async () => {
    if (materialized === null) return;
    if (releaseMaterializedPromise) return releaseMaterializedPromise;
    const target = materialized;
    releaseMaterializedPromise = input.dependencies.releaseMaterialized({
      materialized: target,
    });
    return releaseMaterializedPromise;
  };
  const stopRuntimeOnce = async () => {
    const stopOwner = runtimeStopOwner ?? runtime?.stop;
    if (!stopOwner) return;
    runtimeStopPromise ??= stopOwner();
    try {
      await runtimeStopPromise;
    } catch (error) {
      stopFailure ??= asError(error);
    }
  };

  const stop = async () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (phase !== 'completed' && phase !== 'failed') present('stopping');
      lifetime.abort(new Error('Ephemeral Runner stop requested'));
      // The ordinary Session/process terminal path owns server revocation. The
      // endpoint only settles its local runtime and bootstrap custody.
      if (runtimeStartPromise !== null) {
        try {
          runtime ??= await runtimeStartPromise;
        } catch {
          // The run path retains the construction failure. A close request only
          // waits until no late runtime can escape local cleanup.
        }
      }
      await stopRuntimeOnce();
      if (materialized !== null) {
        try {
          await releaseMaterializedOnce();
        } catch (error) {
          stopFailure ??= asError(error);
        }
      }
      else if (connection && activeClaim) {
        try {
          await connection.decline({ claim: activeClaim, signal: new AbortController().signal });
        } catch (error) {
          stopFailure = asError(error);
        }
      }
      if (stopFailure) throw stopFailure;
    })();
    return stopPromise;
  };

  const requestClose = async (): Promise<'kept_open' | 'stopped'> => {
    if (closeDecisionPromise) return closeDecisionPromise;
    closeDecisionPromise = (async () => {
      if (phase === 'starting' || phase === 'running') {
        const decision = await input.ui.confirmActiveClose({
          phase,
          signal: lifetime.signal,
        });
        if (decision === 'keep_open') return 'kept_open';
      }
      externalStopRequested = true;
      await stop();
      if (runPromise !== null) await runPromise;
      return 'stopped';
    })();
    try {
      return await closeDecisionPromise;
    } finally {
      closeDecisionPromise = null;
    }
  };

  unbindUiControls = input.ui.bindControls({ requestStop: requestClose });

  const run = async (): Promise<EphemeralRunnerControllerResult> => {
    if (runPromise) return runPromise;
    runPromise = (async () => {
      const runnerBox = tweetnacl.box.keyPair();
      let claim: RunnerClaimV1 | null = null;
      try {
        present('connecting');
        connection = await input.dependencies.createConnection({
          home: input.home,
          homeDirectory: input.localState.homeDirectory,
          binding: input.activation.binding,
          activationSecretKey: input.activation.activationSecretKey,
          installation: input.installation,
          signal: lifetime.signal,
        });
        lifetime.signal.throwIfAborted();
        unsubscribeConnection = connection.onConnectionState((next) => {
          connectionState = next;
          input.ui.present(Object.freeze({ phase, connection: connectionState }));
        });
        const installationPrivateKey = decodeBase64(input.installation.privateKey, 'base64url');
        const installationProof = signMachineInstallationProof({
          payload: {
            version: 1,
            installationId: input.installation.installationId,
            machineId: input.activation.binding.machineId,
            accountId: input.activation.binding.creatorAccountId,
          },
          privateKey: input.installation.privateKey,
        });
        claim = signRunnerClaimV1({
          payload: {
            v: 1,
            purpose: 'happier.ephemeral-session-runner.claim',
            binding: input.activation.binding,
            runnerBoxPublicKey: encodeBase64(runnerBox.publicKey, 'base64url'),
            installation: {
              installationId: input.installation.installationId,
              publicKey: input.installation.publicKey,
              proof: installationProof,
            },
            protocolEpoch: 1,
          },
          activationSecretKey: input.activation.activationSecretKey,
        });
        // A claim request can commit at the Home even when its response is lost.
        // Retain the exact locally signed claim before crossing that boundary so
        // Stop can race it through the canonical activation close operation.
        activeClaim = claim;
        const relayedClaim = await connection.claim({ claim, signal: lifetime.signal });
        const verifiedClaim = verifyRunnerClaimV1({
          claim: relayedClaim,
          expectedBinding: input.activation.binding,
        });
        if (!verifiedClaim) throw new Error('The Home returned a different Runner claim');
        claim = verifiedClaim;
        activeClaim = claim;

        let directory: string;
        if (input.activation.binding.workspace.kind === 'endpoint_home') {
          directory = input.localState.endpointHomeDirectory;
        } else {
          present('selecting_folder');
          const selectedDirectory = await input.ui.selectDirectory({ signal: lifetime.signal });
          lifetime.signal.throwIfAborted();
          // Each UI owner keeps an OS-picker dismissal on its existing
          // outstanding folder request. A null result therefore represents the
          // endpoint's explicit Cancel request (or a dead native shell), and is
          // the only folder-step input that closes this claimed activation.
          if (selectedDirectory === null) {
            await connection.decline({ claim, signal: lifetime.signal });
            return { status: 'declined' };
          }
          directory = selectedDirectory;
        }
        // The strict endpoint-facts schema accepts exactly the platforms a
        // Runner artifact is published for. Narrow the Node value explicitly
        // so an unexpected platform fails before any material is signed.
        const platform = process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
          ? process.platform
          : null;
        if (!platform) throw new Error('runner_endpoint_platform_unsupported');
        const factsContent = {
          v: 1 as const,
          directory,
          machine: {
            host: hostname(),
            platform,
            happyCliVersion: packageJson.version,
            // Happier state is activation-local; the OS home is captured before
            // that isolation and remains the canonical endpoint-home policy target.
            happyHomeDir: input.localState.homeDirectory,
            homeDir: input.localState.endpointHomeDirectory,
          },
        };
        const recipient = input.activation.binding.endpointFactsRecipient;
        const content = recipient.mode === 'plain'
          ? { t: 'plain' as const, v: factsContent }
          : {
              t: 'encrypted' as const,
              c: encodeBase64(sealBoxBundle({
                plaintext: new TextEncoder().encode(JSON.stringify(factsContent)),
                recipientPublicKey: decodeBase64(recipient.contentPublicKey, 'base64url'),
                randomBytes: (length) => new Uint8Array(randomBytes(length)),
              }), 'base64url'),
            };
        let endpointFacts: RunnerEndpointFactsV1;
        try {
          endpointFacts = signRunnerEndpointFactsV1({
            payload: {
              v: 1,
              purpose: 'happier.ephemeral-session-runner.endpoint-facts',
              claim: claim.payload,
              content,
            },
            activationSecretKey: input.activation.activationSecretKey,
            installationSecretKey: installationPrivateKey,
          });
        } finally {
          installationPrivateKey.fill(0);
        }
        await connection.storeEndpointFacts({ endpointFacts, endpointFactsContent: factsContent, signal: lifetime.signal });

        present('reviewing');
        const review = await connection.waitForReview({
          binding: input.activation.binding,
          claim,
          runnerBoxSecretKey: runnerBox.secretKey,
          directory,
          signal: lifetime.signal,
        });
        if (review.directory !== directory) throw new Error('Reviewed directory does not match endpoint selection');
        // The activation binding always carries the creator's original authoring
        // commitment, so this comparison is unconditional: a reviewed manifest
        // that re-authored the request must never reach the consent surface.
        if (review.authoringCommitment !== input.activation.binding.authoringCommitment) {
          throw new Error('Reviewed authoring does not match the activation commitment');
        }
        const allowed = await input.ui.reviewAndRequestConsent({ review, signal: lifetime.signal });
        if (!allowed) {
          await connection.decline({ claim, signal: lifetime.signal });
          return { status: 'declined' };
        }
        const consentInstallationKey = decodeBase64(input.installation.privateKey, 'base64url');
        let consent: RunnerConsentV1;
        try {
          consent = signRunnerConsentV1({
            payload: {
              v: 1,
              purpose: 'happier.ephemeral-session-runner.consent',
              allow: true,
              claim: claim.payload,
              launchManifestCommitment: review.launchManifestCommitment,
            },
            activationSecretKey: input.activation.activationSecretKey,
            installationSecretKey: consentInstallationKey,
          });
        } finally {
          consentInstallationKey.fill(0);
        }
        await connection.submitConsent({ consent, signal: lifetime.signal });

        present('installing_agent');
        preparation = await input.dependencies.prepareAgent({
          manifest: review.manifest,
          environment: input.localState.environment,
          homeDirectory: input.localState.homeDirectory,
          signal: lifetime.signal,
        });
        lifetime.signal.throwIfAborted();
        present('checking_ai_access');
        await connection.reportProgress({ phase: 'checking_ai_access', signal: lifetime.signal });
        const readinessInstallationKey = decodeBase64(input.installation.privateKey, 'base64url');
        let readiness: Awaited<ReturnType<typeof input.dependencies.checkNonInferenceReadiness>>;
        try {
          readiness = await input.dependencies.checkNonInferenceReadiness({
            binding: input.activation.binding,
            claim,
            consent,
            manifest: review.manifest,
            launchManifestCommitment: review.launchManifestCommitment,
            runnerBoxSecretKey: runnerBox.secretKey,
            activationSecretKey: input.activation.activationSecretKey,
            installationSecretKey: readinessInstallationKey,
            homeDirectory: input.localState.homeDirectory,
            preparation,
            signal: lifetime.signal,
          });
        } finally {
          readinessInstallationKey.fill(0);
        }
        if (readiness.status !== 'ready') throw new Error(`AI access is ${readiness.status}: ${readiness.reason}`);
        await connection.submitReadiness({ readiness: readiness.readiness, signal: lifetime.signal });
        present('waiting_for_materialization');
        materialized = await input.dependencies.materialize({
          binding: input.activation.binding,
          claim,
          consent,
          manifest: review.manifest,
          launchManifestCommitment: review.launchManifestCommitment,
          runnerBoxSecretKey: runnerBox.secretKey,
          preparation,
          signal: lifetime.signal,
        });
        if (!lifetime.signal.aborted) present('starting');
        runtimeStartPromise = input.dependencies.startSession({
          binding: input.activation.binding,
          manifest: review.manifest,
          materialized,
          preparation,
          localState: input.localState,
          signal: lifetime.signal,
          onRuntimeStopReady: (stopOwner) => {
            runtimeStopOwner ??= stopOwner;
            if (lifetime.signal.aborted) {
              void stopRuntimeOnce();
            }
          },
        });
        if (lifetime.signal.aborted) {
          await stopRuntimeOnce();
        }
        runtime = await runtimeStartPromise;
        // The endpoint can be stopped while the canonical runtime owner is
        // still constructing. Do not let a late successful construction
        // escape the already-settled Stop and become invisible work.
        if (lifetime.signal.aborted) {
          await stopRuntimeOnce();
          if (stopFailure) throw stopFailure;
          try {
            await releaseMaterializedOnce();
          } catch (error) {
            stopFailure ??= asError(error);
            throw stopFailure;
          }
          lifetime.signal.throwIfAborted();
        }
        present('running');
        const terminal = await runtime.terminal;
        await stop();
        if (externalStopRequested) return { status: 'cancelled' };
        if (terminal.status === 'failed') throw terminal.error;
        present('completed');
        return { status: 'completed' };
      } catch (error) {
        const normalized = asError(error);
        const wasCancelled = externalStopRequested;
        await stop().catch(() => undefined);
        if (wasCancelled && materialized !== null) {
          try {
            await releaseMaterializedOnce();
          } catch (releaseError) {
            stopFailure ??= asError(releaseError);
          }
        }
        if (wasCancelled && stopFailure === null) return { status: 'cancelled' };
        const failure = stopFailure ?? normalized;
        // Retry restarts this process's whole run, which mints a fresh box key
        // and installation identity. Once a claim has been sent, the Home has
        // recorded exactly one winning claim and `stop()` above has already
        // declined that activation, so a second run can only be rejected.
        // Offering Retry there is an invitation into a guaranteed failure loop.
        const canRetry = materialized === null && activeClaim === null;
        const publicFailure = endpointFailure(canRetry);
        present('failed', canRetry);
        const recovery = await input.ui.requestFailureRecovery({
          failure: publicFailure,
          canRetry,
          signal: new AbortController().signal,
        }).catch(() => 'exit' as const);
        if (recovery === 'retry' && materialized === null) return { status: 'retry_requested' };
        return { status: 'failed', error: failure };
      } finally {
        runnerBox.secretKey.fill(0);
        await cleanup();
      }
    })();
    return runPromise;
  };

  return Object.freeze({
    run,
    requestClose,
    stop: async () => {
      externalStopRequested = true;
      await stop();
    },
  });
}
