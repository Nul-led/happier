import { afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  buildAccountStoredContentCompatibilityHttpHeadersV1,
  CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
  createSessionOwnerMetadataV1,
  deriveBoxPublicKeyFromSeed,
  openEncryptedDataKeyEnvelopeV1,
  projectSessionSharedMetadataV1,
  sealEncryptedDataKeyEnvelopeV1,
  sealSessionOwnerMetadataEnvelopeV1,
  V2SessionByIdResponseSchema,
} from '@happier-dev/protocol';

import { createRunDirs } from '../../src/testkit/runDir';
import { fetchJson } from '../../src/testkit/http';
import { createTestAuth } from '../../src/testkit/auth';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { addFriend, fetchAccountId, setUsername } from '../../src/testkit/socialFriends';
import { decryptDataKeyBase64, encryptDataKeyBase64 } from '../../src/testkit/rpcCrypto';

const run = createRunDirs({ runLabel: 'core' });

const currentHeaders = buildAccountStoredContentCompatibilityHttpHeadersV1(
  CURRENT_ACCOUNT_STORED_CONTENT_COMPATIBILITY_DECLARATION,
);

describe('core e2e: e2ee direct share requires encryptedDataKey', () => {
  let server: StartedServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it('rejects missing/invalid envelopes and lets the recipient open the projected Session key and content', async () => {
    const testDir = run.testDir('sharing-session-e2ee-encrypted-datakey-required');
    server = await startServerLight({
      testDir,
      extraEnv: {
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ENABLED: '1',
        HAPPIER_FEATURE_SOCIAL_FRIENDS__ALLOW_USERNAME: '1',
      },
    });

    const owner = await createTestAuth(server.baseUrl);
    const recipient = await createTestAuth(server.baseUrl);

    const ownerId = await fetchAccountId(server.baseUrl, owner.token);
    const recipientId = await fetchAccountId(server.baseUrl, recipient.token);

    await setUsername(server.baseUrl, owner.token, 'owner_e2ee_share');
    await setUsername(server.baseUrl, recipient.token, 'recipient_e2ee_share');
    await addFriend(server.baseUrl, owner.token, recipientId);
    await addFriend(server.baseUrl, recipient.token, ownerId);

    const sessionKey = Uint8Array.from(randomBytes(32));
    const metadata = { path: '/tmp/direct-share-private-path', host: 'owner-device', name: 'Shared encrypted session' };
    const sharedMetadata = projectSessionSharedMetadataV1({ metadata, agentState: null });
    const ownerProjection = createSessionOwnerMetadataV1({ metadata });
    if (!ownerProjection.ok) throw new Error('Unsupported owner metadata fixture');
    const sealFor = (accountMachineKey: Uint8Array) => Buffer.from(sealEncryptedDataKeyEnvelopeV1({
      dataKey: sessionKey,
      recipientPublicKey: deriveBoxPublicKeyFromSeed(accountMachineKey),
      randomBytes,
    })).toString('base64');
    const ownerDataKey = sealFor(owner.accountMachineKey);
    const recipientDataKey = sealFor(recipient.accountMachineKey);

    const create = await fetchJson<{ session: { id: string; encryptionMode: string } }>(`${server.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
        ...currentHeaders,
      },
      body: JSON.stringify({
        tag: 'e2e-share-e2ee',
        encryptionMode: 'e2ee',
        metadataLayoutVersion: 1,
        sharedMetadata: { ciphertext: encryptDataKeyBase64(sharedMetadata, sessionKey) },
        ownerMetadata: sealSessionOwnerMetadataEnvelopeV1({
          material: { type: 'dataKey', machineKey: owner.accountMachineKey },
          ownerMetadata: ownerProjection.ownerMetadata,
          randomBytes,
        }),
        agentState: null,
        dataEncryptionKey: ownerDataKey,
      }),
      timeoutMs: 15_000,
    });
    expect(create.status).toBe(200);
    const sessionId = create.data?.session?.id;
    expect(typeof sessionId).toBe('string');
    expect(create.data?.session?.encryptionMode).toBe('e2ee');

    // The canonical grant route: a ready recipient of an E2EE Session needs its envelope.
    const setGrant = (accountEnvelopeInput?: { v: 1; encryptedDataKey: string }) => fetchJson<{
      error?: string;
      changed?: boolean;
    }>(`${server!.baseUrl}/v2/sessions/access-grants/set`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${owner.token}`,
        'Content-Type': 'application/json',
        ...currentHeaders,
      },
      body: JSON.stringify({
        sessionId,
        subject: { kind: 'account', accountId: recipientId },
        accessLevel: 'view',
        canApprovePermissions: false,
        ...(accountEnvelopeInput ? { accountEnvelopeInput } : {}),
      }),
      timeoutMs: 15_000,
    });

    const missing = await setGrant();
    expect(missing.status).toBe(400);
    expect(missing.data?.error).toBe('recipient_envelope_required');

    const invalid = await setGrant({ v: 1, encryptedDataKey: Buffer.from('x').toString('base64') });
    expect(invalid.status).toBe(400);

    const ok = await setGrant({ v: 1, encryptedDataKey: recipientDataKey });
    expect(ok.status).toBe(200);
    expect(ok.data?.changed).toBe(true);

    const fetched = await fetchJson<unknown>(`${server.baseUrl}/v2/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${recipient.token}`, ...currentHeaders },
    });
    expect(fetched.status).toBe(200);
    const projected = V2SessionByIdResponseSchema.parse(fetched.data).session;
    expect(projected.dataEncryptionKey).toBe(recipientDataKey);
    expect(projected.ownerMetadata).toBeUndefined();
    if (typeof projected.dataEncryptionKey !== 'string') throw new Error('Recipient envelope missing from projection');
    const opened = openEncryptedDataKeyEnvelopeV1({
      envelope: Buffer.from(projected.dataEncryptionKey, 'base64'),
      recipientSecretKeyOrSeed: recipient.accountMachineKey,
    });
    expect(opened).toEqual(sessionKey);
    if (!opened) throw new Error('Recipient could not open its projected Session key');
    expect(decryptDataKeyBase64(projected.metadata, opened)).toEqual(sharedMetadata);
    expect(openEncryptedDataKeyEnvelopeV1({
      envelope: Buffer.from(ownerDataKey, 'base64'),
      recipientSecretKeyOrSeed: recipient.accountMachineKey,
    })).toBeNull();
  }, 180_000);
});
