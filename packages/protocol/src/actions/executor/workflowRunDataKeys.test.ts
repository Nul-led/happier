import { randomBytes } from 'node:crypto';
import { ed25519, x25519 } from '@noble/curves/ed25519';
import { describe, expect, it } from 'vitest';
import { createAccountScopedCryptoMaterialSnapshotV1 } from '../../crypto/accountScopedCipher.js';
import { convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1 } from '../../account/encryptionKeyFingerprintV1.js';
import { signAccountContentKeyBindingV1 } from '../../crypto/accountContentKeyBindingV1.js';
import { decodeBase64, encodeBase64 } from '../../crypto/base64.js';
import { openEncryptedDataKeyEnvelopeV1 } from '../../crypto/encryptedDataKeyEnvelopeV1.js';
import { createWorkflowAccountRunActionOwner } from './workflowRunActions.js';

const runId = '11111111-1111-4111-8111-111111111111';
const definition = { version: 1 as const, defaults: {
  agentTarget: { kind: 'agent' as const, identity: { pluginId: 'happier.agent.test', localId: 'test' } },
}, blocks: ['work'] };

function recipient(accountId: string) {
  const machineKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(machineKey);
  const material = createAccountScopedCryptoMaterialSnapshotV1({ accountEncryptionMode: 'e2ee',
    material: { type: 'dataKey', machineKey }, dataKeyPublicKey: publicKey });
  const signingSecret = randomBytes(32);
  const signingPublic = ed25519.getPublicKey(signingSecret);
  return { machineKey, material, census: { recipientAccountId: accountId,
    contentKey: { status: 'available' as const, accountSigningPublicKey: Buffer.from(signingPublic).toString('hex'),
      contentPublicKey: encodeBase64(publicKey), contentPublicKeySignature: encodeBase64(signAccountContentKeyBindingV1({
        accountSigningSecretKey: new Uint8Array([...signingSecret, ...signingPublic]), contentPublicKey: publicKey,
      })) }, contentPublicKeyFingerprint: material.contentPublicKeyFingerprint,
    encryptedDataKey: null, recipientContentPublicKeyFingerprint: null } };
}

