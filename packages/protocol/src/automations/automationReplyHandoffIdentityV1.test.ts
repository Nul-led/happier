import { describe, expect, it } from 'vitest';

import {
  automationReplyHandoffIdForRunV1,
  isAutomationReplyHandoffIdForRunV1,
  nextAutomationReplyHandoffIdForRunV1,
} from './automationReplyHandoffIdentityV1.js';

const RUN_ID = 'run-1';
const BASE = automationReplyHandoffIdForRunV1(RUN_ID);

describe('Automation reply handoff identity', () => {
  it('derives the next distinct delivery identity from the current one', () => {
    expect(BASE).toBe('automation-reply-handoff:run-1');
    expect(nextAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: BASE }))
      .toBe('automation-reply-handoff:run-1#2');
    expect(nextAutomationReplyHandoffIdForRunV1({
      runId: RUN_ID,
      handoffId: 'automation-reply-handoff:run-1#2',
    })).toBe('automation-reply-handoff:run-1#3');
  });

  it('refuses to derive a delivery identity from a handoff of another Run', () => {
    expect(nextAutomationReplyHandoffIdForRunV1({
      runId: RUN_ID,
      handoffId: automationReplyHandoffIdForRunV1('run-2'),
    })).toBeNull();
    expect(nextAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: null })).toBeNull();
  });

  it.each([
    ['a padded ordinal', `${BASE}#02`],
    ['a zero ordinal', `${BASE}#0`],
    ['a first ordinal that is not the base identity', `${BASE}#1`],
    ['a non-numeric ordinal', `${BASE}#next`],
    ['a foreign run prefix', 'automation-reply-handoff:run-11'],
  ])('does not accept %s as a delivery identity of this Run', (_description, handoffId) => {
    expect(isAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId })).toBe(false);
    expect(nextAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId })).toBeNull();
  });

  it('accepts the frozen admission identity and every authorized successor', () => {
    expect(isAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: BASE })).toBe(true);
    expect(isAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: `${BASE}#2` })).toBe(true);
    expect(isAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: `${BASE}#37` })).toBe(true);
    expect(isAutomationReplyHandoffIdForRunV1({ runId: RUN_ID, handoffId: null })).toBe(false);
  });
});
