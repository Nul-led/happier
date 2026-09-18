import type { WorkflowRecoveryTrigger } from './recovery';

/** Daemon lifecycle adapter; intentionally exposes no polling/timer surface. */
export function createWorkflowRecoveryTriggers(
  recover: (trigger: WorkflowRecoveryTrigger) => Promise<void>,
): Readonly<{
  onConnected: () => Promise<void>;
  onResumed: () => Promise<void>;
}> {
  let hasConnected = false;
  return {
    onConnected: async () => {
      const trigger = hasConnected ? 'reconnect' : 'startup';
      hasConnected = true;
      await recover(trigger);
    },
    onResumed: async () => await recover('resume'),
  };
}