describe('Workflow per-run key admission', () => {
  it('keeps plain admission keyless without discovering encryption recipients', async () => {
    let admitted: Readonly<Record<string, unknown>> | undefined;
    const actionOwner = createWorkflowAccountRunActionOwner({
      resolveAccountId: async () => 'owner',
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }),
      storage: { execute: async (operation) => {
        if (operation.operation === 'get') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
        if (operation.operation === 'admit') {
          admitted = operation;
          return { kind: 'created', run: { sourceArtifactId: null, ownerAccountId: 'owner', visibleTeamId: null, id: runId, origin: { kind: 'direct' }, state: 'queued', revision: 0,
            machineId: 'machine', workflowCustodyState: 'pending', originDeliveryAckRevision: null,
            availability: { pause: true, resumeBoundary: false,
               restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
            createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } };
        }
        throw new Error('Plain admission must not discover encryption recipients');
      } },
      definitions: { get: async () => { throw new Error('inline source'); } }, normalizeAbsolutePath: (path) => path,
      resolveMaterializationContext: async () => ({ effects: { resolveTargetAvailability: async () => true } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine',
        directory: '/repo', checkoutRootPath: '/repo' } } }),
      randomBytes: () => { throw new Error('Plain admission must not generate encryption keys'); },
    });
    await actionOwner.execute({ actionId: 'workflow.run.start', input: { runId, source: { kind: 'inline', definition } },
      context: { callerPermissionMode: 'default', externalActionTarget: { kind: 'machine', machineId: 'machine',
        project: { machineId: 'machine', directory: '/repo' } } } });
    expect(admitted?.recipientKeyEnvelopes ?? []).toEqual([]);
    expect(JSON.parse(String(admitted?.acceptedEnvelope)).t).toBe('plain');
  });

  it('admits one fresh transferable key for the owner and authorized audience', async () => {
    const owner = recipient('owner');
    const viewer = recipient('viewer');
    let admitted: Readonly<Record<string, unknown>> | undefined;
    const run = { sourceArtifactId: null, visibleTeamId: null, id: runId, ownerAccountId: 'owner',
      origin: { kind: 'direct' }, state: 'queued', revision: 0, machineId: 'machine',
      workflowCustodyState: 'pending', originDeliveryAckRevision: null,
      availability: { pause: true, resumeBoundary: false,
         restoreWorkspace: false, cancel: true, inspectExecution: false, disabledReasons: [] },
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
    const actionOwner = createWorkflowAccountRunActionOwner({
      resolveAccountId: async () => 'owner',
      resolveEncryption: async () => ({ kind: 'available', witness: { mode: 'e2ee', version: 1,
        contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(owner.material.contentPublicKeyFingerprint) }, material: owner.material }),
      storage: { execute: async (operation) => {
        if (operation.operation === 'get') throw Object.assign(new Error('run_not_found'), { code: 'run_not_found' });
        if (operation.operation === 'run-key.census') return { runId, ownerAccountId: 'owner', access: 'owner',
          ownerAccountCurrentness: { mode: 'e2ee', version: 1,
            contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(owner.material.contentPublicKeyFingerprint) },
          encryptionMode: 'e2ee', visibleTeamId: null, dataEncryptionKey: null, callerDataEncryptionKey: null,
          recipients: [owner.census, viewer.census] };
        if (operation.operation === 'admit') { admitted = operation; return { kind: 'created', run }; }
        throw new Error(`Unexpected operation ${String(operation.operation)}`);
      } },
      definitions: { get: async () => { throw new Error('inline source'); } },
      normalizeAbsolutePath: (path) => path,
      resolveMaterializationContext: async () => ({ effects: { resolveTargetAvailability: async () => true } }),
      prepareWorkspace: async () => ({ ok: true, workspaceTarget: { project: { machineId: 'machine',
        directory: '/repo', checkoutRootPath: '/repo' } } }), randomBytes,
    });
    await actionOwner.execute({ actionId: 'workflow.run.start', input: { runId, source: { kind: 'inline', definition } },
      context: { callerPermissionMode: 'default', externalActionTarget: { kind: 'machine', machineId: 'machine',
        project: { machineId: 'machine', directory: '/repo' } } } });
    expect(admitted?.recipientKeyEnvelopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientAccountId: 'owner' }), expect.objectContaining({ recipientAccountId: 'viewer' }),
    ]));
    const envelopes = admitted?.recipientKeyEnvelopes as Array<{ recipientAccountId: string; encryptedDataKey: string }>;
    const open = (accountId: string, machineKey: Uint8Array) => openEncryptedDataKeyEnvelopeV1({
      envelope: decodeBase64(envelopes.find((entry) => entry.recipientAccountId === accountId)!.encryptedDataKey),
      recipientSecretKeyOrSeed: machineKey,
    });
    const key = open('owner', owner.machineKey);
    expect(key).toHaveLength(32);
    expect(key).not.toEqual(owner.machineKey);
    expect(open('viewer', viewer.machineKey)).toEqual(key);
    const ownerEnvelope = envelopes.find(entry => entry.recipientAccountId === 'owner')!.encryptedDataKey;
    const viewerEnvelope = envelopes.find(entry => entry.recipientAccountId === 'viewer')!.encryptedDataKey;
    const census = { runId, ownerAccountId: 'owner', access: 'view', encryptionMode: 'e2ee', visibleTeamId: null,
      ownerAccountCurrentness: { mode: 'e2ee', version: 1, contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(owner.material.contentPublicKeyFingerprint) },
      dataEncryptionKey: ownerEnvelope, callerDataEncryptionKey: viewerEnvelope,
      recipients: [owner.census, viewer.census].map(item => ({ ...item,
        encryptedDataKey: item.recipientAccountId === 'owner' ? ownerEnvelope : viewerEnvelope,
        recipientContentPublicKeyFingerprint: item.contentPublicKeyFingerprint })) };
    const readAs = (plain: boolean) => createWorkflowAccountRunActionOwner({
      resolveAccountId: async () => 'viewer',
      resolveEncryption: async () => plain
        ? { kind: 'available', witness: { mode: 'plain', version: 1, contentKeyFingerprint: null } }
        : { kind: 'available', witness: { mode: 'e2ee', version: 1,
          contentKeyFingerprint: convertContentPublicKeyFingerprintToAccountEncryptionMigrateKeyFingerprintV1(viewer.material.contentPublicKeyFingerprint) }, material: viewer.material },
      storage: { execute: async operation => {
        if (operation.operation === 'get') return { run, acceptedEnvelope: admitted?.acceptedEnvelope,
          checkpointEnvelope: null, resultEnvelope: null, keyCensus: census };
        if (operation.operation === 'run-key.census') return census;
        if (operation.operation === 'invocations.list') return { invocations: [] };
        throw new Error(`Unexpected reader operation ${String(operation.operation)}`);
      } },
      definitions: { get: async () => { throw new Error('reader does not rematerialize'); } },
      normalizeAbsolutePath: path => path, randomBytes,
    });
    const request = { actionId: 'workflow.run.get' as const, input: { runId }, context: { callerPermissionMode: 'default' as const } };
    const opened = await readAs(false).execute(request);
    expect(opened).toHaveProperty('acceptedContext.source.kind', 'inline');
    await expect(readAs(true).execute(request)).rejects.toMatchObject({ code: 'content_unavailable' });
  });
});
