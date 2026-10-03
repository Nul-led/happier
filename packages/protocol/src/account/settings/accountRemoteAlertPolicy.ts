import { z } from 'zod';

import {
  AttentionPreviewBehaviorSchema,
  AttentionQuietHoursBehaviorSchema,
  DEFAULT_ATTENTION_DELIVERY_POLICY_V1,
  REMOTE_ALERT_ATTENTION_DELIVERY_EVENT_IDS,
  AttentionDeliveryPolicyV1Schema,
  composeAttentionDeliveryPolicyDeviceOverrides,
  type AttentionDeliveryEventConfig,
  type AttentionDeliveryPolicyV1,
  type AttentionPreviewBehavior,
  type RemoteAlertAttentionDeliveryEventId,
} from './attentionDeliveryPolicy.js';
import { accountSettingsParse } from './accountSettings.js';
import { resolveAttentionDeliveryPolicyDecision } from './attentionDeliveryPolicyDecision.js';
import { ACCOUNT_SETTINGS_MAX_DOCUMENT_BYTES } from './catalog/accountSettingBounds.js';
import { PUSH_NOTIFICATION_SOUND_IDS } from '../../push/pushNotificationActions.js';

export const RemoteAlertSoundIdSchema = z.enum([
  PUSH_NOTIFICATION_SOUND_IDS.none,
  PUSH_NOTIFICATION_SOUND_IDS.systemDefault,
  PUSH_NOTIFICATION_SOUND_IDS.soft,
  PUSH_NOTIFICATION_SOUND_IDS.urgent,
]);
export type RemoteAlertSoundId = z.infer<typeof RemoteAlertSoundIdSchema>;

const RemoteAlertEventPolicySchema = z.object({
  enabled: z.boolean(),
  quietHoursBehavior: AttentionQuietHoursBehaviorSchema.optional(),
  previewBehavior: AttentionPreviewBehaviorSchema.optional(),
  soundId: RemoteAlertSoundIdSchema.optional(),
}).strict();

const RemoteAlertEventPolicyMapV1Shape = Object.fromEntries(
  REMOTE_ALERT_ATTENTION_DELIVERY_EVENT_IDS.map((eventId) => [eventId, RemoteAlertEventPolicySchema]),
) as Record<RemoteAlertAttentionDeliveryEventId, typeof RemoteAlertEventPolicySchema>;

export const RemoteAlertEventPolicyMapV1Schema = z.object(RemoteAlertEventPolicyMapV1Shape).strict();
export type RemoteAlertEventPolicyMapV1 = z.infer<typeof RemoteAlertEventPolicyMapV1Schema>;

const RemoteAlertChannelPolicyV1Schema = RemoteAlertEventPolicySchema.extend({
  events: RemoteAlertEventPolicyMapV1Schema,
}).strict();

const RemoteAlertQuietHoursWindowV1Schema = z.object({
  startLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  endLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).optional(),
}).strict();

export const RemoteAlertQuietHoursV1Schema = z.object({
  enabled: z.boolean(),
  timezone: z.string().trim().min(1),
  windows: z.array(RemoteAlertQuietHoursWindowV1Schema),
}).strict();
export type RemoteAlertQuietHoursV1 = z.infer<typeof RemoteAlertQuietHoursV1Schema>;

const RemoteAlertEventSoundMapV1Schema = z.object(Object.fromEntries(
  REMOTE_ALERT_ATTENTION_DELIVERY_EVENT_IDS.map((eventId) => [eventId, RemoteAlertSoundIdSchema.optional()]),
) as Record<RemoteAlertAttentionDeliveryEventId, z.ZodOptional<typeof RemoteAlertSoundIdSchema>>).strict();

