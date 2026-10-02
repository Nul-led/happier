import { describe, expect, it } from 'vitest';

import { ApprovalRequestV2Schema, type ApprovalRequestV2 } from './approvalRequestV1.js';
import { decideApprovalRequestTransition } from './approvalRequestTransition.js';

const target = { kind: 'window', displayId: ':73', pid: 42, windowId: 123 } as const;

function openRequest(): ApprovalRequestV2 {
  return ApprovalRequestV2Schema.parse({
    v: 2, status: 'open', createdAtMs: 1, updatedAtMs: 1,
    createdBy: { surface: 'agent', sessionId: 'session' }, requestedSurface: 'agent',
    actionId: 'computer.target.select',
    actionArgs: { machineId: 'machine', target, access: 'use', requestedTarget: 'Editor' },
    summary: 'Choose Editor',
    executionOriginV1: {
      v: 1, authority: 'account_automation', surface: 'agent', caller: { kind: 'host' },
      serverId: 'home', sessionId: 'session', actionId: 'computer.target.select', requestId: 'request',
    },
  });
}

describe('computer selection approval transition', () => {
  it.each([
    { target: { ...target, windowId: 456 }, access: 'use' },
    { target, access: 'see' },
  ])('admits only the human target/access edit at open -> approved: %j', selection => {
    const existing = openRequest();
    const approved: ApprovalRequestV2 = {
      ...existing, status: 'approved', updatedAtMs: 2,
      actionArgs: { ...existing.actionArgs as object, ...selection },
      decision: { kind: 'approve', decidedAtMs: 2, authority: 'present_user' },
    };
    expect(decideApprovalRequestTransition(existing, approved)).toEqual({ ok: true, changed: true });
    expect(decideApprovalRequestTransition(existing, {
      ...approved, decision: { kind: 'approve', decidedAtMs: 2 },
    })).toMatchObject({ ok: false, errorCode: 'subject_mismatch' });
    for (const edit of [
      { machineId: 'foreign' }, { requestedTarget: 'Forged suggestion' }, { access: 'all' },
    ]) {
      expect(decideApprovalRequestTransition(existing, {
        ...approved, actionArgs: { ...approved.actionArgs as object, ...edit },
      })).toMatchObject({ ok: false, errorCode: 'subject_mismatch' });
    }
    expect(decideApprovalRequestTransition(approved, {
      ...approved, status: 'executing', updatedAtMs: 3,
      actionArgs: { ...approved.actionArgs as object, target: { ...target, windowId: 789 } },
    })).toMatchObject({ ok: false, errorCode: 'subject_mismatch' });
  });
});
