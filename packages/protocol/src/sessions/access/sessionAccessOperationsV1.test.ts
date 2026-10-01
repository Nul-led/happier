import { describe, expect, it } from 'vitest';
import * as access from './index.js';

const capabilities = {
  readTranscript: true, submitAgentInput: false, editSessionRecords: false,
  approveRuntimePermissions: false, manageAccess: false, managePermissionDelegation: false,
  managePublicLink: false, archiveSession: false, renameSession: false,
  assignResponsibility: false, stopSession: false, deleteSession: false,
};
const owner = {
  kind: 'account', accountId: 'owner', firstName: null, lastName: null,
  username: 'owner', avatarUrl: null,
};
const grantRow = {
  grant: { subject: { kind: 'team', teamId: 'team' }, accessLevel: 'view', canApprovePermissions: false, requiredByTeamPolicy: true },
  principal: { kind: 'team', teamId: 'team', name: 'Team' },
  allowedTransitions: { accessLevels: ['view', 'edit', 'admin'], canChangePermissionDelegation: false, canRemove: false, reason: 'session_access_team_policy_required' },
};

describe('Session access operation contracts', () => {
  it('carries the same strict credential condition through logical and physical Team grants', () => {
    const request = {
      sessionId: 'session', subject: { kind: 'team', teamId: 'team' },
      accessLevel: 'edit', canApprovePermissions: false,
      requiredTeamCredential: { resourceId: 'resource', expectedResourceRevision: 7, deliveryMode: 'brokered' },
    };
    for (const schema of [access.SessionAccessGrantSetActionInputV1Schema, access.SetSessionAccessGrantRequestV1Schema]) {
      expect(schema.parse(request)).toEqual(request);
      expect(schema.safeParse({ ...request, requiredTeamCredential: { ...request.requiredTeamCredential, trusted: true } }).success).toBe(false);
      expect(schema.safeParse({ ...request, requiredTeamCredential: { ...request.requiredTeamCredential, deliveryMode: 'both' } }).success).toBe(false);
    }
  });

  it('distinguishes redacted inspection from a complete roster and rejects topology in inspection', () => {
    const inspection = {
      visibility: 'self', owner, primaryTeamId: null, grants: [],
      effectiveAccess: { v: 1, level: 'view', sources: [{ kind: 'team', teamId: 'team', requiredByTeamPolicy: true }], capabilities },
    };
    expect(access.SessionAccessGrantsListResponseV1Schema?.safeParse(inspection).success).toBe(true);
    expect(access.SessionAccessGrantsListResponseV1Schema.safeParse({ ...inspection, grants: [grantRow] }).success).toBe(false);
    expect(access.SessionAccessGrantsListResponseV1Schema.safeParse({
      ...inspection, visibility: 'complete', grants: [grantRow],
      effectiveAccess: { ...inspection.effectiveAccess, level: 'admin', capabilities: { ...capabilities, manageAccess: true } },
    }).success).toBe(true);
    expect(access.SessionAccessGrantsListResponseV1Schema.safeParse({
      ...inspection, effectiveAccess: { ...inspection.effectiveAccess, capabilities: { ...capabilities, impersonateOwner: true } },
    }).success).toBe(false);
  });

  it('requires complete desired state and subject identity rather than a persistence grant ID', () => {
    const request = { sessionId: 'session', subject: { kind: 'account', accountId: 'recipient' }, accessLevel: 'edit', canApprovePermissions: false };
    expect(access.SetSessionAccessGrantRequestV1Schema?.safeParse(request).success).toBe(true);
    expect(access.SetSessionAccessGrantRequestV1Schema.safeParse({ sessionId: 'session', subject: request.subject, accessLevel: 'edit' }).success).toBe(false);
    expect(access.SetSessionAccessGrantRequestV1Schema.safeParse({ ...request, effectiveAt: 123 }).success).toBe(false);
    expect(access.RemoveSessionAccessGrantRequestV1Schema.safeParse({ sessionId: 'session', grantId: 'db-id' }).success).toBe(false);
    expect(access.RemoveSessionAccessGrantResponseV1Schema.safeParse({ changed: false, subject: request.subject }).success).toBe(true);
  });

  it.each([
    'session_access_authentication_required',
    'session_access_authentication_unavailable',
    'session_access_external_sharing_requires_team_admin',
    'session_access_external_sharing_disabled',
    'session_access_sharing_unavailable',
    'session_access_invalid_recipient_envelope',
    'session_responsibility_assignee_unavailable',
    'invalid_cursor',
    'invalid_request',
    'data_key_not_required',
    'recipient_envelope_required',
    'recipient_key_unavailable',
  ] as const)('retains the mounted Session-access family failure code %s', (code) => {
    expect(access.SessionAccessErrorCodeV1Schema.safeParse(code)).toEqual(
      expect.objectContaining({ success: true }),
    );
  });
});

