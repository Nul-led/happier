import { describe, expect, it } from 'vitest';

import type { AccountScopedCryptoMaterial } from '../crypto/accountScopedCipher.js';
import {
  openWorkflowAcceptedSnapshotStoredEnvelopeV1,
  openWorkflowCheckpointStoredEnvelopeV1,
  openWorkflowFinalResultStoredEnvelopeV1,
  openWorkflowProgressStoredEnvelopeV1,
  sealWorkflowAcceptedSnapshotStoredEnvelopeV1,
  sealWorkflowCheckpointStoredEnvelopeV1,
  sealWorkflowFinalResultStoredEnvelopeV1,
  sealWorkflowProgressStoredEnvelopeV1,
  validateWorkflowStoredEnvelopeOuterForModeV1,
} from './workflowStoredContentV1.js';

const material: AccountScopedCryptoMaterial = {
  type: 'dataKey',
  machineKey: new Uint8Array(32).fill(7),
};
const randomBytes = (length: number) => new Uint8Array(length).fill(3);

const acceptedBinding = {
  v: 1 as const,
  purpose: 'accepted_snapshot' as const,
  accountId: 'account-1',
  runId: 'run-1',
};
const progressBinding = {
  v: 1 as const,
  purpose: 'invocation_progress' as const,
  accountId: 'account-1',
  runId: 'run-1',
  recordId: 'row-1',
  sequence: '0',
  parentRecordId: null,
  memberOrdinal: '0',
  attempt: '0',
};
const checkpointBinding = {
  v: 1 as const,
  purpose: 'checkpoint' as const,
  accountId: 'account-1',
  runId: 'run-1',
};
const finalResultBinding = {
  v: 1 as const,
  purpose: 'final_result' as const,
  accountId: 'account-1',
  runId: 'run-1',
};

