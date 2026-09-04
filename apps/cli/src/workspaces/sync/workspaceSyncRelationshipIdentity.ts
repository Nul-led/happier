import { createHash } from 'node:crypto';

/**
 * The one rule binding a persistent relationship to the handoff operation that
 * created it.
 *
 * The source controller mints the id here; the target daemon re-derives it to
 * prove that a destructive replacement approval — which the plan binds to the
 * *handoff operation* identity — was stamped for this relationship rather than
 * replayed from another operation against the same unchanged target. Both sides
 * must read the rule from this owner, because the target's authorization
 * decision is only as strong as its agreement with the minting rule.
 */
export function deriveWorkspaceSyncRelationshipId(operationId: string): string {
  return `relationship_${createHash('sha256').update(operationId).digest('hex')}`;
}
