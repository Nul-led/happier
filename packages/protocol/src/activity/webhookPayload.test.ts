import { describe, expect, it } from 'vitest';

import { ActivityWebhookPayloadV1Schema, buildActivityWebhookPayload } from './webhookPayload.js';

describe('buildActivityWebhookPayload', () => {
  it('builds a ready webhook payload with session navigation', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 123,
      topic: 'ready',
      content: {
        title: 'Review branch',
        body: 'The branch is ready to review.',
      },
      session: {
        sessionId: 'session-1',
        title: 'Review branch',
      },
      metadata: {
        providerLabel: 'Codex',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.navigation).toEqual({ sessionId: 'session-1' });
  });

  it('builds a request webhook payload without raw input fields', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 456,
      topic: 'permission_request',
      content: {
        title: 'Deploy fix',
        body: 'Claude asks permission to use Bash\nCommand: git',
      },
      session: {
        sessionId: 'session-2',
        title: 'Deploy fix',
      },
      request: {
        requestId: 'request-1',
        kind: 'permission',
        toolName: 'Bash',
        toolDetails: 'Command: git',
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    expect(payload.navigation).toEqual({ sessionId: 'session-2', requestId: 'request-1' });
    expect(JSON.stringify(payload)).not.toContain('toolInput');
  });

  it('accepts connected-service quota and account-switch webhook topics', () => {
    for (const topic of [
      'connected_service_account_switch',
      'connected_service_credential_health',
      'connected_service_quota_blocked',
      'connected_service_quota_recovered',
    ] as const) {
      const payload = buildActivityWebhookPayload({
        channelId: 'webhook-primary',
        createdAt: 789,
        topic,
        content: {
          title: 'Provider account updated',
          body: 'A provider account state changed.',
        },
        session: {
          sessionId: 'session-3',
          title: 'Quota recovery',
        },
      });

      expect(ActivityWebhookPayloadV1Schema.parse(payload).topic).toBe(topic);
    }
  });

  it('builds a strict workflow Run update with exact Run navigation and no private content', () => {
    const payload = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 790,
      topic: 'workflow_run_update',
      content: {
        title: 'Workflow needs attention',
        body: 'A workflow Run was interrupted and needs attention.',
      },
      workflowRun: {
        runId: 'run-42',
        updateKind: 'interrupted',
        reason: { code: 'approval_required' },
      },
    });

    expect(ActivityWebhookPayloadV1Schema.parse(payload)).toEqual(payload);
    if (payload.topic !== 'workflow_run_update') throw new Error('Expected workflow webhook payload');
    expect(payload).toEqual({
      v: 1,
      channelId: 'webhook-primary',
      createdAt: 790,
      topic: 'workflow_run_update',
      content: {
        title: 'Workflow needs attention',
        body: 'A workflow Run was interrupted and needs attention.',
      },
      workflowRun: {
        runId: 'run-42',
        updateKind: 'interrupted',
        reason: { code: 'approval_required' },
      },
      navigation: { runId: 'run-42' },
    });
    expect(ActivityWebhookPayloadV1Schema.safeParse({
      ...payload,
      workflowRun: { ...payload.workflowRun, prompt: 'private prompt' },
    }).success).toBe(false);
    expect(ActivityWebhookPayloadV1Schema.safeParse({
      ...payload,
      workflowRun: {
        ...payload.workflowRun,
        reason: { code: 'approval_required', message: 'private diagnostic' },
      },
    }).success).toBe(false);
    expect(ActivityWebhookPayloadV1Schema.safeParse({
      ...payload,
      workflowRun: { ...payload.workflowRun, updateKind: 'invented' },
    }).success).toBe(false);
  });

  it('rejects a workflow topic without the workflow arm', () => {
    const ordinary = buildActivityWebhookPayload({
      channelId: 'webhook-primary',
      createdAt: 791,
      topic: 'ready',
      content: { title: 'Ready', body: 'Ready.' },
      session: { sessionId: 'session-1' },
    });

    expect(ActivityWebhookPayloadV1Schema.safeParse({
      ...ordinary,
      topic: 'workflow_run_update',
      navigation: { runId: 'run-42' },
    }).success).toBe(false);
  });
});