// A projection only removes private fields and normalizes supported choices. Reserve
// the complete existing settings budget plus canonical default expansion; do not
// introduce a separate quiet-hours window count or truncate a valid schedule.
export const ACCOUNT_REMOTE_ALERT_POLICY_MAX_UTF8_BYTES = ACCOUNT_SETTINGS_MAX_DOCUMENT_BYTES
  + new TextEncoder().encode(JSON.stringify(DEFAULT_ATTENTION_DELIVERY_POLICY_V1)).byteLength;

export const AccountRemoteAlertPolicyV1Schema = z.object({
  v: z.literal(1),
  events: RemoteAlertEventPolicyMapV1Schema,
  channels: z.object({ expo_push: RemoteAlertChannelPolicyV1Schema }).strict(),
  quietHours: RemoteAlertQuietHoursV1Schema,
  foregroundBehavior: z.enum(['full', 'silent', 'off']),
  mutePhoneWhenComputerFocused: z.boolean().optional(),
  privacy: z.object({
    defaultPreviewBehavior: AttentionPreviewBehaviorSchema,
    surfaces: z.object({ expo_push: AttentionPreviewBehaviorSchema.optional() }).strict(),
  }).strict(),
  sounds: z.object({
    defaultSoundId: RemoteAlertSoundIdSchema,
    eventSoundIds: RemoteAlertEventSoundMapV1Schema,
    volume: z.number().min(0).max(1),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > ACCOUNT_REMOTE_ALERT_POLICY_MAX_UTF8_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Remote alert policy exceeds the Account settings encoding bound' });
  }
});
export type AccountRemoteAlertPolicyV1 = z.infer<typeof AccountRemoteAlertPolicyV1Schema>;

export const AccountRemoteAlertPolicyBindingV1Schema = z.object({
  settingsVersion: z.number().int().nonnegative(),
  policy: AccountRemoteAlertPolicyV1Schema,
}).strict();

export function resolveAccountRemoteAlertPolicyCurrentness(value: unknown, settingsVersion: number):
  | { status: 'disabled' | 'stale'; policy: null }
  | { status: 'current'; policy: AccountRemoteAlertPolicyV1 } {
  if (value === null || value === undefined) return { status: 'disabled', policy: null };
  const parsed = AccountRemoteAlertPolicyBindingV1Schema.safeParse(value);
  return parsed.success && parsed.data.settingsVersion === settingsVersion
    ? { status: 'current', policy: parsed.data.policy }
    : { status: 'stale', policy: null };
}

export const DeviceRemoteAlertPolicyV1Schema = z.object({
  v: z.literal(1),
  enabled: z.boolean(),
  nativeConsumer: z.enum(['ios_service_extension_v1', 'android_native_v1']),
  quietHoursOverride: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('account') }).strict(),
    z.object({ mode: z.literal('disabled') }).strict(),
    z.object({ mode: z.literal('custom'), timezone: z.string().trim().min(1), windows: z.array(RemoteAlertQuietHoursWindowV1Schema) }).strict(),
  ]),
  foregroundBehavior: z.enum(['account', 'full', 'silent', 'off']),
  previewCeiling: z.enum(['account', 'status_only', 'title_only', 'include_preview']),
  soundVolume: z.number().min(0).max(1),
}).strict();
export type DeviceRemoteAlertPolicyV1 = z.infer<typeof DeviceRemoteAlertPolicyV1Schema>;

function remoteSound(id: string): RemoteAlertSoundId {
  const parsed = RemoteAlertSoundIdSchema.safeParse(id);
  return parsed.success ? parsed.data : PUSH_NOTIFICATION_SOUND_IDS.none;
}

function projectEvent(event: AttentionDeliveryEventConfig) {
  return {
    enabled: event.enabled,
    ...(event.quietHoursBehavior === undefined ? {} : { quietHoursBehavior: event.quietHoursBehavior }),
    ...(event.previewBehavior === undefined ? {} : { previewBehavior: event.previewBehavior }),
    ...(event.soundId === undefined ? {} : { soundId: remoteSound(event.soundId) }),
  };
}

