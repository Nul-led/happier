import { z } from 'zod';
import { ExecutionRunIntentSchema } from '../../execution/runs/runPrimitives.js';
import { ProviderAgentTargetKeySchema, ProviderModelIdSchema } from '../../providers/ids.js';

/** Role V1 is an executable declaration: every object boundary is closed. */
export const RoleEngineV1Schema = z.object({
  agentTargetKey: ProviderAgentTargetKeySchema,
  modelId: ProviderModelIdSchema.optional(),
  effort: z.string().min(1).optional(),
}).strict();
export type RoleEngineV1 = z.infer<typeof RoleEngineV1Schema>;

export const RoleRunsAsV1Schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session') }).strict(),
  z.object({ kind: z.literal('background_run'), intent: ExecutionRunIntentSchema }).strict(),
]);
export type RoleRunsAsV1 = z.infer<typeof RoleRunsAsV1Schema>;

export const RoleArtifactV1Schema = z.object({
  name: z.string().min(1),
  instructions: z.string(),
  engine: RoleEngineV1Schema.optional(),
  runsAs: RoleRunsAsV1Schema,
  profileId: z.string().min(1).optional(),
  workspaceWrites: z.enum(['allow', 'deny']),
  secondOpinion: z.enum(['off', 'encouraged']),
  enabled: z.boolean(),
}).strict();
export type RoleArtifactV1 = z.infer<typeof RoleArtifactV1Schema>;
