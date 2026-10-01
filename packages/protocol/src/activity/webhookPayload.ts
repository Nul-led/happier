import { z } from 'zod';

import { WorkflowRunIdV1Schema } from '../workflows/workflowIdsV1.js';

export const ActivityWebhookTopicSchema = z.enum([
  'ready',
  'permission_request',
  'user_action_request',
  'connected_service_account_switch',
  'connected_service_credential_health',
  'connected_service_quota_blocked',
  'connected_service_quota_recovered',
  'workflow_run_update',
  'notify_me',
]);

export type ActivityWebhookTopic = z.infer<typeof ActivityWebhookTopicSchema>;

export const WorkflowRunUpdateKindV1Schema = z.enum([
  'completed',
  'completed_with_failures',
  'failed',
  'outcome_uncertain',
  'paused',
  'interrupted',
  'review_required',
]);
export type WorkflowRunUpdateKindV1 = z.infer<typeof WorkflowRunUpdateKindV1Schema>;

/**
 * Safe outbound reason projection. Only the machine-readable code crosses the
 * notification boundary; private messages and diagnostics remain in Run detail.
 */
export const WorkflowRunUpdateReasonV1Schema = z.object({
  code: z.string().min(1),
}).strict();
export type WorkflowRunUpdateReasonV1 = z.infer<typeof WorkflowRunUpdateReasonV1Schema>;

export const WorkflowRunUpdateNotificationV1Schema = z.object({
  topic: z.literal('workflow_run_update'),
  runId: WorkflowRunIdV1Schema,
  updateKind: WorkflowRunUpdateKindV1Schema,
  reason: WorkflowRunUpdateReasonV1Schema.optional(),
}).strict();
export type WorkflowRunUpdateNotificationV1 = z.infer<typeof WorkflowRunUpdateNotificationV1Schema>;

const ActivityWebhookContentV1Schema = z.object({
  title: z.string(),
  body: z.string(),
});

const WorkflowActivityWebhookContentV1Schema = z.object({
  title: z.string(),
  body: z.string(),
}).strict();

const ActivityWebhookSessionV1Schema = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().nullable().optional(),
});

const ActivityWebhookRequestV1Schema = z.object({
  requestId: z.string().trim().min(1),
  kind: z.enum(['permission', 'user_action']),
  toolName: z.string().trim().min(1),
  toolDetails: z.string().nullable().optional(),
});

const ActivityWebhookOrdinaryTopicSchema = ActivityWebhookTopicSchema.exclude(['workflow_run_update']);

const ActivityWebhookOrdinaryPayloadV1Schema = z.object({
  v: z.literal(1).default(1),
  channelId: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  topic: ActivityWebhookOrdinaryTopicSchema,
  content: ActivityWebhookContentV1Schema,
  session: ActivityWebhookSessionV1Schema.optional(),
  request: ActivityWebhookRequestV1Schema.optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  navigation: z.object({
    sessionId: z.string().trim().min(1).optional(),
    requestId: z.string().trim().min(1).optional(),
    runId: WorkflowRunIdV1Schema.optional(),
  }),
});

export const WorkflowRunUpdateWebhookPayloadV1Schema = z.object({
  v: z.literal(1).default(1),
  channelId: z.string().trim().min(1),
  createdAt: z.number().int().nonnegative(),
  topic: z.literal('workflow_run_update'),
  content: WorkflowActivityWebhookContentV1Schema,
  workflowRun: WorkflowRunUpdateNotificationV1Schema.omit({ topic: true }),
  navigation: z.object({
    runId: WorkflowRunIdV1Schema,
  }).strict(),
}).strict();

export const ActivityWebhookPayloadV1Schema = z.discriminatedUnion('topic', [
  ActivityWebhookOrdinaryPayloadV1Schema,
  WorkflowRunUpdateWebhookPayloadV1Schema,
]);

export type ActivityWebhookPayloadV1 = z.infer<typeof ActivityWebhookPayloadV1Schema>;

export function buildActivityWebhookPayload(params: Readonly<{
  channelId: string;
  createdAt: number;
  topic: ActivityWebhookTopic;
  content: Readonly<{ title: string; body: string }>;
  session?: Readonly<{ sessionId: string; title?: string | null }> | null;
  request?: Readonly<{
    requestId: string;
    kind: 'permission' | 'user_action';
    toolName: string;
    toolDetails?: string | null;
  }> | null;
  workflowRun?: Readonly<{
    runId: string;
    updateKind: WorkflowRunUpdateKindV1;
    reason?: WorkflowRunUpdateReasonV1;
  }> | null;
  metadata?: Readonly<Record<string, unknown>> | undefined;
  notificationOpen?: Readonly<{ kind: 'session'; sessionId: string }> | Readonly<{ kind: 'workflow_run'; runId: string }>;
}>): ActivityWebhookPayloadV1 {
  const common = {
    v: 1,
    channelId: params.channelId,
    createdAt: params.createdAt,
    topic: params.topic,
    content: {
      title: params.content.title,
      body: params.content.body,
    },
  } as const;
  if (params.topic === 'workflow_run_update') {
    return ActivityWebhookPayloadV1Schema.parse({
      ...common,
      workflowRun: params.workflowRun,
      navigation: { runId: params.workflowRun?.runId },
    });
  }
  return ActivityWebhookPayloadV1Schema.parse({
    ...common,
    session: params.session
      ? {
        sessionId: params.session.sessionId,
        title: params.session.title ?? null,
      }
      : undefined,
    request: params.request
      ? {
        requestId: params.request.requestId,
        kind: params.request.kind,
        toolName: params.request.toolName,
        toolDetails: params.request.toolDetails ?? null,
      }
      : undefined,
    metadata: params.metadata,
    navigation: {
      sessionId: params.session?.sessionId,
      requestId: params.request?.requestId,
      ...(params.topic === 'notify_me' && params.notificationOpen?.kind === 'session'
        ? { sessionId: params.notificationOpen.sessionId } : {}),
      ...(params.topic === 'notify_me' && params.notificationOpen?.kind === 'workflow_run'
        ? { runId: params.notificationOpen.runId } : {}),
    },
  });
}
