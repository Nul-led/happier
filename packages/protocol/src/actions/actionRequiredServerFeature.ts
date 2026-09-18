import type { FeatureId } from '../features/catalog.js';
import { WorkflowActionIdV1Schema } from './actionIds.js';
import { isSessionBoardActionIdV1 } from '../sessions/board/actionIds.js';
import { isSessionDiscussionActionIdV1 } from '../sessions/discussions/actionIds.js';
import { TeamCredentialActionIdV1Schema } from '../teams/credentials/actionsV1.js';
import { SharedSavedSecretActionIdV1Schema } from '../account/settings/savedSecretResourceActionsV1.js';

/**
 * The canonical server feature each gated Action family depends on.
 *
 * An Action row declares what an intent is; it does not declare whether the
 * exact target Home can serve it. Hosts that advertise or admit Actions —
 * catalogs, tool projections, MCP enablement — must intersect the shared
 * Actions policy with this feature, resolved against that Home's own decision.
 * Keeping the family→feature fact here stops each host from growing its own
 * id-to-feature branch and drifting when a family is added.
 *
 * Effect-time access, currentness and encryption readiness remain owned by each
 * Action adapter; this is availability only.
 */
export function getActionRequiredServerFeatureId(actionId: string): FeatureId | null {
  if (WorkflowActionIdV1Schema.safeParse(actionId).success) return 'workflows';
  if (isSessionBoardActionIdV1(actionId)) return 'sessions.board';
  if (isSessionDiscussionActionIdV1(actionId)) return 'sessions.conversations';
  if (TeamCredentialActionIdV1Schema.safeParse(actionId).success) {
    return actionId.startsWith('teams.credentials.externalKeys.')
      ? 'teams.credentialResources.externalApi'
      : 'teams.credentialResources';
  }
  if (SharedSavedSecretActionIdV1Schema.safeParse(actionId).success) {
    return 'teams.credentialResources';
  }
  return null;
}
