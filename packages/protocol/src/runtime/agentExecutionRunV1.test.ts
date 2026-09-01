import { describe, expect, it } from 'vitest';

import { AGENT_SESSION_RUNTIME_LIMITS_CANDIDATE_V1 as LIMITS } from './agentSessionLimitsV1.js';
import { AgentExecutionRunEventV1Schema } from './agentExecutionRunV1.js';

describe('AgentExecutionRunEventV1Schema', () => {
  it('accepts a bounded terminal event and rejects unknown fields and malformed variants', () => {
    expect(AgentExecutionRunEventV1Schema.safeParse({
      sequence: 1,
      runId: 'run-1',
      emittedAtMs: 2,
      kind: 'run-complete',
    }).success).toBe(true);
    expect(AgentExecutionRunEventV1Schema.safeParse({
      sequence: 1,
      runId: 'run-1',
      emittedAtMs: 2,
      kind: 'run-complete',
      unexpected: true,
    }).success).toBe(false);
    expect(AgentExecutionRunEventV1Schema.safeParse({
      sequence: 1,
      runId: 'run-1',
      emittedAtMs: 2,
      kind: 'output-delta',
      channel: 'assistant',
    }).success).toBe(false);
  });

  it('uses the canonical aggregate event bound without truncating a valid finite report', () => {
    expect(AgentExecutionRunEventV1Schema.safeParse({
      sequence: 1,
      runId: 'run-long-report',
      emittedAtMs: 2,
      kind: 'output-delta',
      channel: 'assistant',
      text: 'x'.repeat((64 * 1_024) + 1),
    }).success).toBe(true);
    expect(AgentExecutionRunEventV1Schema.safeParse({
      sequence: 1,
      runId: 'run-oversized-report',
      emittedAtMs: 2,
      kind: 'output-delta',
      channel: 'assistant',
      text: 'x'.repeat(LIMITS.p0MeasuredCandidates.eventMaxJsonBytes),
    }).success).toBe(false);
  });
});
