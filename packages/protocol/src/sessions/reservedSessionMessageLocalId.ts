import { isSessionAgentTransitionDividerLocalId } from './agentTransitionDivider.js';
import { isSessionFollowWakeEventLocalId } from './follow/sessionFollowTransportV1.js';

/**
 * Host-owned transcript identities that generic Account, Pending, historical,
 * and legacy message ingress must not mint. Their dedicated owners admit them
 * only after proving the corresponding runtime authority.
 */
export function isReservedSessionMessageLocalId(localId: unknown): localId is string {
  return isSessionAgentTransitionDividerLocalId(localId)
    || isSessionFollowWakeEventLocalId(localId);
}
