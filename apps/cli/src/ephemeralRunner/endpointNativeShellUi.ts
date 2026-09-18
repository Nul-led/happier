import type { RunnerLaunchManifestV1 } from '@happier-dev/protocol/ephemeralRunner/launchManifest';

import type {
  EphemeralRunnerEndpointFailure,
  EphemeralRunnerEndpointPhase,
  EphemeralRunnerEndpointUi,
} from './controlPlane';
import {
  resolveEphemeralRunnerActiveClosePresentation,
  resolveEphemeralRunnerConsentReviewPresentation,
  resolveEphemeralRunnerDirectoryChoicePresentation,
  resolveEphemeralRunnerEndpointPresentation,
  resolveEphemeralRunnerFailureRecoveryPresentation,
  resolveEphemeralRunnerEndpointLocale,
  resolveEphemeralRunnerReviewedRuntimeFacts,
  type EphemeralRunnerActiveClosePresentation,
  type EphemeralRunnerConsentReviewFact,
  type EphemeralRunnerConsentReviewPresentation,
  type EphemeralRunnerDirectoryChoicePresentation,
  type EphemeralRunnerFailureRecoveryPresentation,
} from './endpointTerminalUi';

/**
 * Every request carries the resolved copy for the decision it asks for. The
 * shell is a renderer: it must never have to supply a word of its own, so a copy
 * or locale change reaches the native surface without touching the shell bytes.
 * Shell and core ship together in one immutable package, so this seam has no
 * mixed-version obligation.
 */
export type EphemeralRunnerNativeShellRequest =
  | Readonly<{ v: 1; type: 'choose_directory'; chooser: EphemeralRunnerDirectoryChoicePresentation }>
  | Readonly<{ v: 1; type: 'review'; review: EphemeralRunnerConsentReviewPresentation }>
  | Readonly<{
      v: 1;
      type: 'confirm_active_close';
      phase: Extract<EphemeralRunnerEndpointPhase, 'starting' | 'running'>;
      confirm: EphemeralRunnerActiveClosePresentation;
    }>
  | Readonly<{
      v: 1;
      type: 'failure_recovery';
      failure: EphemeralRunnerEndpointFailure;
      canRetry: boolean;
      recovery: EphemeralRunnerFailureRecoveryPresentation;
    }>;

export type EphemeralRunnerNativeShellResponse =
  | Readonly<{ v: 1; type: 'directory_selected'; directory: string | null }>
  | Readonly<{ v: 1; type: 'consent_decision'; decision: 'allow' | 'decline' }>
  | Readonly<{ v: 1; type: 'active_close_decision'; decision: 'stop' | 'keep_open' }>
  | Readonly<{ v: 1; type: 'failure_recovery_decision'; decision: 'retry' | 'exit' }>;

export type EphemeralRunnerNativeShellEvent =
  | Readonly<{ v: 1; type: 'stop_session' | 'close_requested' }>
  /**
   * Carrier-generated, never accepted from the shell: the transport reports that
   * the shell process is gone and no decision can arrive again.
   */
  | Readonly<{ v: 1; type: 'shell_disconnected' }>;

export type EphemeralRunnerNativeShellPublication = Readonly<{
  v: 1;
  type: 'presentation';
  presentation: ReturnType<typeof resolveEphemeralRunnerEndpointPresentation>;
}>;

export type EphemeralRunnerNativeShellTransport = Readonly<{
  request(
    message: EphemeralRunnerNativeShellRequest,
    signal: AbortSignal,
  ): Promise<EphemeralRunnerNativeShellResponse>;
  subscribe(listener: (message: EphemeralRunnerNativeShellEvent) => void): () => void;
  publish?(message: EphemeralRunnerNativeShellPublication): void;
}>;

function unexpectedResponse(response: EphemeralRunnerNativeShellResponse): never {
  throw new Error(`runner_native_shell_unexpected_response:${response.type}`);
}

