import type { StoredCredentials } from '@/persistence';

import { runBackendTargetStartWorkflow } from '../shared/runBackendTargetStartWorkflow';
import { SESSION_HELP_LINES } from '../shared/sessionCommandUsage';

export async function cmdSessionVoiceAgentStart(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<StoredCredentials | null> }>,
): Promise<void> {
  await runBackendTargetStartWorkflow({
    actionId: 'voice_agent.start',
    kind: 'session_voice_agent_start',
    usageLine: SESSION_HELP_LINES.voiceAgentStart,
    startedLabel: 'voice agent started',
  }, argv, deps);
}
