import type { ConnectedServiceRuntimeFailureClassification } from '../types';
import type { ConnectedServiceRuntimeAuthFailureDaemonReport } from '../reportConnectedServiceRuntimeAuthFailureToDaemon';
import type { ConnectedServiceRuntimeAuthRecoveryProjection } from './connectedServiceRuntimeAuthRecoveryProjection';

export type ConnectedServiceRuntimeAuthRecoveryProjectionResult = Readonly<{
  statusMessageAdded: boolean;
  genericMessageEmitted: boolean;
  typedProjectionCommitted: boolean;
  requiresFallback: boolean;
  emitted: boolean;
}>;

export function projectConnectedServiceRuntimeAuthRecoveryReport(input: Readonly<{
  report: ConnectedServiceRuntimeAuthFailureDaemonReport;
  classification?: ConnectedServiceRuntimeFailureClassification;
  addStatusMessage?: (message: string) => void;
  sendGenericStatusMessage?: (message: string) => void;
  commitTypedProjection?: (projection: ConnectedServiceRuntimeAuthRecoveryProjection) => boolean | void;
}>): ConnectedServiceRuntimeAuthRecoveryProjectionResult {
  const statusMessage = input.report.statusMessage;
  const projection = input.report.projection;
  let statusMessageAdded = false;
  let genericMessageEmitted = false;
  let typedProjectionCommitted = false;

  if (statusMessage) {
    input.addStatusMessage?.(statusMessage);
    statusMessageAdded = Boolean(input.addStatusMessage);
  }

  const hasDaemonTranscriptEvent = Boolean(projection?.transcriptEvent);
  const hasProviderTypedProjection = Boolean(projection?.uxDiagnostic) && !hasDaemonTranscriptEvent;
  if (projection && hasProviderTypedProjection && input.commitTypedProjection) {
    typedProjectionCommitted = input.commitTypedProjection(projection) !== false;
  }

  const requiresFallback = Boolean(statusMessage) && !typedProjectionCommitted && !hasDaemonTranscriptEvent;
  if (statusMessage && requiresFallback && input.sendGenericStatusMessage) {
    input.sendGenericStatusMessage(statusMessage);
    genericMessageEmitted = true;
  }

  return {
    statusMessageAdded,
    genericMessageEmitted,
    typedProjectionCommitted,
    requiresFallback,
    emitted: statusMessageAdded || genericMessageEmitted || typedProjectionCommitted,
  };
}
