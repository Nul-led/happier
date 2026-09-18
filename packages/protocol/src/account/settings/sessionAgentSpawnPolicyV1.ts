import { z } from 'zod';

import { SESSION_PERMISSION_MODES } from '../../sessions/metadata/sessionPermissionModes.js';

const SessionAgentSpawnPermissionCeilingV1Schema = z
  .enum(SESSION_PERMISSION_MODES)
  .nullable()
  .default(null)
  .catch(null);

export const SessionAgentSpawnPolicyV1Schema = z.object({
  v: z.literal(1).default(1),
  allowCustomDirectory: z.boolean().default(true),
  allowCrossMachine: z.boolean().default(true),
  allowBackendTargetOverride: z.boolean().default(true),
  allowModelOverride: z.boolean().default(true),
  allowPermissionModeOverride: z.boolean().default(true),
  allowAgentModeOverride: z.boolean().default(true),
  allowConfigOptionOverrides: z.boolean().default(true),
  allowProfileOverride: z.boolean().default(true),
  allowConnectedServicesOverride: z.boolean().default(true),
  allowMcpSelectionOverride: z.boolean().default(true),
  allowTranscriptStorageOverride: z.boolean().default(true),
  permissionCeiling: SessionAgentSpawnPermissionCeilingV1Schema,
}).strict().catch({
  v: 1,
  allowCustomDirectory: true,
  allowCrossMachine: true,
  allowBackendTargetOverride: true,
  allowModelOverride: true,
  allowPermissionModeOverride: true,
  allowAgentModeOverride: true,
  allowConfigOptionOverrides: true,
  allowProfileOverride: true,
  allowConnectedServicesOverride: true,
  allowMcpSelectionOverride: true,
  allowTranscriptStorageOverride: true,
  permissionCeiling: null,
});

export type SessionAgentSpawnPolicyV1 = z.infer<typeof SessionAgentSpawnPolicyV1Schema>;

// Durable authorization evidence rejects malformed policy instead of using
// the settings reader's recovery defaults.
export const SessionAgentSpawnPolicyV1StrictSchema = SessionAgentSpawnPolicyV1Schema
  .removeCatch()
  .extend({ permissionCeiling: SessionAgentSpawnPermissionCeilingV1Schema.removeCatch() });

export const DEFAULT_SESSION_AGENT_SPAWN_POLICY_V1: SessionAgentSpawnPolicyV1 =
  SessionAgentSpawnPolicyV1Schema.parse({});
