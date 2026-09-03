import { describe, expect, it } from 'vitest';

import {
  WebhookNotificationChannelV1Schema,
  type WebhookNotificationChannelV1,
} from '@happier-dev/protocol';

import type {
  PinnedHttpStreamRequest,
  PinnedHttpStreamResponse,
} from '@/network/pinnedHttp';

import type { ActivityNotificationEvent } from './activityNotificationEvent';
import { sendWebhookActivityNotificationAsync } from './sendWebhookActivityNotification';

const READY_EVENT: ActivityNotificationEvent = {
  topic: 'ready',
  sessionId: 'session-1',
  sessionTitle: 'Review branch',
  waitingForCommandLabel: 'Codex',
  assistantPreviewText: 'The branch is ready to review.',
};

function webhookChannel(url: string): WebhookNotificationChannelV1 {
  return WebhookNotificationChannelV1Schema.parse({
    v: 1,
    id: 'webhook-primary',
    kind: 'webhook',
    enabled: true,
    url,
    signingSecret: { _isSecretValue: true, value: 'webhook-secret' },
    topics: { ready: true, permissionRequest: true, userActionRequest: true },
    readyIncludeMessageText: true,
  });
}

type StubbedResponse = Readonly<{
  status: number;
  headers?: Readonly<Record<string, string | undefined>>;
}>;

function createRecordingTransport(...responses: readonly StubbedResponse[]) {
  const requests: PinnedHttpStreamRequest[] = [];
  let index = 0;
  const openPinnedStream = async (request: PinnedHttpStreamRequest): Promise<PinnedHttpStreamResponse> => {
    requests.push(request);
    const stubbed = responses[Math.min(index, responses.length - 1)] ?? { status: 202 };
    index += 1;
    return Object.freeze({
      status: stubbed.status,
      headers: stubbed.headers ?? {},
      contentLength: 0,
      read: async () => null,
      cancel: () => undefined,
    });
  };
  return { requests, openPinnedStream };
}

function resolvesTo(...addresses: readonly string[]) {
  return async () => addresses;
}

describe('sendWebhookActivityNotificationAsync', () => {
  it('delivers a signed payload to a public HTTPS destination over the pinned transport', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      nowMs: () => 1_700_000_000_000,
      network: {
        resolveAddresses: resolvesTo('93.184.216.34'),
        openPinnedStream: transport.openPinnedStream,
      },
    });

    expect(transport.requests).toHaveLength(1);
    const request = transport.requests[0]!;
    expect(request.url).toBe('https://hooks.example.test/happier');
    expect(request.method).toBe('POST');
    // The admitted answer, not a second resolution, decides the socket peer.
    expect(request.validatedAddresses).toEqual(['93.184.216.34']);
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.headers['x-happier-signature-256']).toMatch(/^sha256=[a-f0-9]{64}$/);
    const payload = JSON.parse(Buffer.from(request.body ?? new Uint8Array()).toString('utf8'));
    expect(payload.topic).toBe('ready');
    expect(payload.content).toEqual({
      title: 'Review branch',
      body: 'The branch is ready to review.',
    });
  });

  it('refuses a public-looking host whose DNS answers are loopback', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('127.0.0.1'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination resolved to a non-public address');

    expect(transport.requests).toHaveLength(0);
  });

  it('refuses a host that resolves into a private or link-local range', async () => {
    const transport = createRecordingTransport({ status: 202 });

    for (const address of ['10.1.2.3', '169.254.1.1', 'fd00::1']) {
      await expect(sendWebhookActivityNotificationAsync({
        channel: webhookChannel('https://hooks.example.test/happier'),
        event: READY_EVENT,
        network: {
          resolveAddresses: resolvesTo(address),
          openPinnedStream: transport.openPinnedStream,
        },
      })).rejects.toThrow('Webhook notification destination resolved to a non-public address');
    }

    expect(transport.requests).toHaveLength(0);
  });

  it('refuses a host that resolves onto a cloud metadata address', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('169.254.169.254'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination rejected (unsafe_address)');

    expect(transport.requests).toHaveLength(0);
  });

  it('refuses a mixed answer set that pairs a public address with a private one', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('93.184.216.34', '192.168.1.10'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination resolved to a non-public address');

    expect(transport.requests).toHaveLength(0);
  });

  it('refuses plaintext HTTP to a public destination', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('http://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('93.184.216.34'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination must use HTTPS');

    expect(transport.requests).toHaveLength(0);
  });

  it('refuses a cloud metadata destination', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('http://169.254.169.254/latest/meta-data/'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('169.254.169.254'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination rejected (unsafe_address)');

    expect(transport.requests).toHaveLength(0);
  });

  it('never follows a redirect toward a private destination', async () => {
    const transport = createRecordingTransport({
      status: 302,
      headers: { location: 'http://127.0.0.1:9/internal' },
    });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('93.184.216.34'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification destination returned a redirect');

    // The refusal must be observable as "no second hop", not merely as a thrown error.
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe('https://hooks.example.test/happier');
  });

  it('reports a non-success status from the destination', async () => {
    const transport = createRecordingTransport({ status: 500 });

    await expect(sendWebhookActivityNotificationAsync({
      channel: webhookChannel('https://hooks.example.test/happier'),
      event: READY_EVENT,
      network: {
        resolveAddresses: resolvesTo('93.184.216.34'),
        openPinnedStream: transport.openPinnedStream,
      },
    })).rejects.toThrow('Webhook notification failed with status 500');
  });

  it('keeps delivering to a destination whose configured URL itself names a loopback address', async () => {
    const transport = createRecordingTransport({ status: 202 });

    await sendWebhookActivityNotificationAsync({
      channel: webhookChannel('http://127.0.0.1:8123/api/webhook/happier'),
      event: READY_EVENT,
      network: { openPinnedStream: transport.openPinnedStream },
    });

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.validatedAddresses).toEqual(['127.0.0.1']);
  });
});
