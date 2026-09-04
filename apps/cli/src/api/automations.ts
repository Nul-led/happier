import axios from 'axios';
import { z } from 'zod';
import {
  AutomationDefinitionListRequestSchema,
  AutomationDefinitionListResponseSchema,
  AutomationRunStateV3Schema,
  type AutomationDefinitionListResponse,
} from '@happier-dev/protocol';

import {
  createAuthenticationHttpStatusError,
  createHttpStatusError,
  isAuthenticationStatus,
} from '@/api/client/httpStatusError';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';

const AutomationRunSummarySchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  state: AutomationRunStateV3Schema,
}).passthrough();
const RunAutomationNowResponseSchema = z.object({ run: AutomationRunSummarySchema });

export type AutomationRunSummary = z.infer<typeof AutomationRunSummarySchema>;

export async function listAutomationDefinitions(params: Readonly<{
  token: string;
  limit?: number;
  cursor?: string;
}>): Promise<AutomationDefinitionListResponse> {
  const query = AutomationDefinitionListRequestSchema.parse({
    ...(params.limit === undefined ? {} : { limit: params.limit }),
    ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
  });
  const search = new URLSearchParams({ limit: String(query.limit) });
  if (query.cursor) search.set('cursor', query.cursor);
  const response = await axios.get(
    `${resolveServerHttpBaseUrl()}/v3/automations?${search.toString()}`,
    {
      headers: { Authorization: `Bearer ${params.token}` },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (isAuthenticationStatus(response.status)) {
    throw createAuthenticationHttpStatusError(response.status, 'Authentication failed while listing automations');
  }
  if (response.status < 200 || response.status >= 300) {
    const errorCode = typeof response.data?.error === 'string' ? response.data.error : undefined;
    throw createHttpStatusError(
      response.status,
      `Failed to list automations (${response.status})`,
      errorCode,
    );
  }
  return AutomationDefinitionListResponseSchema.parse(response.data);
}

export async function runAutomationNow(params: Readonly<{
  token: string;
  automationId: string;
  idempotencyKey?: string | null;
}>): Promise<AutomationRunSummary> {
  const response = await axios.post(
    `${resolveServerHttpBaseUrl()}/v3/automations/${encodeURIComponent(params.automationId)}/run-now`,
    undefined,
    {
      headers: {
        Authorization: `Bearer ${params.token}`,
        ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
      },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (isAuthenticationStatus(response.status)) {
    throw createAuthenticationHttpStatusError(response.status, 'Authentication failed while running automation');
  }
  if (response.status < 200 || response.status >= 300) {
    const errorCode = typeof response.data?.error === 'string' ? response.data.error : undefined;
    throw createHttpStatusError(
      response.status,
      errorCode === 'automation_disabled' ? 'Automation is paused' : `Failed to run automation (${response.status})`,
      errorCode,
    );
  }
  return RunAutomationNowResponseSchema.parse(response.data).run;
}
