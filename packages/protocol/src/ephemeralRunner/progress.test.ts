import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { encodeBase64 } from '../crypto/base64.js';

import {
  RunnerActivationProgressPhaseV1Schema,
} from './progress.js';
import {
  RunnerActivationProgressUpdateV1Schema,
  signRunnerActivationProgressUpdateV1,
  verifyRunnerActivationProgressUpdateV1,
} from './progressProof.js';

describe('Runner activation progress', () => {
  it('carries only the launch step the activation projection cannot express', () => {
    expect(RunnerActivationProgressPhaseV1Schema.parse('checking_ai_access')).toBe('checking_ai_access');
    // Every other phase is derived by the creator from state/review/readiness,
    // so the endpoint must not be able to report one.
    for (const derived of ['connected', 'installing_agent', 'preparing_encryption', 'creating_session']) {
      expect(RunnerActivationProgressPhaseV1Schema.safeParse(derived).success).toBe(false);
    }
  });

  it('rejects unknown phases and unknown proof fields', () => {
    expect(RunnerActivationProgressPhaseV1Schema.safeParse('preparing_session').success).toBe(false);
    expect(RunnerActivationProgressUpdateV1Schema.safeParse({
      payload: {
        v: 1,
        purpose: 'happier.ephemeral-session-runner.activation-progress',
        activationId: '00000000-0000-4000-8000-000000000013',
        sessionId: 'session-13',
        machineId: 'machine-13',
        creatorTokenEpoch: 1,
        phase: 'checking_ai_access',
        extra: true,
      },
      activationSignature: 'a'.repeat(86),
      installationSignature: 'b'.repeat(86),
    }).success).toBe(false);
  });

  it('binds the phase and current activation identity to both endpoint keys', () => {
    const activationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(13));
    const installationKey = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(14));
    const payload = {
      v: 1 as const,
      purpose: 'happier.ephemeral-session-runner.activation-progress' as const,
      activationId: '00000000-0000-4000-8000-000000000013',
      sessionId: 'session-13',
      machineId: 'machine-13',
      creatorTokenEpoch: 1,
      phase: 'checking_ai_access' as const,
    };
    const update = signRunnerActivationProgressUpdateV1({
      payload,
      activationSecretKey: activationKey.secretKey,
      installationSecretKey: installationKey.secretKey,
    });
    const verify = (expectedPayload: unknown) => verifyRunnerActivationProgressUpdateV1({
      update,
      expectedPayload,
      activationSigningPublicKey: encodeBase64(activationKey.publicKey, 'base64url'),
      installationPublicKey: encodeBase64(installationKey.publicKey, 'base64url'),
    });

    expect(verify(payload)).toEqual(update);
    expect(verify({ ...payload, phase: 'preparing_session' })).toBeNull();
  }, 15_000);
});
