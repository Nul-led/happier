export type WorkflowStepInputIdentity = Readonly<{ localInputId: string }>;
export type WorkflowStepWithdrawalResult = 'withdrawn' | 'dispatched';

/** FIN supplies the report transport; this owner holds only process-local dispatch answers. */
export function createWorkflowStepWithdrawal(ports: Readonly<{
  reportWithdrawn: (input: WorkflowStepInputIdentity) => Promise<void>;
}>) {
  const answers = new Map<string, WorkflowStepWithdrawalResult>();
  const reported = new Set<string>();
  const reporting = new Map<string, Promise<void>>();
  const withdrawWorkflowStepInput = ({ localInputId }: WorkflowStepInputIdentity): WorkflowStepWithdrawalResult => {
    const answer = answers.get(localInputId) ?? 'withdrawn';
    answers.set(localInputId, answer);
    return answer;
  };
  return {
    withdrawWorkflowStepInput,
    /** A fresh canonical offer can reuse a withdrawn physical invocation after Resume. */
    async offerWorkflowStepInput({ localInputId }: WorkflowStepInputIdentity): Promise<void> {
      await reporting.get(localInputId);
      if (answers.get(localInputId) !== 'withdrawn') return;
      answers.delete(localInputId);
      reported.delete(localInputId);
    },
    /** Restored only from an exact persisted host-input commitment, never absence. */
    observeWorkflowStepDispatched({ localInputId }: WorkflowStepInputIdentity): void {
      answers.set(localInputId, 'dispatched');
    },
    isWithdrawn: ({ localInputId }: WorkflowStepInputIdentity) => answers.get(localInputId) === 'withdrawn',
    /** Called synchronously at the input queue's positive check; publication starts in the same turn. */
    claimDispatch(input: WorkflowStepInputIdentity, commit: () => void): boolean {
      if (answers.has(input.localInputId)) return false;
      answers.set(input.localInputId, 'dispatched');
      commit();
      return true;
    },
    async reportWorkflowStepWithdrawn(input: WorkflowStepInputIdentity): Promise<void> {
      if (withdrawWorkflowStepInput(input) !== 'withdrawn' || reported.has(input.localInputId)) return;
      const current = reporting.get(input.localInputId);
      if (current) return await current;
      const report = Promise.resolve().then(async () => {
        await ports.reportWithdrawn(input);
        reported.add(input.localInputId);
      });
      reporting.set(input.localInputId, report);
      try {
        await report;
      } finally {
        reporting.delete(input.localInputId);
      }
    },
  };
}

export type WorkflowStepWithdrawal = ReturnType<typeof createWorkflowStepWithdrawal>;
