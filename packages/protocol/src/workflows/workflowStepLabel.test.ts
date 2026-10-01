import { describe, expect, it } from 'vitest';

import type { WorkflowStep } from './workflowV1.js';
import { formatWorkflowStepSessionTitle, workflowStepPromptLabel } from './workflowStepLabel.js';

const step: WorkflowStep = {
  kind: 'step', id: 'work', document: { text: '', references: [], attachments: [] },
  input: [], result: { kind: 'text' },
};

describe('workflow step label', () => {
  it('uses the same bounded prompt label for UI and one-based Session titles', () => {
    const named = { ...step, document: { ...step.document, text: `\n ${'A'.repeat(61)}\nDetails` } };
    const label = `${'A'.repeat(60)}…`;
    expect(workflowStepPromptLabel(named)).toBe(label);
    expect(formatWorkflowStepSessionTitle({ step: named, memberOrdinal: '2' })).toBe(`3 · ${label}`);
  });

  it('leaves an unnamed step untitled so Session defaults apply', () => {
    const unnamed = { ...step, document: { ...step.document, text: ' \r\n  ' } };
    expect(workflowStepPromptLabel(unnamed)).toBeNull();
    expect(formatWorkflowStepSessionTitle({ step: unnamed, memberOrdinal: '0' })).toBeNull();
  });
});
