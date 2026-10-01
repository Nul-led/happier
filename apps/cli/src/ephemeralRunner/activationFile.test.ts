import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import tweetnacl from 'tweetnacl';
import { afterEach, describe, expect, it } from 'vitest';

import { readVerifiedEphemeralRunnerActivationFile } from './activationFile';

const roots: string[] = [];

function fixture() {
  const signing = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(17));
  return {
    v: 1 as const,
    home: {
      v: 1 as const,
      homeServerIdentityId: 'srv_runner_home',
      canonicalServerUrl: 'https://home.example.test',
      revision: 1,
      endpoints: [{ kind: 'https' as const, url: 'https://home.example.test' }],
    },
    activation: {
      id: '00000000-0000-4000-8000-000000000013',
      signingPrivateKeyBase64Url: encodeBase64(signing.secretKey, 'base64url'),
      creatorAccountId: 'creator-account',
      creatorTokenEpoch: 4,
      activationExpiresAt: null,
      workspace: { kind: 'choose_on_endpoint' as const },
      sessionId: 'runner-session',
      machineId: 'runner-machine',
      authoringCommitment: encodeBase64(new Uint8Array(32).fill(23), 'base64url'),
      artifact: {
        product: 'happier-runner' as const,
        version: '0.3.0',
        target: 'linux-x64' as const,
        sha256: 'a'.repeat(64),
      },
      endpointFactsRecipient: { mode: 'plain' as const, creatorAccountId: 'creator-account' },
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('readVerifiedEphemeralRunnerActivationFile', () => {
  it('accepts only the exact artifact-bound activation and derives the signing public key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-activation-'));
    roots.push(root);
    const path = join(root, 'activation.json');
    const value = fixture();
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });

    const verified = await readVerifiedEphemeralRunnerActivationFile(path, {
      artifact: value.activation.artifact,
    });

    expect(verified.document).toEqual(value);
    expect(verified.binding).toMatchObject({
      activationId: value.activation.id,
      machineId: value.activation.machineId,
      sessionId: value.activation.sessionId,
      activationSigningPublicKey: encodeBase64(
        tweetnacl.sign.keyPair.fromSecretKey(verified.activationSecretKey).publicKey,
        'base64url',
      ),
    });
    verified.dispose();
    expect([...verified.activationSecretKey]).toEqual(new Array(64).fill(0));
  });

  it('rejects tampering and a substituted artifact while accepting a schema-valid large descriptor', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-runner-activation-'));
    roots.push(root);
    const path = join(root, 'activation.json');
    const value = fixture();
    const cases: unknown[] = [
      { ...value, token: 'account-bearer-must-not-enter-runner' },
      { ...value, activation: { ...value.activation, sessionId: '' } },
      { ...value, home: { ...value.home, canonicalServerUrl: 'not a URL' } },
    ];

    for (const changed of cases) {
      await writeFile(path, JSON.stringify(changed), { mode: 0o600 });
      await expect(readVerifiedEphemeralRunnerActivationFile(path, {
        artifact: value.activation.artifact,
      })).rejects.toMatchObject({ code: 'RUNNER_ACTIVATION_FILE_INVALID' });
    }

    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    await expect(readVerifiedEphemeralRunnerActivationFile(path, {
      artifact: { ...value.activation.artifact, sha256: 'b'.repeat(64) },
    })).rejects.toMatchObject({ code: 'RUNNER_ARTIFACT_MISMATCH' });

    const large = {
      ...value,
      home: {
        ...value.home,
        endpoints: [{
          kind: 'iroh' as const,
          endpointId: 'a'.repeat(64),
          relayUrls: Array.from({ length: 200 }, (_, index) => (
            `https://relay-${index}.example.test/endpoint/${'x'.repeat(420)}`
          )),
        }],
      },
    };
    await writeFile(path, JSON.stringify(large), { mode: 0o600 });
    await expect(readVerifiedEphemeralRunnerActivationFile(path, {
      artifact: value.activation.artifact,
    })).resolves.toMatchObject({ document: large });
  });
});
