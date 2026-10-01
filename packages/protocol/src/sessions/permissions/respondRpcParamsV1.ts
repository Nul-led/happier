import { z } from 'zod';
import { StructuredQuestionAnswersV1Schema } from '../../tools/structuredQuestionAnswersV1.js';

export const SessionPermissionRespondDecisionV1Schema = z.enum([
  'approved', 'approved_for_session', 'approved_execpolicy_amendment', 'denied', 'abort',
]);
/** Released Action callers used allow/deny; current callers use the RPC vocabulary. */
export const SessionPermissionRespondActionDecisionV1Schema = z.enum([
  'allow', 'deny', ...SessionPermissionRespondDecisionV1Schema.options,
]);
export type SessionPermissionRespondActionDecisionV1 = z.infer<typeof SessionPermissionRespondActionDecisionV1Schema>;

const common = {
  id: z.string(), turnId: z.string().optional(), reason: z.string().optional(),
  mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional(),
  allowedTools: z.array(z.string()).optional(),
  decision: SessionPermissionRespondDecisionV1Schema.optional(),
  execPolicyAmendment: z.object({ command: z.array(z.string()) }).strict().optional(),
  updatedPermissions: z.unknown().optional(), answers: StructuredQuestionAnswersV1Schema.optional(),
};
/** Closed mutation carrier; approval authority remains with admission and the runtime. */
export const SessionPermissionRespondRpcParamsV1Schema = z.discriminatedUnion('approved', [
  z.object({ ...common, approved: z.literal(true) }).strict(),
  z.object({ ...common, approved: z.literal(false) }).strict(),
]);
export type SessionPermissionRespondRpcParamsV1 = z.infer<typeof SessionPermissionRespondRpcParamsV1Schema>;

/** One Action-to-RPC compatibility seam, consumed by both first-party hosts. */
export function buildSessionPermissionRespondRpcParamsV1(input: Readonly<
  Omit<SessionPermissionRespondRpcParamsV1, 'approved' | 'decision'> & {
    decision: SessionPermissionRespondActionDecisionV1;
  }
>): SessionPermissionRespondRpcParamsV1 {
  const { decision, ...fields } = input;
  const rpcDecision = decision === 'deny' ? 'denied'
    : decision === 'allow' ? input.execPolicyAmendment ? 'approved_execpolicy_amendment' : undefined
    : decision;
  return SessionPermissionRespondRpcParamsV1Schema.parse({
    ...fields, approved: rpcDecision !== 'denied' && rpcDecision !== 'abort',
    ...(rpcDecision ? { decision: rpcDecision } : {}),
  });
}
