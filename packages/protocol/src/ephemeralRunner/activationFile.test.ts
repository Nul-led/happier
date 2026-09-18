import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { parseHappierRunnerActivationFileV1 } from './activationFile.js';

describe('Happier Runner activation file', () => {
  it('parses the exact adjacent-file contract without accepting runtime secrets or mismatched creator recipient', () => {
    const secretKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8)).secretKey;
    const file = {
      v: 1,
      home: {
        v: 1,
        homeServerIdentityId: 'srv_activation_file',
        canonicalServerUrl: 'https://home.example.test',
        revision: 1,
        endpoints: [{ kind: 'https', url: 'https://home.example.test' }],
      },
      activation: {
        id: '00000000-0000-4000-8000-000000000008',
        signingPrivateKeyBase64Url: encodeBase64(secretKey, 'base64url'),
        creatorAccountId: 'creator',
        creatorTokenEpoch: 0,
        activationExpiresAt: null,
        workspace: { kind: 'endpoint_home' as const },
        sessionId: 'reserved-session',
        machineId: 'reserved-machine',
        authoringCommitment: encodeBase64(new Uint8Array(32).fill(4), 'base64url'),
        artifact: { product: 'happier-runner', version: '0.3.0', target: 'linux-x64', sha256: 'a'.repeat(64) },
        endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'creator' },
      },
    };
    expect(parseHappierRunnerActivationFileV1(file)).toEqual(file);
    const { workspace: _workspace, ...withoutWorkspace } = file.activation;
    for (const changed of [
      { ...file, sessionToken: 'must-not-be-in-package' },
      { ...file, activation: { ...file.activation, prompt: 'not-a-package-field' } },
      { ...file, activation: { ...file.activation, authoringCommitment: encodeBase64(new Uint8Array(31), 'base64url') } },
      { ...file, activation: { ...file.activation, signingPrivateKeyBase64Url: `${file.activation.signingPrivateKeyBase64Url}=` } },
      { ...file, activation: { ...file.activation, signingPrivateKeyBase64Url: encodeBase64(new Uint8Array(64), 'base64url') } },
      { ...file, activation: { ...file.activation, endpointFactsRecipient: { mode: 'plain', creatorAccountId: 'another-account' } } },
      { ...file, activation: withoutWorkspace },
      { ...file, home: { ...file.home, extra: true } },
    ]) {
      expect(parseHappierRunnerActivationFileV1(changed)).toBeNull();
    }
  });
});
