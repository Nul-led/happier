import type {
  AutomationAccountCurrentnessWitnessV1,
  AutomationRunCause,
} from '@happier-dev/protocol';

/**
 * Origin-neutral claim seam shared by Automation and direct Workflow Runs.
 * The single production composition owner is
 * `createProductionWorkflowRunCoordinator` in `./production`; every consumer
 * types its coordinator against that owner's returned claim-to-result
 * contract rather than a parallel composition wrapper.
 */
export type WorkflowClaimForCoordination = Readonly<{
  runId: string;
  automationId?: string;
  attempt: number;
  /** Claimed parent revision used by the one pre-root accepted-snapshot CAS. */
  expectedRevision: number;
  accountCurrentness: AutomationAccountCurrentnessWitnessV1;
  /** Automation origin carries the reviewed definition; direct origin carries an accepted snapshot. */
  definitionEnvelope?: string;
  acceptedEnvelope?: string;
  /** Automation origin only: separately frozen occurrence evidence. */
  automationEvidenceEnvelope?: string | null;
  /** Automation origin only: immutable bounded cause captured at admission. */
  automationCause?: AutomationRunCause;
  /**
   * Registers the exact accepted-authorization predicate with the incumbent
   * claim heartbeat. The heartbeat owns liveness; the Workflow owner keeps
   * private source/principal interpretation behind this closure.
   */
  registerAuthorizationCurrentnessCheck?: (
    check: (signal?: AbortSignal) => Promise<boolean>,
  ) => void;
  /** Registers the exact persisted Run/invocation control read with the incumbent claim heartbeat. */
  registerControlCheck?: (
    check: () => Promise<'running' | 'pause_requested' | 'cancel_requested'>,
  ) => void;
  signal?: AbortSignal;
}>;
