import { expect, it } from 'vitest';
import { reconcileExternalActionTarget } from './reconcileExternalActionTarget';

it('uses the authenticated envelope Session, never an authored Session selector, for user computer controls', () => {
  const input = { actionId: 'computer.target.select' as const,
    rawInput: { machineId: 'machine', target: { kind: 'window', displayId: ':73', pid: 42, windowId: 7 } },
    target: { kind: 'session' as const, sessionId: 'session' }, currentMachineId: 'machine' };
  expect(reconcileExternalActionTarget(input)).toMatchObject({ kind: 'ready',
    target: input.target, context: { defaultSessionId: 'session' } });
  expect(reconcileExternalActionTarget({ ...input, currentMachineId: 'other' })).toMatchObject({ kind: 'rejected' });
});
