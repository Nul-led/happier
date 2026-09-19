import { describe, expect, it } from 'vitest';

import { classifyPrimarySessionRuntimeIssue } from './classifyPrimarySessionRuntimeIssue';

/**
 * The Team-credential broker refuses inside the Agent's own provider call, so
 * the only thing the Session runtime ever sees is the Agent's rendering of the
 * loopback broker's typed 403 body. These cases pin that a refusal reaches the
 * member as a named Team-credential denial with its recovery facts instead of a
 * generic Agent failure.
 */
describe('classifyPrimarySessionRuntimeIssue — Team credential broker refusals', () => {
  it('names an exhausted shared allowance with its metric and reset', () => {
    const issue = classifyPrimarySessionRuntimeIssue({
      cause: 'session_error',
      occurredAt: 1_000,
      error: {
        code: 'acp_turn_failed',
        message: 'API Error: 403 ' + JSON.stringify({
          type: 'error',
          error: {
            type: 'permission_error',
            code: 'team_credential_usage_limit',
            resourceId: 'resource-abc',
            message: "Happier refused this request: the shared credential's total_tokens limit is reached.",
            usageLimit: {
              metric: 'total_tokens',
              remaining: '0',
              resetsAtUtc: '2026-09-15T00:00:00.000Z',
            },
          },
        }),
      },
    });

    expect(issue.source).toBe('team_credential');
    expect(issue.teamCredential).toEqual({
      v: 1,
      resourceId: 'resource-abc',
      reasonCode: 'team_credential_usage_limit',
      usageLimit: { metric: 'total_tokens', remaining: '0', resetsAtUtc: '2026-09-15T00:00:00.000Z' },
    });
  });

  // `reasonCode` is pinned to ProviderBrokerAdmissionFailureCodeV1, so only an
  // admission refusal can be typed today. A request-policy refusal (for example
  // `model_not_allowed`) still reaches the member as a generic Agent failure.
  it('names a structural refusal that carries no allowance facts', () => {
    const issue = classifyPrimarySessionRuntimeIssue({
      cause: 'status_error',
      occurredAt: 2_000,
      error: {
        error: {
          type: 'permission_error',
          code: 'broker_unavailable',
          resourceId: 'resource-xyz',
          message: 'Happier refused this request: broker_unavailable.',
        },
      },
    });

    expect(issue.source).toBe('team_credential');
    expect(issue.teamCredential).toEqual({
      v: 1,
      resourceId: 'resource-xyz',
      reasonCode: 'broker_unavailable',
    });
  });

  it('leaves an ordinary provider permission error alone', () => {
    const issue = classifyPrimarySessionRuntimeIssue({
      cause: 'status_error',
      occurredAt: 3_000,
      error: {
        error: { type: 'permission_error', code: 'not_a_broker_code', message: 'Access denied' },
      },
    });

    expect(issue.source).not.toBe('team_credential');
    expect(issue.teamCredential).toBeUndefined();
  });
});
