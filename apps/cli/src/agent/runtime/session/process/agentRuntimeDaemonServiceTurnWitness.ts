import { z } from 'zod';
import {
  SESSION_PERMISSION_MODES,
  SessionInputCausalPermissionAuthorityV1Schema,
} from '@happier-dev/protocol';
import { asHostProtocolZod } from '@/plugins/runtime/protocolComposableZodAdapter';

const OpaqueIdSchema = z.string().trim().min(1).max(512);
const HostSessionInputCausalPermissionAuthorityV1Schema =
  asHostProtocolZod(SessionInputCausalPermissionAuthorityV1Schema);

export const AgentRuntimeDaemonServiceTurnWitnessV1Schema =
  z.object({
    turnId: OpaqueIdSchema,
    inputId: OpaqueIdSchema,
    userMessageSeq:
      z.number().int().nonnegative().nullable(),
    userMessageSeqs: z.array(
      z.number().int().nonnegative(),
    ).max(4_096),
    causalPermissionAuthority:
      HostSessionInputCausalPermissionAuthorityV1Schema.optional(),
    callerPermissionMode:
      z.enum(SESSION_PERMISSION_MODES).nullable().optional(),
  }).strict();

export type AgentRuntimeDaemonServiceTurnWitnessV1 =
  z.infer<
    typeof AgentRuntimeDaemonServiceTurnWitnessV1Schema
  >;

export type AgentRuntimeDaemonServiceTurnWitnessInputV1 =
  Readonly<{
    turnId: string;
    inputId: string;
    userMessageSeq: number | null;
    userMessageSeqs: readonly number[];
    causalPermissionAuthority?: import('@happier-dev/protocol')
      .SessionInputCausalPermissionAuthorityV1;
    callerPermissionMode?: import('@happier-dev/protocol')
      .SessionPermissionMode | null;
  }>;

/**
 * Projects the strict active-turn identity and its bounded permission facts
 * onto the private runner-to-daemon loopback request. The daemon Session owner
 * consumes these facts; plugin input can neither author nor replace them.
 */
export function projectAgentRuntimeDaemonServiceTurnWitnessV1(
  witness: AgentRuntimeDaemonServiceTurnWitnessInputV1,
): AgentRuntimeDaemonServiceTurnWitnessV1 {
  return AgentRuntimeDaemonServiceTurnWitnessV1Schema.parse({
    turnId: witness.turnId,
    inputId: witness.inputId,
    userMessageSeq: witness.userMessageSeq,
    userMessageSeqs: [...witness.userMessageSeqs],
    ...(witness.causalPermissionAuthority
      ? { causalPermissionAuthority: witness.causalPermissionAuthority }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(witness, 'callerPermissionMode')
      ? { callerPermissionMode: witness.callerPermissionMode ?? null }
      : {}),
  });
}
