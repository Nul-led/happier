import { z } from 'zod';
import { StrictJsonValueSchema } from '../../json/strictJsonValue.js';
import type { ActionCliProjection } from '../actionCliProjection.js';
import { PluginContributionLocalIdSchema } from '../../plugins/contributionIdentity.js';
import { asProtocolZod } from '../../plugins/actions/internalProtocolZodAdapter.js';
import { PluginIdSchema } from '../../plugins/pluginId.js';

const Id = z.string().trim().min(1);
export const WaitTargetV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('execution_run'), serverId: Id, machineId: Id, sessionId: Id.optional(), runId: Id }).strict(),
  z.object({ kind: z.literal('session'), serverId: Id, sessionId: Id }).strict(),
  z.object({ kind: z.literal('workflow_run'), serverId: Id, runId: Id }).strict(),
  z.object({ kind: z.literal('plugin_source'), serverId: Id, pluginId: asProtocolZod(PluginIdSchema), sourceId: Id }).strict(),
]);
export const WaitConditionV1Schema = z.union([
  z.object({ kind: z.enum(['terminal', 'needs_attention', 'terminal_or_needs_attention', 'idle', 'ready']) }).strict(),
  z.object({ kind: z.literal('turn_terminal'), turnId: Id }).strict(),
  // Discover the exact admitted Action; never derive a local id from a plugin id.
  z.object({ kind: z.literal('plugin'), actionLocalId: asProtocolZod(PluginContributionLocalIdSchema), condition: Id }).strict(),
]);
export const WaitActionInputV1Schema = z.object({
  target: WaitTargetV1Schema,
  condition: WaitConditionV1Schema,
  timeout: z.object({ durationMs: z.number().int().positive().safe() }).strict().optional(),
}).strict();
export const WaitDispositionV1Schema = z.enum([
  'matched', 'observation_timeout', 'cancelled', 'target_unavailable',
  'permission_denied', 'unsupported_condition', 'disconnected',
]);
export const WaitActionResultV1Schema = z.object({
  target: WaitTargetV1Schema,
  condition: WaitConditionV1Schema,
  disposition: WaitDispositionV1Schema,
  snapshot: StrictJsonValueSchema.optional(),
}).strict();
export const WaitOwnerResultV1Schema = WaitActionResultV1Schema.omit({ target: true, condition: true });
export type WaitTargetV1 = z.infer<typeof WaitTargetV1Schema>;
export type WaitConditionV1 = z.infer<typeof WaitConditionV1Schema>;
export type WaitActionInputV1 = z.infer<typeof WaitActionInputV1Schema>;
export type WaitActionResultV1 = z.infer<typeof WaitActionResultV1Schema>;
export type WaitOwnerResultV1 = Pick<WaitActionResultV1, 'disposition' | 'snapshot'>;

export const WAIT_CLI_PROJECTION = {
  commands: [{ path: ['wait'], observation: 'condition', visibility: 'canonical' },
    { path: ['watch'], observation: 'changes', visibility: 'canonical' }],
  acceptsServerId: true,
  requiresServerId: true,
} satisfies ActionCliProjection;
