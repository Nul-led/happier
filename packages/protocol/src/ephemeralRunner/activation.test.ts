import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';

import { encodeBase64 } from '../crypto/base64.js';
import { RunnerActivationCreateRequestV1Schema } from './activation.js';

function request() {
  return {
    v: 1 as const,
    activationId: '00000000-0000-4000-8000-000000000013',
    draftId: 'draft-13',
    homeServerIdentityId: 'srv_activation_service',
    activationSigningPublicKey: encodeBase64(
      tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(13)).publicKey,
      'base64url',
    ),
    activationExpiresAt: null,
    workspace: { kind: 'choose_on_endpoint' as const },
    authoringCommitment: encodeBase64(new Uint8Array(32).fill(13), 'base64url'),
    artifact: {
      product: 'happier-runner' as const,
      version: '0.3.0',
      target: 'linux-x64' as const,
      sha256: 'a'.repeat(64),
    },
    endpointFactsRecipient: { mode: 'plain' as const, creatorAccountId: 'creator-13' },
  };
}

describe('Runner activation creator authorization', () => {
  it('requires the exact endpoint workspace policy in the creator-authenticated request', () => {
    expect(RunnerActivationCreateRequestV1Schema.parse(request())).toMatchObject({
      workspace: { kind: 'choose_on_endpoint' },
    });
    const { workspace: _workspace, ...withoutWorkspace } = request();
    expect(RunnerActivationCreateRequestV1Schema.safeParse(withoutWorkspace).success).toBe(false);
    expect(RunnerActivationCreateRequestV1Schema.safeParse({
      ...request(),
      workspace: { kind: 'endpoint_home', fallback: 'choose_on_endpoint' },
    }).success).toBe(false);
  });

  it('accepts only an explicit affirmative unattended-Team authorization intent', () => {
    expect(RunnerActivationCreateRequestV1Schema.parse({
      ...request(),
      authorizeUnattendedTeamAccess: true,
    })).toMatchObject({ authorizeUnattendedTeamAccess: true });
    expect(RunnerActivationCreateRequestV1Schema.safeParse({
      ...request(),
      authorizeUnattendedTeamAccess: false,
    }).success).toBe(false);
    expect(RunnerActivationCreateRequestV1Schema.parse(request()))
      .not.toHaveProperty('authorizeUnattendedTeamAccess');
  });
});
