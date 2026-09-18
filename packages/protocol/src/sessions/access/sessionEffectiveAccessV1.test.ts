import { describe, expect, it } from 'vitest';
import {
  gainsSessionAccessDelegationCapabilityV1,
  type SessionAccessGrantCapabilityValueV1,
} from './sessionEffectiveAccessV1.js';

describe('gainsSessionAccessDelegationCapabilityV1', () => {
  const view = { accessLevel: 'view', canApprovePermissions: false } as const;
  const edit = { accessLevel: 'edit', canApprovePermissions: false } as const;
  const delegatedEdit = { accessLevel: 'edit', canApprovePermissions: true } as const;
  const admin = { accessLevel: 'admin', canApprovePermissions: false } as const;
  const delegatedAdmin = { accessLevel: 'admin', canApprovePermissions: true } as const;

  const nextStates = [
    ['view', view],
    ['edit', edit],
    ['delegated edit', delegatedEdit],
    ['admin', admin],
    ['delegated admin', delegatedAdmin],
  ] as const satisfies readonly (readonly [string, SessionAccessGrantCapabilityValueV1])[];
  const states = [
    ['absent', null],
    ...nextStates,
  ] as const satisfies readonly (readonly [string, SessionAccessGrantCapabilityValueV1 | null])[];
  const expectedGains = new Set([
    'absent->delegated edit',
    'absent->delegated admin',
    'view->delegated edit',
    'view->delegated admin',
    'edit->delegated edit',
    'edit->delegated admin',
    'delegated edit->delegated admin',
    'admin->delegated edit',
    'admin->delegated admin',
  ]);

  for (const [previousName, previous] of states) {
    for (const [nextName, next] of nextStates) {
      it(`${previousName} -> ${nextName}`, () => {
        expect(gainsSessionAccessDelegationCapabilityV1(previous, next)).toBe(
          expectedGains.has(`${previousName}->${nextName}`),
        );
      });
    }
  }
});