export function deriveAccountRemoteAlertPolicyV1(settings: unknown): AccountRemoteAlertPolicyV1 | null {
  const parsed = accountSettingsParse(settings);
  const policy = parsed.attentionDeliveryPolicyV1;
  // The same public projection carries wake muting even when Home OS alerts
  // are opted out. It must never turn that opt-out into alert consent.
  if (parsed.sessionRemoteAlertsEnabled !== true && policy.mutePhoneWhenComputerFocused !== true) return null;
  const projectEvents = (events: AttentionDeliveryPolicyV1['events']) => Object.fromEntries(
    REMOTE_ALERT_ATTENTION_DELIVERY_EVENT_IDS.map((event) => [event, projectEvent(events[event])]),
  );
  return AccountRemoteAlertPolicyV1Schema.parse({
    v: 1,
    events: projectEvents(policy.events),
    channels: { expo_push: { ...projectEvent(policy.channels.expo_push),
      enabled: parsed.sessionRemoteAlertsEnabled === true && policy.channels.expo_push.enabled,
      events: projectEvents(policy.channels.expo_push.events) } },
    quietHours: {
      enabled: policy.quietHours.enabled,
      timezone: policy.quietHours.timezone,
      windows: policy.quietHours.windows.map(({ startLocalTime, endLocalTime, days }) => ({ startLocalTime, endLocalTime, ...(days ? { days } : {}) })),
    },
    foregroundBehavior: policy.foregroundBehavior,
    ...(policy.mutePhoneWhenComputerFocused === undefined ? {} : { mutePhoneWhenComputerFocused: policy.mutePhoneWhenComputerFocused }),
    privacy: { defaultPreviewBehavior: policy.privacy.defaultPreviewBehavior, surfaces: policy.privacy.surfaces.expo_push === undefined ? {} : { expo_push: policy.privacy.surfaces.expo_push } },
    sounds: {
      defaultSoundId: remoteSound(policy.sounds.defaultSoundId),
      eventSoundIds: Object.fromEntries(REMOTE_ALERT_ATTENTION_DELIVERY_EVENT_IDS
        .filter((event) => policy.sounds.eventSoundIds[event] !== undefined)
        .map((event) => [event, remoteSound(policy.sounds.eventSoundIds[event])])),
      volume: policy.sounds.volume,
    },
  });
}

export function restrictAttentionPreviewBehavior(
  preview: AttentionPreviewBehavior,
  ceiling: AttentionPreviewBehavior | 'account',
): AttentionPreviewBehavior {
  const order = AttentionPreviewBehaviorSchema.options;
  return ceiling === 'account' || order.indexOf(preview) <= order.indexOf(ceiling) ? preview : ceiling;
}

export function resolveRemoteAlertPolicyDecision(params: Readonly<{
  accountPolicy: unknown;
  devicePolicy: unknown;
  event: string;
  now: Date | string;
  foregroundState?: 'foreground' | 'background';
}>) {
  const account = AccountRemoteAlertPolicyV1Schema.safeParse(params.accountPolicy);
  const device = DeviceRemoteAlertPolicyV1Schema.safeParse(params.devicePolicy);
  if (!account.success || !device.success || !device.data.enabled) return null;
  if (!Object.hasOwn(account.data.events, params.event)) return null;
  const policy = composeAttentionDeliveryPolicyDeviceOverrides(AttentionDeliveryPolicyV1Schema.parse(account.data), {
    quietHoursOverride: device.data.quietHoursOverride,
    foregroundBehavior: device.data.foregroundBehavior,
    previewBehavior: 'account',
    soundVolume: device.data.soundVolume,
  });
  const decision = resolveAttentionDeliveryPolicyDecision({ policy, event: params.event, channel: 'expo_push', now: params.now, foregroundState: params.foregroundState });
  return { ...decision, previewBehavior: restrictAttentionPreviewBehavior(decision.previewBehavior, device.data.previewCeiling) };
}