/**
 * Thin presentation adapter for the separately composed native shell. The
 * endpoint controller remains the only activation/runtime lifecycle owner;
 * this boundary carries only native user decisions and closed presentation.
 */
export function createEphemeralRunnerNativeShellUi(
  transport: EphemeralRunnerNativeShellTransport,
  input: Readonly<{ locale?: string | null }> = {},
): EphemeralRunnerEndpointUi<RunnerLaunchManifestV1> {
  const locale = resolveEphemeralRunnerEndpointLocale(input);
  let controls: Readonly<{ requestStop(): Promise<'kept_open' | 'stopped'> }> | null = null;
  /**
   * A dead shell removes the endpoint's only surface. Every later decision is
   * answered from here with the safest terminal outcome instead of a request the
   * shell can never answer, so the controller's own stop path can complete
   * rather than stranding a running Session and its child Agent.
   */
  let disconnected = false;
  /**
   * The narrowed facts this surface may keep showing once the request has been
   * consented to. The full review is published exactly once, with its decision.
   */
  let reviewedRuntimeSummary: readonly EphemeralRunnerConsentReviewFact[] = [];
  // One subscription for the carrier's whole lifetime. Every shell event asks
  // the bound Stop owner to close, so binding is a matter of which owner is
  // current, not of attaching and detaching listeners.
  transport.subscribe((message) => {
    if (message.type === 'shell_disconnected') disconnected = true;
    void controls?.requestStop();
  });

  return Object.freeze({
    async selectDirectory({ signal }) {
      if (disconnected) return null;
      const response = await transport.request({
        v: 1,
        type: 'choose_directory',
        chooser: resolveEphemeralRunnerDirectoryChoicePresentation({ locale }),
      }, signal);
      if (response.type !== 'directory_selected') return unexpectedResponse(response);
      return response.directory;
    },
    async reviewAndRequestConsent({ review, signal }) {
      // Consent is opt-in: an absent endpoint never grants it.
      if (disconnected) return false;
      reviewedRuntimeSummary = resolveEphemeralRunnerReviewedRuntimeFacts({
        manifest: review.manifest,
        directory: review.directory,
        locale,
      });
      // The shell renders the same closed projection the terminal renders, so a
      // reviewed fact can never be present on one surface and missing on the
      // other. Sealed manifest material never crosses this boundary.
      const response = await transport.request({
        v: 1,
        type: 'review',
        review: resolveEphemeralRunnerConsentReviewPresentation({
          manifest: review.manifest,
          directory: review.directory,
          locale,
        }),
      }, signal);
      if (response.type !== 'consent_decision') return unexpectedResponse(response);
      return response.decision === 'allow';
    },
    async confirmActiveClose({ phase, signal }) {
      if (disconnected) return 'stop';
      const response = await transport.request({
        v: 1,
        type: 'confirm_active_close',
        phase,
        confirm: resolveEphemeralRunnerActiveClosePresentation({ phase, locale }),
      }, signal);
      if (response.type !== 'active_close_decision') return unexpectedResponse(response);
      return response.decision;
    },
    async requestFailureRecovery({ failure, canRetry, signal }) {
      if (disconnected) return 'exit';
      const response = await transport.request({
        v: 1,
        type: 'failure_recovery',
        failure,
        canRetry,
        recovery: resolveEphemeralRunnerFailureRecoveryPresentation({ failure, locale }),
      }, signal);
      if (response.type !== 'failure_recovery_decision') return unexpectedResponse(response);
      return response.decision;
    },
    bindControls(nextControls) {
      controls = nextControls;
      // The shell can die before the controller binds its Stop owner.
      if (disconnected) void controls.requestStop();
      return () => { controls = null; };
    },
    present(snapshot) {
      transport.publish?.({
        v: 1,
        type: 'presentation',
        presentation: resolveEphemeralRunnerEndpointPresentation({
          ...snapshot,
          reviewedRuntimeSummary,
          locale,
        }),
      });
    },
  });
}
