import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAccountScopedCryptoMaterialSnapshotV1 } from '../crypto/accountScopedCipher.js';
import { convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1 } from '../account/encryptionKeyFingerprintV1.js';
import type { AvailableAutomationAccountEncryptionV1 } from '../automations/automationAccountCurrentnessV1.js';
import { prepareWorkflowRunDataKeyV1, resolveWorkflowRunDataKeyV1, runWorkflowRecipientKeyPreparationV1 } from './workflowRunDataKeyV1.js';
import type { WorkflowRunRecipientCensusResponseV1 } from './workflowRunKeyV1.js';

describe('Workflow run key lifecycle', () => {
  it('opens the owner envelope using existing legacy Account material and locks absent or wrong material', () => {
    const material = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee',
      material: { type: 'legacy', secret: randomBytes(32) } });
    const encryption: AvailableAutomationAccountEncryptionV1 = { kind: 'available', witness: { mode: 'e2ee', version: 1,
      contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint) }, material };
    const prepared = prepareWorkflowRunDataKeyV1({ accountId: 'owner', encryption, randomBytes });
    const ownerEnvelope = prepared.recipientKeyEnvelopes[0].encryptedDataKey;
    const census: WorkflowRunRecipientCensusResponseV1 = { runId: 'run', ownerAccountId: 'owner', access: 'owner',
      encryptionMode: 'e2ee', visibleTeamId: null, ownerAccountCurrentness: encryption.witness,
      dataEncryptionKey: ownerEnvelope, callerDataEncryptionKey: ownerEnvelope, recipients: [] };
    const opened = resolveWorkflowRunDataKeyV1({ encryption, census });
    expect(opened).toMatchObject({ kind: 'available', encryption: { runCrypto: prepared.runCrypto } });
    expect(resolveWorkflowRunDataKeyV1({ encryption: { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }, census }))
      .toEqual({ kind: 'unavailable', reason: 'encryption_setup_required' });
    expect(resolveWorkflowRunDataKeyV1({ encryption, census: { ...census, dataEncryptionKey: null } }))
      .toEqual({ kind: 'unavailable', reason: 'history_not_readable' });
    const wrong = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee',
      material: { type: 'legacy', secret: randomBytes(32) } });
    expect(resolveWorkflowRunDataKeyV1({ encryption: { ...encryption, material: wrong }, census }))
      .toEqual({ kind: 'unavailable', reason: 'waiting_for_keys' });
  });

  it('does not prepare an old opened key against a replacement owner key', async () => {
    const material = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee',
      material: { type: 'legacy', secret: randomBytes(32) } });
    const encryption: AvailableAutomationAccountEncryptionV1 = { kind: 'available', witness: { mode: 'e2ee', version: 1,
      contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(material.contentPublicKeyFingerprint) }, material };
    const old = prepareWorkflowRunDataKeyV1({ accountId: 'owner', encryption, randomBytes });
    const replacement = prepareWorkflowRunDataKeyV1({ accountId: 'owner', encryption, randomBytes });
    const ownerEnvelope = replacement.recipientKeyEnvelopes[0].encryptedDataKey;
    let committed = false;
    await expect(runWorkflowRecipientKeyPreparationV1({ runId: 'run', runCrypto: old.runCrypto,
      openedDataEncryptionKey: old.recipientKeyEnvelopes[0].encryptedDataKey, randomBytes,
      readCensus: async () => ({ runId: 'run', ownerAccountId: 'owner', access: 'owner', encryptionMode: 'e2ee', visibleTeamId: null,
        ownerAccountCurrentness: encryption.witness,
        dataEncryptionKey: ownerEnvelope, callerDataEncryptionKey: ownerEnvelope, recipients: [] }),
      commit: async () => { committed = true; return { appliedRecipientAccountIds: [], skippedRecipientAccountIds: [] }; },
    })).rejects.toMatchObject({ code: 'currentness_conflict' });
    expect(committed).toBe(false);
  });
});
