import { z } from 'zod';

import { PluginUiFallbackRefV1Schema } from '../contributions/ui/actions.js';

export const PluginReactNativeCompatibilityDecisionStateV1Schema = z.enum([
  'load',
  'fallback',
  'disabled',
  'blocked',
]);
export type PluginReactNativeCompatibilityDecisionStateV1 =
  z.infer<typeof PluginReactNativeCompatibilityDecisionStateV1Schema>;

export const PluginReactNativeCompatibilityDecisionReasonV1Schema = z.enum([
  'compatible',
  'feature_disabled',
  'channel_policy_denied',
  'runtime_mismatch',
  'missing_native_capability',
  'unknown',
]);
export type PluginReactNativeCompatibilityDecisionReasonV1 =
  z.infer<typeof PluginReactNativeCompatibilityDecisionReasonV1Schema>;

export const PluginReactNativeCompatibilityDecisionV1Schema = z.object({
  state: PluginReactNativeCompatibilityDecisionStateV1Schema,
  reason: PluginReactNativeCompatibilityDecisionReasonV1Schema,
  fallback: PluginUiFallbackRefV1Schema.optional(),
  diagnostics: z.array(z.string().trim().min(1)).default([]),
}).strict();
export type PluginReactNativeCompatibilityDecisionV1 =
  z.infer<typeof PluginReactNativeCompatibilityDecisionV1Schema>;