describe('Workflow stored Account content', () => {
  it('round-trips every canonical purpose in plain and E2EE modes', () => {
    const fixtures = [
      {
        seal: (mode: 'plain' | 'e2ee') => sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
          binding: acceptedBinding,
          acceptedSnapshot: {
            definition: { version: 1, inputs: [], defaults: {}, blocks: [{ kind: 'step', id: 'step-1', document: { text: 'Do it', references: [], attachments: [] }, input: [], result: { kind: 'text' } }] },
            metadata: { title: 'Frozen private title', description: 'Frozen private summary' },
            inputs: {},
            machineId: 'machine-1',
            executionTarget: { kind: 'session' },
            workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
            source: { kind: 'automation', automationId: 'automation-1' },
            authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
          },
          ...(mode === 'plain' ? { mode } : { mode, material, randomBytes }),
        }),
        open: (mode: 'plain' | 'e2ee', envelope: unknown) => openWorkflowAcceptedSnapshotStoredEnvelopeV1({
          mode, binding: acceptedBinding, envelope, material,
        }),
      },
      {
        seal: (mode: 'plain' | 'e2ee') => sealWorkflowProgressStoredEnvelopeV1({
          binding: progressBinding,
          progress: {
            kind: 'happier.workflow-progress.v1',
            invocationPath: { blockId: '$root', scope: [] },
            blockKind: 'root',
            attempt: '0',
            logicalInvocationRecordId: 'row-1',
          },
          ...(mode === 'plain' ? { mode } : { mode, material, randomBytes }),
        }),
        open: (mode: 'plain' | 'e2ee', envelope: unknown) => openWorkflowProgressStoredEnvelopeV1({
          mode, binding: progressBinding, envelope, material,
        }),
      },
      {
        seal: (mode: 'plain' | 'e2ee') => sealWorkflowCheckpointStoredEnvelopeV1({
          binding: checkpointBinding,
          checkpoint: {
            kind: 'happier.workflow-checkpoint.v1',
            rootRecordId: 'row-1',
            nextSequence: '1',
            frontier: { nextBlockOrdinal: 1, paused: false },
          },
          ...(mode === 'plain' ? { mode } : { mode, material, randomBytes }),
        }),
        open: (mode: 'plain' | 'e2ee', envelope: unknown) => openWorkflowCheckpointStoredEnvelopeV1({
          mode, binding: checkpointBinding, envelope, material,
        }),
      },
      {
        seal: (mode: 'plain' | 'e2ee') => sealWorkflowFinalResultStoredEnvelopeV1({
          binding: finalResultBinding,
          finalResult: {
            kind: 'happier.workflow-final-result.v1',
            result: { kind: 'text', value: 'done' },
            producerInvocation: { recordId: 'row-1' },
          },
          ...(mode === 'plain' ? { mode } : { mode, material, randomBytes }),
        }),
        open: (mode: 'plain' | 'e2ee', envelope: unknown) => openWorkflowFinalResultStoredEnvelopeV1({
          mode, binding: finalResultBinding, envelope, material,
        }),
      },
    ];

    for (const fixture of fixtures) {
      expect(fixture.open('plain', fixture.seal('plain')).kind).toBe('available');
      expect(fixture.open('e2ee', fixture.seal('e2ee')).kind).toBe('available');
    }
  });

  it('fails a private accepted metadata open closed with the wrong E2EE material', () => {
    const envelope = sealWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'e2ee', binding: acceptedBinding, material, randomBytes,
      acceptedSnapshot: {
        definition: { version: 1, inputs: [], defaults: {}, blocks: [{ kind: 'step', id: 'step-1', document: { text: 'Do it', references: [], attachments: [] }, input: [], result: { kind: 'text' } }] },
        metadata: { title: 'Secret title' }, inputs: {}, machineId: 'machine-1', executionTarget: { kind: 'session' },
        workspaceTarget: { project: { machineId: 'machine-1', directory: '/repo', checkoutRootPath: '/repo' } },
        source: { kind: 'automation', automationId: 'automation-1' },
        authorization: { admittedPermissionCeiling: 'default', principal: { kind: 'host' } },
      },
    });
    expect(openWorkflowAcceptedSnapshotStoredEnvelopeV1({
      mode: 'e2ee', binding: acceptedBinding, envelope,
      material: { type: 'dataKey', machineKey: new Uint8Array(32).fill(8) },
    })).toMatchObject({ kind: 'contentInvalid' });
  });

  it('binds a retry envelope to its physical row while retaining the first attempt as logical identity', () => {
    const retryBinding = {
      ...progressBinding,
      recordId: 'row-2',
      sequence: '1',
      parentRecordId: 'row-root',
      attempt: '1',
    };
    const envelope = sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: retryBinding,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step-1', scope: [] },
        blockKind: 'step',
        attempt: '1',
        logicalInvocationRecordId: 'row-1',
        previousAttemptRecordId: 'row-1',
      },
    });

    expect(openWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: retryBinding,
      envelope,
    })).toMatchObject({
      kind: 'available',
      content: {
        logicalInvocationRecordId: 'row-1',
        previousAttemptRecordId: 'row-1',
      },
    });
  });

  it('binds the private execution attempt to the immutable row selector', () => {
    expect(() => sealWorkflowProgressStoredEnvelopeV1({
      mode: 'plain',
      binding: progressBinding,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: 'step-1', scope: [] },
        blockKind: 'step',
        attempt: '1',
        logicalInvocationRecordId: 'row-0',
        previousAttemptRecordId: 'row-0',
      },
    })).toThrow(TypeError);
  });

  it('fails closed for mode, row, Run and purpose replay', () => {
    const encryptedProgress = sealWorkflowProgressStoredEnvelopeV1({
      mode: 'e2ee', material, randomBytes, binding: progressBinding,
      progress: {
        kind: 'happier.workflow-progress.v1',
        invocationPath: { blockId: '$root', scope: [] },
        blockKind: 'root', attempt: '0', logicalInvocationRecordId: 'row-1',
      },
    });
    expect(openWorkflowProgressStoredEnvelopeV1({
      mode: 'e2ee', material, envelope: encryptedProgress,
      binding: { ...progressBinding, recordId: 'row-2' },
    })).toEqual({ kind: 'bindingMismatch' });
    expect(openWorkflowProgressStoredEnvelopeV1({
      mode: 'e2ee', material, envelope: encryptedProgress,
      binding: { ...progressBinding, runId: 'run-2' },
    })).toEqual({ kind: 'bindingMismatch' });
    expect(openWorkflowFinalResultStoredEnvelopeV1({
      mode: 'e2ee', material, envelope: encryptedProgress, binding: finalResultBinding,
    })).toEqual({ kind: 'contentInvalid' });
    expect(validateWorkflowStoredEnvelopeOuterForModeV1({
      mode: 'plain', envelope: encryptedProgress, binding: progressBinding,
    })).toEqual({ kind: 'modeMismatch' });
  });
});
