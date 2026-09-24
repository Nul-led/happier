import type { StoredCredentials } from '@/persistence';

import { runBackendTargetStartWorkflow } from '../shared/runBackendTargetStartWorkflow';
import { SESSION_HELP_LINES } from '../shared/sessionCommandUsage';

export async function cmdSessionDelegateStart(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<StoredCredentials | null> }>,
): Promise<void> {
  await runBackendTargetStartWorkflow({
    actionId: 'subagents.delegate.start',
    kind: 'session_delegate_start',
    usageLine: SESSION_HELP_LINES.delegateStart,
    startedLabel: 'delegate started',
    delegateSpellings: true,
  }, argv, deps);
}
