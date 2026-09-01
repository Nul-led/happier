import { z } from 'zod';

const boundedId = z.string().trim().min(1).max(512);

/**
 * Host-private evidence stamped by the target daemon after inspecting a
 * non-empty handoff destination under root arbitration. It is durable only as
 * approval subject data and is never caller-supplied Action/SDK input.
 */
export const HandoffTargetReplacementApprovalV1Schema = z.object({
  v: z.literal(1),
  consequence: z.literal('replace_nonempty_workspace_target'),
  serverId: boundedId,
  machineId: boundedId,
  canonicalRoot: z.string().min(1).max(4096),
  rootFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  operationId: boundedId,
}).strict();

export type HandoffTargetReplacementApprovalV1 = z.infer<
  typeof HandoffTargetReplacementApprovalV1Schema
>;

export function sameHandoffTargetReplacementApproval(
  left: HandoffTargetReplacementApprovalV1,
  right: HandoffTargetReplacementApprovalV1,
): boolean {
  return left.v === right.v
    && left.consequence === right.consequence
    && left.serverId === right.serverId
    && left.machineId === right.machineId
    && left.canonicalRoot === right.canonicalRoot
    && left.rootFingerprint === right.rootFingerprint
    && left.operationId === right.operationId;
}
