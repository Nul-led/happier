import { describe, expect, it } from 'vitest';

import { accountSettingsParse } from './accountSettings.js';
import {
  AccountSettingsV2UpdateRequestAdmissionSchema,
  AccountSettingsV2UpdateRequestSchema,
} from './accountSettingsApiV2.js';

function remotePolicy() {
  const policy = accountSettingsParse({}).attentionDeliveryPolicyV1;
  const events = {
    ready: { enabled: true },
    permission_request: { enabled: true },
    user_action_request: { enabled: true },
    follow_update: { enabled: true },
  };
  return {
    v: 1,
    events,
    channels: { expo_push: { enabled: true, events, quietHoursBehavior: 'suppress' } },
    quietHours: { enabled: true, timezone: 'Europe/Zurich', windows: [{ startLocalTime: '22:00', endLocalTime: '07:00', days: ['mon'] }] },
    foregroundBehavior: policy.foregroundBehavior,
    privacy: { defaultPreviewBehavior: 'status_only', surfaces: {} },
    sounds: { defaultSoundId: 'soft', eventSoundIds: {}, volume: 1 },
  };
}

describe('Account settings remote alert publication admission', () => {
  for (const [name, schema] of [
    ['admission', AccountSettingsV2UpdateRequestAdmissionSchema],
    ['write', AccountSettingsV2UpdateRequestSchema],
  ] as const) {
    it(`${name} accepts a complete limited policy and explicit opt-out`, () => {
      const request = { content: { t: 'encrypted', c: 'ciphertext' }, expectedVersion: 4 };
      expect(schema.safeParse({ ...request, remoteAlertPolicy: remotePolicy() }).success).toBe(true);
      expect(schema.safeParse({ ...request, remoteAlertPolicy: null }).success).toBe(true);
      expect(schema.safeParse(request).success).toBe(true);
    });

    it(`${name} rejects unknown or malformed policy at every disclosure boundary`, () => {
      const valid = remotePolicy();
      const invalid = [
        { ...valid, settingsVersion: 5 },
        { ...valid, webhook: { url: 'https://private.example' } },
        { ...valid, events: { ...valid.events, future_event: { enabled: true } } },
        { ...valid, events: { ...valid.events, ready: { enabled: true, secret: 'private' } } },
        { ...valid, channels: { expo_push: { ...valid.channels.expo_push, token: 'private' } } },
        { ...valid, quietHours: { ...valid.quietHours, windows: [{ startLocalTime: '25:00', endLocalTime: '07:00' }] } },
        { ...valid, quietHours: { ...valid.quietHours, windows: [{ startLocalTime: '22:00', endLocalTime: '07:00', extra: true }] } },
        { ...valid, privacy: { ...valid.privacy, surfaces: { webhook: 'include_preview' } } },
        { ...valid, sounds: { ...valid.sounds, defaultSoundId: '/private/custom.wav' } },
        { ...valid, sounds: { ...valid.sounds, eventSoundIds: { future_event: 'soft' } } },
        { ...valid, events: { ...valid.events, ready: { enabled: 'false' } } },
      ];
      for (const remoteAlertPolicy of invalid) {
        expect(schema.safeParse({ content: null, expectedVersion: 4, remoteAlertPolicy }).success).toBe(false);
      }
    });
  }
});
