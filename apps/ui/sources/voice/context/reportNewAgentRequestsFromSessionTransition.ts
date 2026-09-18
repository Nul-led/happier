import { normalizeSessionAddress } from '@/sync/domains/session/sessionAddress';
import { deriveNewAgentRequests } from '@/sync/domains/permissions/deriveNewAgentRequests';
import type { Session } from '@/sync/domains/state/storageTypes';
import { voiceHooks } from './voiceHooks';

type SessionLike = Pick<Session, 'id' | 'agentState' | 'serverId'> | null | undefined;

export function reportNewAgentRequestsFromSessionTransition(
  previousSession: SessionLike,
  nextSession: SessionLike,
): void {
  const sessionId = String(nextSession?.id ?? '').trim();
  const address = normalizeSessionAddress(nextSession?.serverId, sessionId);
  if (!address) return;

  for (const nextRequest of deriveNewAgentRequests(previousSession?.agentState?.requests, nextSession?.agentState?.requests)) {
    voiceHooks.onAgentRequest(
      address,
      nextRequest.requestId,
      nextRequest.requestKind,
      nextRequest.toolName,
      nextRequest.toolArgs,
    );
  }
}
