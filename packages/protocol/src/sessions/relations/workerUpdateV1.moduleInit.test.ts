import { describe, expect, it } from 'vitest';
import { WorkerUpdateV1Schema, WorkflowRunStateV1Schema } from '../../index.js';

// Enter through the same public barrel as UI consumers, not a preinitialized
// leaf. Collection itself must succeed before this contract can be exercised.
describe('WorkerUpdateV1 module initialization', () => {
  it('loads the Protocol root before validating a workflow worker update', () => {
    const update = {
      v: 1, workerKind: 'workflow_run', workerId: 'workflow-run', ownerState: 'paused',
      wake: 'needs_you', headline: 'Workflow paused', canInspect: false,
    };

    expect(WorkflowRunStateV1Schema.parse(update.ownerState)).toBe('paused');
    expect(WorkerUpdateV1Schema.parse(update)).toEqual(update);
    expect(WorkerUpdateV1Schema.safeParse({ ...update, ownerState: 'published' }).success).toBe(false);
  });
});
