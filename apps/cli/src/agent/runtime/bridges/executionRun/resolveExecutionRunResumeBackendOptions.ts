import type { AcpConfigOptionOverridesV1, ConnectedServiceBindingsV1, ProviderBoundModelRef } from '@happier-dev/protocol';

import type { ExecutionRunBackendStartContext } from '@/agent/executionRuns/registry/executionRunBackendTypes';
import type { ExecutionRunState } from './executionRunTypes';

/**
 * ONE backend rehydration owner for execution-run resume (LC-F2).
 *
 * Start owns a rich launch specification; every backend recreation on resume must rebuild from that
 * SAME specification instead of a lossy, defaulted reconstruction. This owner reads the run's
 * immutable admitted state and returns exactly what a recreated backend needs re-applied: the model,
 * canonical config overrides (e.g. reasoning effort), the persisted connected-service SELECTION, and
 * the original start intent (`ExecutionRunBackendStartContext`) so the recreated backend is the SAME
 * kind of backend (runtime-core selects the Voice interaction runtime from `start.intent`).
 *
 * In dev's architecture connected services are materialized DAEMON-side from the selection at backend
 * spawn (fail-closed there): so this owner threads the persisted selection through as `connectedServices`
 * — the daemon re-materializes the exact same account/profile and refuses to start on the wrong
 * (inherited) account. A resumable run bound to a connected account therefore never silently recreates
 * on ambient/native auth. Passing `null` preserves an explicit native (opt-out) selection.
 */
export type ExecutionRunResumeBackendOptions = Readonly<{
  modelId?: string;
  modelSelection?: ProviderBoundModelRef;
  sessionConfigOptionOverrides?: AcpConfigOptionOverridesV1;
  connectedServices?: ConnectedServiceBindingsV1 | null;
  /** The run's immutable admitted start intent, rebuilt so a recreated backend is the SAME kind of backend. */
  start?: ExecutionRunBackendStartContext;
}>;

export function resolveExecutionRunResumeBackendOptions(args: Readonly<{
  run: ExecutionRunState | null;
}>): ExecutionRunResumeBackendOptions {
  const run = args.run;
  if (!run) return {};
  const launch = run.launch ?? null;
  return {
    ...(launch?.modelId ? { modelId: launch.modelId } : {}),
    ...(launch?.modelSelection ? { modelSelection: launch.modelSelection } : {}),
    ...(launch?.sessionConfigOptionOverrides
      ? { sessionConfigOptionOverrides: launch.sessionConfigOptionOverrides }
      : {}),
    ...(launch && launch.connectedServicesSelection !== undefined
      ? { connectedServices: launch.connectedServicesSelection }
      : {}),
    start: {
      intent: run.intent,
      retentionPolicy: run.retentionPolicy,
      ...(run.profileId ? { profileId: run.profileId } : {}),
      ...(typeof run.intentInput !== 'undefined' ? { intentInput: run.intentInput } : {}),
    },
  };
}
