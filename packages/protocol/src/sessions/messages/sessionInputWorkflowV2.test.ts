import { describe, expect, it } from 'vitest';

import {
  SessionInputRequestV1Schema,
  SessionInputRequestV2Schema,
  SessionMessageProvenanceV2Schema,
  settleSessionInputRequestV2,
  settleSessionMessageProvenanceV2,
  deriveWorkflowSessionInputLocalIdV2,
  readSessionInputCausalPermissionAuthorityV1,
  withSessionInputAuthority,
  WORKFLOW_INPUT_ADMISSION_UPDATE_REQUIRED,
} from './sessionInputAdmission.js';
import { preservedBoundedNfcString } from '../../strings/preservedBoundedNfcString.js';

describe('Session workflow input admission V2', () => {
  it('keeps Automation V1 and Workflow V2 as distinct closed epochs', () => {
    expect(SessionInputRequestV1Schema.safeParse({
      v: 1, producer: 'automation', automation: { automationId: 'a', runId: 'r' }, permission: {},
    }).success).toBe(true);
    expect(SessionInputRequestV1Schema.safeParse({
      v: 1, producer: 'automation', permission: {},
    }).success).toBe(false);
    expect(SessionInputRequestV2Schema.safeParse({
      v: 2, producer: 'workflow', workflow: { purpose: 'invocation', runId: 'r', invocationRecordId: 'i' }, permission: {},
    }).success).toBe(true);
    expect(SessionInputRequestV2Schema.safeParse({
      v: 2, producer: 'workflow', workflow: { purpose: 'result_delivery', runId: 'r' }, permission: {}, automation: {},
    }).success).toBe(false);
  });

  it('uses distinct provenance arms for invocation and final result delivery', () => {
    expect(SessionMessageProvenanceV2Schema.parse({
      v: 2, kind: 'workflow_invocation', runId: 'r', invocationRecordId: 'i',
    }).kind).toBe('workflow_invocation');
    expect(SessionMessageProvenanceV2Schema.parse({
      v: 2, kind: 'workflow_result_delivery', runId: 'r',
    }).kind).toBe('workflow_result_delivery');
  });

  it('preserves accepted identity bytes and retains the operation-scoped update code', () => {
    const schema = preservedBoundedNfcString(4, 'ids');
    expect(schema.parse(' x ')).toBe(' x ');
    expect(schema.safeParse('e\u0301').success).toBe(false);
    expect(schema.safeParse('     ').success).toBe(false);
    expect(WORKFLOW_INPUT_ADMISSION_UPDATE_REQUIRED).toBe('workflow_input_admission_update_required');
  });

  it('settles V2 only with machine admission and matching workflow provenance', () => {
    const request = SessionInputRequestV2Schema.parse({
      v: 2,
      producer: 'workflow',
      workflow: { purpose: 'invocation', runId: 'r', invocationRecordId: 'i' },
      permission: {},
    });
    expect(settleSessionInputRequestV2({
      request,
      currentSessionPermissionCeiling: 'default',
      inputAdmissionReceipt: { v: 1, issuer: 'authenticatedMachine' },
    }).permission.admittedPermissionCeiling).toBe('default');
    expect(settleSessionMessageProvenanceV2({
      request,
      requestedProvenance: { v: 2, kind: 'workflow_invocation', runId: 'r', invocationRecordId: 'i' },
      inputAdmissionReceipt: { v: 1, issuer: 'authenticatedMachine' },
    }).kind).toBe('workflow_invocation');
    expect(() => settleSessionMessageProvenanceV2({
      request,
      requestedProvenance: { v: 2, kind: 'workflow_invocation', runId: 'other', invocationRecordId: 'i' },
      inputAdmissionReceipt: { v: 1, issuer: 'authenticatedMachine' },
    })).toThrow(TypeError);
    expect(() => settleSessionInputRequestV2({
      request,
      currentSessionPermissionCeiling: 'default',
      inputAdmissionReceipt: {
        v: 1,
        issuer: 'authenticatedAccount',
        actorAccountId: 'account',
        sessionRelationship: 'owner',
      },
    })).toThrow(TypeError);
  });

  it('rejects a Workflow request broader than the current Session authority instead of clamping it', () => {
    const request = SessionInputRequestV2Schema.parse({
      v: 2,
      producer: 'workflow',
      workflow: { purpose: 'invocation', runId: 'r', invocationRecordId: 'i' },
      permission: { requestedPermissionCeiling: 'safe-yolo' },
    });

    expect(() => settleSessionInputRequestV2({
      request,
      currentSessionPermissionCeiling: 'read-only',
      inputAdmissionReceipt: { v: 1, issuer: 'authenticatedMachine' },
    })).toThrow('permission_escalation_denied');
    expect(settleSessionInputRequestV2({
      request: { ...request, permission: { requestedPermissionCeiling: 'read-only' } },
      currentSessionPermissionCeiling: 'safe-yolo',
      inputAdmissionReceipt: { v: 1, issuer: 'authenticatedMachine' },
    }).permission.admittedPermissionCeiling).toBe('read-only');
  });

  it('derives stable distinct Pending identities for invocation and final delivery', () => {
    const invocation = deriveWorkflowSessionInputLocalIdV2({
      purpose: 'invocation', runId: 'r', invocationRecordId: 'i',
    });
    expect(deriveWorkflowSessionInputLocalIdV2({
      purpose: 'invocation', runId: 'r', invocationRecordId: 'i',
    })).toBe(invocation);
    expect(deriveWorkflowSessionInputLocalIdV2({
      purpose: 'invocation', runId: 'r', invocationRecordId: 'other',
    })).not.toBe(invocation);
    expect(deriveWorkflowSessionInputLocalIdV2({
      purpose: 'result_delivery', runId: 'r',
    })).not.toBe(invocation);
  });

  it('projects settled V2 permission through the incumbent narrow causal authority', () => {
    const meta = withSessionInputAuthority({}, {
      v: 2,
      producer: 'workflow',
      workflow: { purpose: 'result_delivery', runId: 'r' },
      permission: { admittedPermissionCeiling: 'read-only' },
    });
    expect(readSessionInputCausalPermissionAuthorityV1(meta)).toEqual({
      kind: 'admittedSessionInputV1',
      admittedPermissionCeiling: 'read-only',
    });
  });
});
