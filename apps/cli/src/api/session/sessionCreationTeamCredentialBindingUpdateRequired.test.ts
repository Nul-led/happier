import { describe, expect, it } from 'vitest';

import {
  readSessionTeamCredentialBindingUpdateRequiredError,
  SessionTeamCredentialBindingUpdateRequiredError,
} from './sessionCreationInitialAccess';

describe('readSessionTeamCredentialBindingUpdateRequiredError', () => {
  it('maps only the canonical credential-bound refusal to a typed no-effect downgrade', () => {
    const refusal = {
      error: 'update_required',
      kind: 'update_required',
      operation: 'session.spawn_new',
      component: 'server',
      reason: 'session_team_credential_binding_update_required',
    };
    const mapped = readSessionTeamCredentialBindingUpdateRequiredError(refusal);
    expect(mapped).toBeInstanceOf(SessionTeamCredentialBindingUpdateRequiredError);
    // The transport `error` discriminator is envelope framing; details carry the
    // strict protocol-owned OperationUpdateRequiredV1 body only.
    expect(mapped?.details).toEqual({
      kind: 'update_required',
      operation: 'session.spawn_new',
      component: 'server',
      reason: 'session_team_credential_binding_update_required',
    });
    expect('error' in (mapped?.details ?? {})).toBe(false);
    expect(mapped?.retryable).toBe(false);
  });

  it('rejects neighboring update reasons and generic transport failures as indeterminate', () => {
    expect(readSessionTeamCredentialBindingUpdateRequiredError({
      error: 'update_required',
      kind: 'update_required',
      operation: 'session.spawn_new',
      component: 'server',
      reason: 'session_initial_access_update_required',
    })).toBeNull();
    expect(readSessionTeamCredentialBindingUpdateRequiredError({ error: 'update_required' })).toBeNull();
    expect(readSessionTeamCredentialBindingUpdateRequiredError({ error: 'internal' })).toBeNull();
    expect(readSessionTeamCredentialBindingUpdateRequiredError(null)).toBeNull();
  });
});
