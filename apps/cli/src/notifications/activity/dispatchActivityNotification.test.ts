import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  accountSettingsParse,
  deriveSettingsSecretsKeyV1,
  encryptSecretStringV1,
  LiveActivityRemoteUpdateRequestV1Schema,
  type LiveActivityRemoteUpdateRequestV1,
} from '@happier-dev/protocol';

import { logger } from '@/ui/logger';
import type {
  PinnedHttpStreamRequest,
  PinnedHttpStreamResponse,
} from '@/network/pinnedHttp';
import {
  dispatchActivityNotificationAsync,
  resolveActivityNotificationPolicyEvent,
} from './dispatchActivityNotification';
import type { ActivityNotificationEvent } from './activityNotificationEvent';

vi.mock('@/ui/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

describe('dispatchActivityNotificationAsync', () => {
  // `fetch` stays stubbed as a guard: webhook delivery must go through the
  // pinned transport, so any call here is a regression back to unpinned dispatch.
  const fetchSpy = vi.fn();
  const webhookRequests: PinnedHttpStreamRequest[] = [];
  const webhookNetwork = {
    resolveAddresses: async () => ['93.184.216.34'],
    openPinnedStream: async (request: PinnedHttpStreamRequest): Promise<PinnedHttpStreamResponse> => {
      webhookRequests.push(request);
      return Object.freeze({
        status: 202,
        headers: {},
        contentLength: 0,
        read: async () => null,
        cancel: () => undefined,
      });
    },
  };

  function webhookRequestBody(request: PinnedHttpStreamRequest | undefined): Record<string, unknown> {
    return JSON.parse(Buffer.from(request?.body ?? new Uint8Array()).toString('utf8'));
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    vi.mocked(logger.debug).mockReset();
    fetchSpy.mockReset();
    webhookRequests.length = 0;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the connected-service account policy for credential health notifications', () => {
    expect(resolveActivityNotificationPolicyEvent({
      topic: 'connected_service_credential_health',
      sessionId: 'session-credential-policy',
      serviceId: 'openai-codex',
      profileId: 'work',
      status: 'reconnect_required',
    })).toBe('connected_service_account_switch');
  });

  it('keeps full permission details only in channels that include request text', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({ notificationChannelsV1: [true, false, undefined].map((include, index) => ({
      v: 1, id: `hook-${index}`, kind: 'webhook', enabled: true,
      url: 'https://hooks.example.test/happier', requestIncludeMessageText: include,
      topics: { permissionRequest: true },
    })) });
    await dispatchActivityNotificationAsync({ settings, webhookNetwork, expoPushSender: { sendToAllDevicesAsync }, event: {
      topic: 'permission_request', sessionId: 's1', requestId: 'p1', toolName: 'Bash',
      toolInput: { command: 'git diff -- apps/cli/src/main.ts', justification: 'Review the complete patch' },
    } });
    const payloads = webhookRequests.map((request) => JSON.parse(Buffer.from(request.body ?? new Uint8Array()).toString('utf8')));
    expect(payloads).toHaveLength(3);
    expect(payloads[0].content.body).toContain('git diff -- apps/cli/src/main.ts');
    expect(payloads[0].request.toolDetails).toContain('Review the complete patch');
    expect(payloads[1].content.body).not.toContain('git diff');
    expect(payloads[1].request.toolDetails).toBeNull();
    expect(payloads[2].request.toolDetails).toContain('Review the complete patch');
    expect(payloads[2].content.body).toContain('git diff -- apps/cli/src/main.ts');
  });

  it('falls back to the builtin expo push channel when explicit channels are missing', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      notificationsSettingsV1: {
        v: 1,
        pushEnabled: true,
        ready: true,
        readyIncludeMessageText: true,
        permissionRequest: true,
        userActionRequest: true,
        foregroundBehavior: 'full',
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-1',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Review branch',
      'The branch is ready to review.',
      { sessionId: 'session-1' },
      { sound: 'happier_soft.wav', priority: 'high', androidSoundId: 'soft' },
    );
    expect(webhookRequests).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([undefined, 'session-reset'])('delivers automatic reset receipts without inventing a session (%s)', async (sessionId) => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const sendLiveActivityRemoteUpdateAsync = vi.fn(async (_request: LiveActivityRemoteUpdateRequestV1) => {});
    const event = {
      topic: 'connected_service_quota_recovered' as const,
      recoveryReason: 'automatic_quota_reset' as const,
      sessionId,
      serviceId: 'acme.accounts/work',
      serviceDisplayName: 'Work account',
      groupId: 'team',
      profileId: 'primary',
      issueFingerprint: `reset-receipt-${sessionId ?? 'startup'}`,
    };
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: { expo_push: { enabled: true } },
        liveActivityRemoteUpdates: { enabled: true, preferredMode: 'direct_apns', defaultStaleAfterSeconds: 900 },
      },
      notificationChannelsV1: [{
        v: 1, id: 'reset-webhook', kind: 'webhook', enabled: true,
        url: 'https://hooks.example.test/happier',
        topics: { ready: false, permissionRequest: false, userActionRequest: false, connectedServiceQuotaRecovered: true },
        readyIncludeMessageText: false,
      }],
    });
    const dispatch = () => dispatchActivityNotificationAsync({
      settings, event, webhookNetwork, expoPushSender: { sendToAllDevicesAsync }, nowMs: () => 100_000,
      liveActivityRemoteSender: { serverId: 'server-reset', sendLiveActivityRemoteUpdateAsync },
    });

    const result = await dispatch();
    expect(result, JSON.stringify(vi.mocked(logger.debug).mock.calls)).toEqual({ attemptedChannels: sessionId ? 3 : 2, deliveredChannels: sessionId ? 3 : 2 });
    expect(sendToAllDevicesAsync.mock.calls[0]).toEqual([
      expect.stringContaining('reset credit used'),
      expect.stringContaining('primary in pool team'),
      expect.objectContaining({ recoveryReason: 'automatic_quota_reset', issueFingerprint: event.issueFingerprint, sessionId }),
      expect.any(Object),
    ]);
    expect(webhookRequestBody(webhookRequests[0])).toMatchObject({
      topic: 'connected_service_quota_recovered',
      content: { body: expect.stringContaining('automatically used a reset credit') },
    });
    expect(webhookRequestBody(webhookRequests[0]).session).toEqual(sessionId ? { sessionId, title: null } : undefined);
    if (sessionId) {
      expect(sendLiveActivityRemoteUpdateAsync.mock.calls[0]?.[0].activityKey.sessionId).toBe(sessionId);
    } else {
      expect(sendLiveActivityRemoteUpdateAsync).not.toHaveBeenCalled();
    }
    expect(await dispatch()).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
  });

  it('dispatches connected-service account switch notifications with structured quota context', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});

    const result = await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'connected_service_account_switch',
        sessionId: 'session-switch',
        sessionTitle: 'Review branch',
        serviceId: 'openai-codex',
        serviceDisplayName: 'OpenAI',
        groupId: 'main',
        fromProfileId: 'primary',
        toProfileId: 'backup',
        fromProfileLabel: 'main@example.test',
        toProfileLabel: 'backup@example.test',
        fromUsagePercent: 100,
        toUsagePercent: 20,
        reason: 'usage_limit',
        limitCategory: 'usage_limit',
        retryAfterMs: 60_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Review branch',
      expect.stringContaining('OpenAI'),
      expect.objectContaining({
        sessionId: 'session-switch',
        serviceId: 'openai-codex',
        serviceDisplayName: 'OpenAI',
        groupId: 'main',
        fromProfileId: 'primary',
        toProfileId: 'backup',
        fromProfileLabel: 'main@example.test',
        toProfileLabel: 'backup@example.test',
        fromUsagePercent: 100,
        toUsagePercent: 20,
        limitCategory: 'usage_limit',
        retryAfterMs: 60_000,
        quotaScope: 'account',
        providerLimitId: 'weekly',
        action: { kind: 'open_url', url: 'https://chatgpt.com/codex/settings/usage' },
      }),
      { sound: 'happier_soft.wav', priority: 'high', androidSoundId: 'soft' },
    );
    const firstSendCall = sendToAllDevicesAsync.mock.calls[0] as unknown[] | undefined;
    const body = firstSendCall?.[1];
    expect(body).toContain('provider reported');
    expect(body).toContain('main@example.test');
    expect(body).toContain('backup@example.test');
    expect(body).not.toContain('openai-codex');
  });

  it('dispatches connected-service credential health notifications without raw provider details', async () => {
    const sendToAllDevicesAsync = vi.fn(async (
      _title: string,
      _body: string,
      _data: Record<string, unknown>,
      _options?: unknown,
    ) => {});

    const result = await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'connected_service_credential_health',
        sessionId: 'session-credential',
        sessionTitle: 'Investigate auth',
        serviceId: 'openai-codex',
        serviceDisplayName: 'OpenAI',
        profileId: 'work',
        profileLabel: 'work@example.test',
        status: 'reconnect_required',
        reason: JSON.stringify({
          error: 'invalid_grant',
          refresh_token: 'secret-refresh-token',
          access_token: 'secret-access-token',
          authorization: 'Bearer secret-authorization-token',
        }),
        providerStatus: 400,
        providerErrorCode: [
          "Cannot find module '/private/node_modules/provider-adapter.js'",
          'Require stack:',
          '/private/app/node_modules/@happier-dev/provider/index.js',
          'OAuth error: invalid_grant',
        ].join('\n'),
        action: {
          kind: 'open_url',
          url: 'https://provider.example.test/reconnect?access_token=secret-url-token',
        },
      } satisfies ActivityNotificationEvent,
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1);
    const [title, body, data] = sendToAllDevicesAsync.mock.calls[0] ?? [];
    expect(title).toBe('Investigate auth');
    expect(body).toContain('OpenAI');
    expect(body).not.toContain('openai-codex');
    expect(body).toContain('work@example.test');
    expect(body).toContain('reconnect');
    expect(body).toContain('invalid_grant');
    const delivered = JSON.stringify({ body, data });
    expect(delivered).not.toContain('secret-refresh-token');
    expect(delivered).not.toContain('secret-access-token');
    expect(delivered).not.toContain('secret-authorization-token');
    expect(delivered).not.toContain('secret-url-token');
    expect(delivered).not.toContain('node_modules');
    expect(delivered).not.toContain('Require stack');
    expect(data).toMatchObject({
      topic: 'connected_service_credential_health',
      sessionId: 'session-credential',
      serviceId: 'openai-codex',
      serviceDisplayName: 'OpenAI',
      profileId: 'work',
      profileLabel: 'work@example.test',
      status: 'reconnect_required',
      reason: 'invalid_grant',
      providerStatus: 400,
      providerErrorCode: 'invalid_grant',
      action: { kind: 'open_url', url: 'https://provider.example.test/reconnect' },
    });
  });

  it('dedupes connected-service account switch notifications inside the dedupe window', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const event = {
      topic: 'connected_service_account_switch' as const,
      sessionId: 'session-switch',
      serviceId: 'openai-codex',
      groupId: 'dedupe-main',
      fromProfileId: 'primary',
      toProfileId: 'backup',
      reason: 'usage_limit',
    };

    await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => 1_000,
      dedupeWindowMs: 60_000,
      event,
    });
    const duplicate = await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => 2_000,
      dedupeWindowMs: 60_000,
      event,
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1);
    expect(duplicate).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
  });

  it('does not dedupe connected-service account switches with different reasons or target profiles', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const event = {
      topic: 'connected_service_account_switch' as const,
      sessionId: 'session-switch',
      serviceId: 'openai-codex',
      serviceDisplayName: 'OpenAI',
      groupId: 'dedupe-variant',
      fromProfileId: 'primary',
      toProfileId: 'backup',
      reason: 'usage_limit',
    };

    await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => 1_000,
      dedupeWindowMs: 60_000,
      event,
    });
    await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => 2_000,
      dedupeWindowMs: 60_000,
      event: {
        ...event,
        fromProfileId: 'backup',
        toProfileId: 'tertiary',
        reason: 'soft_threshold',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(2);
  });

  it('suppresses disabled connected-service account switch Expo push topics', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      notificationChannelsV1: [
        {
          v: 1,
          id: 'expo-primary',
          kind: 'expo_push',
          enabled: true,
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
            connectedServiceAccountSwitch: false,
            connectedServiceQuotaBlocked: true,
            connectedServiceQuotaRecovered: true,
          },
        },
      ],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      dedupeWindowMs: 0,
      event: {
        topic: 'connected_service_account_switch',
        sessionId: 'session-switch-disabled',
        serviceId: 'openai-codex',
        groupId: 'main',
        fromProfileId: 'primary',
        toProfileId: 'backup',
        reason: 'usage_limit',
      },
    });

    expect(result).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
  });

  it('dispatches connected-service quota blocked and recovered notifications', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});

    await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'connected_service_quota_blocked',
        sessionId: 'session-quota',
        serviceId: 'openai-codex',
        serviceDisplayName: 'OpenAI',
        issueFingerprint: 'issue-1',
        groupId: 'main',
        profileId: 'primary',
        limitCategory: 'usage_limit',
      },
    });
    await dispatchActivityNotificationAsync({
      settings: accountSettingsParse({}),
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'connected_service_quota_recovered',
        sessionId: 'session-quota',
        serviceId: 'openai-codex',
        serviceDisplayName: 'OpenAI',
        issueFingerprint: 'issue-1',
        groupId: 'main',
        profileId: 'primary',
        limitCategory: 'usage_limit',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('OpenAI'),
      expect.stringContaining('OpenAI'),
      expect.objectContaining({ topic: 'connected_service_quota_blocked', issueFingerprint: 'issue-1', serviceDisplayName: 'OpenAI' }),
      { sound: 'happier_soft.wav', priority: 'high', androidSoundId: 'soft' },
    );
    expect(sendToAllDevicesAsync).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('OpenAI'),
      expect.stringContaining('OpenAI'),
      expect.objectContaining({ topic: 'connected_service_quota_recovered', issueFingerprint: 'issue-1', serviceDisplayName: 'OpenAI' }),
      { sound: 'happier_soft.wav', priority: 'high', androidSoundId: 'soft' },
    );
  });

  it('suppresses Expo push delivery during account quiet hours', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        quietHours: {
          enabled: true,
          timezone: 'UTC',
          windows: [{ startLocalTime: '00:00', endLocalTime: '23:59' }],
        },
      },
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => Date.parse('2026-05-03T12:00:00.000Z'),
      event: {
        topic: 'ready',
        sessionId: 'session-quiet',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps webhook delivery active during account quiet hours by default', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        quietHours: {
          enabled: true,
          timezone: 'UTC',
          windows: [{ startLocalTime: '00:00', endLocalTime: '23:59' }],
        },
      },
      notificationChannelsV1: [
        {
          v: 1,
          id: 'webhook-primary',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/happier',
          signingSecret: {
            _isSecretValue: true,
            value: 'webhook-secret',
          },
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: false,
        },
      ],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => Date.parse('2026-05-03T12:00:00.000Z'),
      event: {
        topic: 'ready',
        sessionId: 'session-webhook',
        sessionTitle: 'Deploy fix',
        waitingForCommandLabel: 'Gemini',
        assistantPreviewText: 'Deployment is complete.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('suppresses webhook delivery during quiet hours when policy opts in', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        quietHours: {
          enabled: true,
          timezone: 'UTC',
          windows: [{ startLocalTime: '00:00', endLocalTime: '23:59' }],
        },
        channels: {
          webhook: {
            quietHoursBehavior: 'suppress',
          },
        },
      },
      notificationChannelsV1: [
        {
          v: 1,
          id: 'webhook-primary',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/happier',
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: false,
        },
      ],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      nowMs: () => Date.parse('2026-05-03T12:00:00.000Z'),
      event: {
        topic: 'ready',
        sessionId: 'session-webhook-quiet',
        sessionTitle: 'Deploy fix',
        waitingForCommandLabel: 'Gemini',
        assistantPreviewText: 'Deployment is complete.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('suppresses policy-disabled Expo push channels even when legacy channel rows are enabled', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: {
          expo_push: { enabled: false },
        },
      },
      notificationChannelsV1: [
        {
          v: 1,
          id: 'expo-enabled',
          kind: 'expo_push',
          enabled: true,
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: true,
        },
      ],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-disabled',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 0, deliveredChannels: 0 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
  });

  it('uses canonical Expo push policy even when legacy channel rows are stale-disabled', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: {
          expo_push: {
            enabled: true,
            events: {
              ready: { enabled: true },
            },
          },
        },
      },
      notificationChannelsV1: [
        {
          v: 1,
          id: 'expo-stale-disabled',
          kind: 'expo_push',
          enabled: false,
          topics: {
            ready: false,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: true,
        },
      ],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-enabled',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1);
  });

  it('uses canonical Expo push policy when legacy channel rows are absent', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: {
          expo_push: {
            enabled: true,
            events: {
              ready: { enabled: true },
            },
          },
        },
      },
      notificationChannelsV1: [],
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-policy-only',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).toHaveBeenCalledTimes(1);
  });

  it('passes resolved silent sound options to Expo push senders', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        sounds: {
          defaultSoundId: 'none',
        },
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-silent',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Review branch',
      'The branch is ready to review.',
      { sessionId: 'session-silent' },
      { sound: null, priority: 'high', androidSoundId: 'none' },
    );
  });

  it('maps bundled policy sounds to Expo notification filenames and Android sound channels', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        sounds: {
          defaultSoundId: 'soft',
          eventSoundIds: {
            permission_request: 'urgent',
          },
        },
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'permission_request',
        sessionId: 'session-sound',
        requestId: 'request-1',
        sessionTitle: 'Review branch',
        toolName: 'Bash',
        toolDetails: 'Run git status',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ sessionId: 'session-sound', kind: 'permission' }),
      { sound: 'happier_urgent.wav', priority: 'high', androidSoundId: 'urgent' },
    );
  });

  it('does not pass unsupported custom sound ids to Expo push senders', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        sounds: {
          defaultSoundId: 'custom:imported-tone',
        },
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'permission_request',
        sessionId: 'session-custom-sound',
        sessionTitle: 'Review branch',
        requestId: 'request-custom-sound',
        toolName: 'Bash',
        toolDetails: 'Run git status',
      },
    });

    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Review branch',
      expect.stringContaining('Bash'),
      expect.objectContaining({ sessionId: 'session-custom-sound', kind: 'permission' }),
      { sound: null, priority: 'high', androidSoundId: 'none' },
    );
  });

  it('sends a Live Activity remote update as its own delivery channel', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const sendLiveActivityRemoteUpdateAsync = vi.fn(async (_request: LiveActivityRemoteUpdateRequestV1) => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        liveActivityRemoteUpdates: {
          enabled: true,
          preferredMode: 'direct_apns',
          defaultStaleAfterSeconds: 900,
        },
      },
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      liveActivityRemoteSender: {
        serverId: 'server-a',
        sendLiveActivityRemoteUpdateAsync,
      },
      nowMs: () => Date.parse('2026-05-04T12:00:00.000Z'),
      event: {
        topic: 'ready',
        sessionId: 'session-live',
        sessionTitle: 'Review branch',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'The branch is ready to review.',
      },
    });

    expect(result).toEqual({ attemptedChannels: 2, deliveredChannels: 2 });
    expect(sendToAllDevicesAsync).toHaveBeenCalledWith(
      'Review branch',
      'The branch is ready to review.',
      { sessionId: 'session-live' },
      { sound: 'happier_soft.wav', priority: 'high', androidSoundId: 'soft' },
    );
    expect(sendLiveActivityRemoteUpdateAsync).toHaveBeenCalledTimes(1);
    const request = sendLiveActivityRemoteUpdateAsync.mock.calls[0]?.[0];
    expect(LiveActivityRemoteUpdateRequestV1Schema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({
      v: 1,
      createdAt: Date.parse('2026-05-04T12:00:00.000Z'),
      transportMode: 'direct_apns',
      event: 'update',
      activityKey: {
        serverId: 'server-a',
        sessionId: 'session-live',
        activityName: 'HappierFocusLiveActivity',
      },
      contentState: {
        version: 1,
        generatedAt: Date.parse('2026-05-04T12:00:00.000Z'),
        staleAt: Date.parse('2026-05-04T12:15:00.000Z'),
        sessionId: 'session-live',
        title: 'Review branch',
        previewText: 'The branch is ready to review.',
        attentionState: 'unread',
      },
    });
    expect(request).not.toHaveProperty('interruptiveAlert');
  });

  it('omits Live Activity preview text when policy allows title only', async () => {
    const sendLiveActivityRemoteUpdateAsync = vi.fn(async (_request: LiveActivityRemoteUpdateRequestV1) => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: {
          expo_push: { enabled: false },
        },
        privacy: {
          defaultPreviewBehavior: 'include_preview',
          surfaces: {
            live_activity: 'title_only',
          },
        },
        liveActivityRemoteUpdates: {
          enabled: true,
          preferredMode: 'direct_apns',
        },
      },
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      liveActivityRemoteSender: {
        serverId: 'server-a',
        sendLiveActivityRemoteUpdateAsync,
      },
      nowMs: () => Date.parse('2026-05-04T12:00:00.000Z'),
      event: {
        topic: 'ready',
        sessionId: 'session-private',
        sessionTitle: 'Private project',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'secret transcript detail',
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    const request = sendLiveActivityRemoteUpdateAsync.mock.calls[0]?.[0];
    expect(request?.contentState?.previewText).toBeNull();
    expect(request?.contentState?.title).toBe('Private project');
    expect(JSON.stringify(request)).not.toContain('secret transcript detail');
  });

  it('filters title-only permission details from Live Activity state and alert intent', async () => {
    const sendLiveActivityRemoteUpdateAsync = vi.fn(async (_request: LiveActivityRemoteUpdateRequestV1) => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: {
          expo_push: { enabled: false },
          live_activity: { events: { permission_request: { previewBehavior: 'title_only' } } },
        },
        privacy: {
          defaultPreviewBehavior: 'include_preview',
          surfaces: {
            live_activity: 'title_only',
          },
        },
        liveActivityRemoteUpdates: {
          enabled: true,
          preferredMode: 'direct_apns',
        },
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      liveActivityRemoteSender: {
        serverId: 'server-a',
        sendLiveActivityRemoteUpdateAsync,
      },
      nowMs: () => Date.parse('2026-05-04T12:00:00.000Z'),
      event: {
        topic: 'permission_request',
        sessionId: 'session-private-permission',
        sessionTitle: 'Private project',
        requestId: 'permission-private',
        toolName: 'Bash',
        toolDetails: 'Run command containing private-token',
      },
    });

    const request = sendLiveActivityRemoteUpdateAsync.mock.calls[0]?.[0];
    expect(request?.contentState?.title).toBe('Private project');
    expect(request?.contentState?.subtitle).toBeNull();
    expect(request?.contentState?.previewText).toBeNull();
    expect(request?.contentState?.statusText).toBe('Permission required');
    expect(request?.event === 'update' ? request.interruptiveAlert?.body : undefined).toBe('Permission required');
    expect(JSON.stringify(request)).not.toContain('Bash');
    expect(JSON.stringify(request)).not.toContain('private-token');
  });

  it('keeps quiet Live Activity freshness updates non-interruptive', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const sendLiveActivityRemoteUpdateAsync = vi.fn(async (_request: LiveActivityRemoteUpdateRequestV1) => {});
    const settings = accountSettingsParse({
      attentionDeliveryPolicyV1: {
        v: 1,
        channels: { live_activity: { events: { permission_request: { previewBehavior: 'include_preview' } } } },
        quietHours: {
          enabled: true,
          timezone: 'UTC',
          windows: [{ startLocalTime: '00:00', endLocalTime: '23:59' }],
        },
        liveActivityRemoteUpdates: {
          enabled: true,
          preferredMode: 'direct_apns',
          quietHoursBehavior: 'silent',
        },
      },
    });

    const result = await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      liveActivityRemoteSender: {
        serverId: 'server-a',
        sendLiveActivityRemoteUpdateAsync,
      },
      nowMs: () => Date.parse('2026-05-04T12:00:00.000Z'),
      event: {
        topic: 'permission_request',
        sessionId: 'session-quiet-live',
        sessionTitle: 'Production fix',
        requestId: 'permission-1',
        toolName: 'Bash',
        toolInput: { command: 'npm test && echo secret-token' },
      },
    });

    expect(result).toEqual({ attemptedChannels: 1, deliveredChannels: 1 });
    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    const request = sendLiveActivityRemoteUpdateAsync.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty('interruptiveAlert');
    expect(request?.contentState?.attentionState).toBe('permission_required');
    expect(request?.contentState?.previewText).toContain('npm test && echo secret-token');
  });

  it('dispatches only to enabled explicit channels', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      notificationChannelsV1: [
        {
          v: 1,
          id: 'expo-disabled',
          kind: 'expo_push',
          enabled: false,
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: true,
        },
        {
          v: 1,
          id: 'webhook-primary',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/happier',
          signingSecret: {
            _isSecretValue: true,
            value: 'webhook-secret',
          },
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: false,
        },
      ],
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-2',
        sessionTitle: 'Deploy fix',
        waitingForCommandLabel: 'Gemini',
        assistantPreviewText: 'Deployment is complete.',
      },
    });

    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(1);
    const request = webhookRequests[0];
    expect(request?.url).toBe('https://hooks.example.test/happier');
    expect(request?.method).toBe('POST');
    expect(request?.validatedAddresses).toEqual(['93.184.216.34']);
    expect(request?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-happier-signature-256': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    });
    const payload = webhookRequestBody(request);
    expect(payload.content).toEqual({
      title: 'Deploy fix',
      body: 'Gemini is waiting for your command',
    });
  });

  it('omits request previews when the webhook explicitly disables them', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settings = accountSettingsParse({
      notificationChannelsV1: [
        {
          v: 1,
          id: 'webhook-primary',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/happier',
          signingSecret: {
            _isSecretValue: true,
            value: 'webhook-secret',
          },
          topics: {
            ready: false,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: false,
          requestIncludeMessageText: false,
        },
      ],
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'permission_request',
        sessionId: 'session-3',
        sessionTitle: 'Fix prod issue',
        requestId: 'request-9',
        toolName: 'Bash',
        toolInput: { command: 'git status --short && echo secret-token' },
      },
    });

    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(1);
    const payload = webhookRequestBody(webhookRequests[0]);
    expect(webhookRequests[0]?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-happier-signature-256': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    });
    expect(payload.request).toMatchObject({
      requestId: 'request-9',
      kind: 'permission',
      toolName: 'Bash',
      toolDetails: null,
    });
    expect(JSON.stringify(payload)).not.toContain('secret-token');
  });

  it('decrypts encrypted webhook signing secrets when settings secret read keys are provided', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {});
    const settingsSecretsKey = deriveSettingsSecretsKeyV1(new Uint8Array(32).fill(7));
    const settings = accountSettingsParse({
      notificationChannelsV1: [
        {
          v: 1,
          id: 'webhook-primary',
          kind: 'webhook',
          enabled: true,
          url: 'https://hooks.example.test/happier',
          signingSecret: {
            _isSecretValue: true,
            encryptedValue: encryptSecretStringV1(
              'sealed-webhook-secret',
              settingsSecretsKey,
              (length) => new Uint8Array(length).fill(3),
            ),
          },
          topics: {
            ready: true,
            permissionRequest: true,
            userActionRequest: true,
          },
          readyIncludeMessageText: false,
        },
      ],
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      settingsSecretsReadKeys: [settingsSecretsKey],
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-4',
        sessionTitle: 'Ship release',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'Release branch is ready.',
      },
    });

    expect(sendToAllDevicesAsync).not.toHaveBeenCalled();
    expect(webhookRequests).toHaveLength(1);
    expect(webhookRequests[0]?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-happier-signature-256': expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
    });
  });

  it('redacts transport error details before logging failed notification dispatches', async () => {
    const sendToAllDevicesAsync = vi.fn(async () => {
      throw {
        isAxiosError: true,
        name: 'AxiosError',
        message: 'Request failed with status code 401',
        config: {
          method: 'post',
          url: 'https://api.example.test/v1/push-tokens?token=query-secret',
          headers: { Authorization: 'Bearer authorization-secret' },
          data: { body: 'private notification body' },
        },
        response: { status: 401 },
      };
    });
    const settings = accountSettingsParse({
      notificationsSettingsV1: {
        v: 1,
        pushEnabled: true,
        ready: true,
        readyIncludeMessageText: true,
      },
    });

    await dispatchActivityNotificationAsync({
      settings,
      webhookNetwork,
      expoPushSender: { sendToAllDevicesAsync },
      event: {
        topic: 'ready',
        sessionId: 'session-log-redaction',
        sessionTitle: 'Private title',
        waitingForCommandLabel: 'Codex',
        assistantPreviewText: 'private notification body',
      },
    });

    expect(logger.debug).toHaveBeenCalledWith(
      '[activityNotifications] Failed to dispatch outbound notification',
      expect.objectContaining({
        name: 'AxiosError',
        status: 401,
        method: 'POST',
        url: 'https://api.example.test/v1/push-tokens',
      }),
    );
    const logged = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('authorization-secret');
    expect(logged).not.toContain('query-secret');
    expect(logged).not.toContain('private notification body');
  });
});
