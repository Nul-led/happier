import { describe, expect, it } from 'vitest';
import { getActionSpec } from './actionSpecs.js';

describe('workflow trigger Action metadata', () => {
  it('classifies scoped trigger removal as danger at the Action metadata owner', () => {
    expect(getActionSpec('session.trigger.remove')).toMatchObject({ safety: 'danger', sideEffectClass: 'danger' });
  });
});
