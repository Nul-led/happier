import type { StoredCredentials } from '@/persistence';

import { runBackendTargetStartWorkflow } from '../shared/runBackendTargetStartWorkflow';
import { SESSION_HELP_LINES } from '../shared/sessionCommandUsage';

export async function cmdSessionPlanStart(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<StoredCredentials | null> }>,
): Promise<void> {
  await runBackendTargetStartWorkflow({
    actionId: 'subagents.plan.start',
    kind: 'session_plan_start',
    usageLine: SESSION_HELP_LINES.planStart,
    startedLabel: 'plan started',
  }, argv, deps);
}
