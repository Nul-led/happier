import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import { createProviderBrokerRouteGrantSigningInputV1, type ProviderBrokerRouteGrantPayloadV1 } from '@happier-dev/protocol';
import { signProviderBrokerRouteGrantV1 } from './signProviderBrokerRouteGrantV1';

const payload: ProviderBrokerRouteGrantPayloadV1 = {
    v: 1, grantId: 'grant', aud: 'happier-provider-broker-route-v1', issuedAt: 100, expiresAt: 200,
    teamId: 'team', resourceId: 'resource',
    sourceRevision: 'source-revision-7',
    initiator: { accountId: 'requester', machineId: 'worker', endpointId: 'a'.repeat(64) },
    target: { custodianAccountId: 'custodian', machineId: 'broker', endpointId: 'b'.repeat(64) },
    consumer: { kind: 'session', sessionId: 'session' },
    application: {
        agentTargetKey: 'codex',
        implementationIdentity: { pluginId: 'happier.provider.cliproxyapi', localId: 'cliproxyapi' },
        endpointTemplateId: 'cliproxyapi-openai-responses',
        protocol: 'openai-responses',
    },
};

describe('signProviderBrokerRouteGrantV1', () => {
    it('signs validated authority with the supplied canonical Home signing key', () => {
        const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
        const authority = signProviderBrokerRouteGrantV1({ payload, signingKey: { keyId: 'home', secretKey: key.secretKey } });
        expect(authority.payload).toEqual(payload);
        expect(authority.signature.keyId).toBe('home');
        expect(tweetnacl.sign.detached.verify(Buffer.from(createProviderBrokerRouteGrantSigningInputV1(payload)), Buffer.from(authority.signature.valueBase64Url, 'base64url'), key.publicKey)).toBe(true);
        expect(() => signProviderBrokerRouteGrantV1({ payload: { ...payload, resourceRevision: 1 }, signingKey: { keyId: 'home', secretKey: key.secretKey } })).toThrow();
    });
});