describe('projectSessionAccessGrantTransitionsV1', () => {
  const edit = { accessLevel: 'edit' as const, canApprovePermissions: false };

  it('treats a higher level, a newly gained delegation flag, or a first grant as an increase', () => {
    expect(access.isSessionAccessGrantIncreaseV1(null, edit)).toBe(true);
    expect(access.isSessionAccessGrantIncreaseV1({ accessLevel: 'view', canApprovePermissions: false }, edit)).toBe(true);
    expect(access.isSessionAccessGrantIncreaseV1(edit, { ...edit, canApprovePermissions: true })).toBe(true);
    expect(access.isSessionAccessGrantIncreaseV1(edit, edit)).toBe(false);
    expect(access.isSessionAccessGrantIncreaseV1({ ...edit, canApprovePermissions: true }, { accessLevel: 'view', canApprovePermissions: false })).toBe(false);
  });

  it('closes only increases for an external subject under a restrictive primary-Team policy', () => {
    expect(access.projectSessionAccessGrantTransitionsV1({
      current: edit, canDelegate: true, requiredByTeamPolicy: false,
      externalSharing: 'session_access_external_sharing_disabled',
    })).toEqual({
      accessLevels: ['view', 'edit'], canChangePermissionDelegation: false, canRemove: true,
      reason: 'session_access_external_sharing_disabled',
    });
    // Delegation already held can still be withdrawn: that is not an increase.
    expect(access.projectSessionAccessGrantTransitionsV1({
      current: { ...edit, canApprovePermissions: true }, canDelegate: true, requiredByTeamPolicy: false,
      externalSharing: 'session_access_external_sharing_requires_team_admin',
    })).toMatchObject({ accessLevels: ['view', 'edit'], canChangePermissionDelegation: true, canRemove: true });
  });

  it('keeps the required-floor and eligibility rules the write path enforces', () => {
    expect(access.projectSessionAccessGrantTransitionsV1({ current: edit, canDelegate: true, requiredByTeamPolicy: true }))
      .toMatchObject({ accessLevels: ['edit', 'admin'], canRemove: false, reason: 'session_access_team_policy_required' });
    // An ineligible subject offers no change, but the writer still admits the
    // withdrawal of a retained grant, so removal stays available and only a
    // removal-mode refusal takes it away.
    expect(access.projectSessionAccessGrantTransitionsV1({
      current: edit, canDelegate: true, requiredByTeamPolicy: false, ineligible: 'session_access_subject_ineligible',
    })).toEqual({ accessLevels: [], canChangePermissionDelegation: false, canRemove: true, reason: 'session_access_subject_ineligible' });
    expect(access.projectSessionAccessGrantTransitionsV1({
      current: edit,
      canDelegate: true,
      requiredByTeamPolicy: false,
      ineligible: 'session_access_owner_grant_invalid',
      removalIneligible: 'session_access_owner_grant_invalid',
    })).toEqual({ accessLevels: [], canChangePermissionDelegation: false, canRemove: false, reason: 'session_access_owner_grant_invalid' });
    // An actor without delegation authority cannot offer the transition that would
    // create it: the delegation flag. A level change alone creates no delegation.
    expect(access.projectSessionAccessGrantTransitionsV1({ current: edit, canDelegate: false, requiredByTeamPolicy: false }))
      .toMatchObject({ accessLevels: ['view', 'edit', 'admin'], canChangePermissionDelegation: false, canRemove: true });
    expect(access.projectSessionAccessGrantTransitionsV1({ current: { ...edit, canApprovePermissions: true }, canDelegate: false, requiredByTeamPolicy: false }))
      .toMatchObject({ canChangePermissionDelegation: true });
  });
});
