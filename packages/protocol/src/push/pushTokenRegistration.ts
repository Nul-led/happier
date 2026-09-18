import { z } from 'zod';
import { DeviceRemoteAlertPolicyV1Schema } from '../account/settings/accountRemoteAlertPolicy.js';

export const PushTokenRegisterRequestSchema = z.object({
  token: z.string(),
  clientServerUrl: z.string().optional(),
  remoteAlerts: z.object({
    registrationId: z.string().min(1),
    policy: DeviceRemoteAlertPolicyV1Schema.nullable(),
  }).strict().optional(),
});
export const PushTokenRegisterResponseSchema = z.object({ success: z.literal(true) });
export const PushTokenSchema = z.object({
  id: z.string(),
  token: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  clientServerUrl: z.string().nullable().optional(),
});
export const PushTokensResponseSchema = z.object({ tokens: z.array(PushTokenSchema) });
export const PushTokensRemoteAlertProjectionV2Schema = z.object({
  v: z.literal(2),
  accountRemoteAlerts: z.object({
    settingsVersion: z.number().int().nonnegative(),
    status: z.enum(['disabled', 'current', 'stale']),
  }).strict(),
  tokens: z.array(PushTokenSchema.extend({ remoteAlerts: DeviceRemoteAlertPolicyV1Schema.nullable() }).strict()),
}).strict();
export type PushTokensRemoteAlertProjectionV2 = z.infer<typeof PushTokensRemoteAlertProjectionV2Schema>;
