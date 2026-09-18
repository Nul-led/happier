import { describe, expect, it } from 'vitest';
import tweetnacl from 'tweetnacl';
import {
    createProviderBrokerRouteGrantSigningInputV1,
    type ProviderBrokerRouteGrantPayloadV1,
    type SignedProviderBrokerRouteGrantV1,
} from '@happier-dev/protocol';
import { verifyProviderBrokerRouteGrantV1 } from './verifyProviderBrokerRouteGrantV1';

const key = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
const payload: ProviderBrokerRouteGrantPayloadV1 = {
    v: 1, grantId: 'grant', aud: 'happier-provider-broker-route-v1', issuedAt: 100, expiresAt: 200,
    teamId: 'team', resourceId: 'resource',
    expectedResourceRevision: 7, modelId: 'gpt-5', sourceRevision: 'source-revision-7',
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
function sign(value = payload): SignedProviderBrokerRouteGrantV1 {
    return { payload: value, signature: { alg: 'Ed25519', keyId: 'home', valueBase64Url: Buffer.from(tweetnacl.sign.detached(Buffer.from(createProviderBrokerRouteGrantSigningInputV1(value)), key.secretKey)).toString('base64url') } };
}
const input = {
    authority: sign(), nowMs: 150,
    trustRoots: [{ keyId: 'home', publicKey: Buffer.from(key.publicKey).toString('base64url') }],
    expected: { teamId: payload.teamId, resourceId: payload.resourceId, expectedResourceRevision: payload.expectedResourceRevision, modelId: payload.modelId, sourceRevision: payload.sourceRevision, initiator: payload.initiator, target: payload.target, consumer: payload.consumer, application: payload.application },
    authenticatedRemoteEndpointId: payload.initiator.endpointId,
};

describe('verifyProviderBrokerRouteGrantV1', () => {
    it('admits the exact cross-Account authority repeatedly for independent streams', () => {
        expect(verifyProviderBrokerRouteGrantV1(input)).toEqual({ valid: true, authority: input.authority });
        expect(verifyProviderBrokerRouteGrantV1(input)).toEqual({ valid: true, authority: input.authority });
        const run = { kind: 'execution_run', executionRunId: 'run' } as const;
        expect(verifyProviderBrokerRouteGrantV1({ ...input, authority: sign({ ...payload, consumer: run, executionRunOccurrenceId: 'occurrence' }), expected: { ...input.expected, consumer: run } }).valid).toBe(true);
    });

    it('rejects a valid signature from another transport-authenticated endpoint', () => {
        expect(verifyProviderBrokerRouteGrantV1({ ...input, authenticatedRemoteEndpointId: 'c'.repeat(64) })).toEqual({ valid: false, reasonCode: 'transport_identity_mismatch' });
    });

    it('rejects changed exact authority even if a Home signed the substituted grant', () => {
        const substitutes: ProviderBrokerRouteGrantPayloadV1[] = [
            { ...payload, resourceId: 'other' }, { ...payload, teamId: 'other' },
            { ...payload, expectedResourceRevision: 8 },
            { ...payload, modelId: 'other-model' },
            { ...payload, sourceRevision: 'other-source-revision' },
            { ...payload, consumer: { kind: 'session', sessionId: 'other' } },
            { ...payload, initiator: { ...payload.initiator, accountId: 'other' } },
            { ...payload, initiator: { ...payload.initiator, machineId: 'other' } },
            { ...payload, target: { ...payload.target, custodianAccountId: 'other' } },
            { ...payload, target: { ...payload.target, machineId: 'other' } },
            { ...payload, target: { ...payload.target, endpointId: 'c'.repeat(64) } },
        ];
        for (const value of substitutes) expect(verifyProviderBrokerRouteGrantV1({ ...input, authority: sign(value) }).valid).toBe(false);
        expect(verifyProviderBrokerRouteGrantV1({ ...input, authority: { ...input.authority, payload: { ...payload, aud: 'happier-daemon-route-grant' } } }).valid).toBe(false);
    });

    it('requires the current Home signing root, valid signature and admission time', () => {
        expect(verifyProviderBrokerRouteGrantV1({ ...input, authority: { ...input.authority, signature: { ...input.authority.signature, valueBase64Url: 'A'.repeat(86) } } }).valid).toBe(false);
        expect(verifyProviderBrokerRouteGrantV1({ ...input, trustRoots: [] }).valid).toBe(false);
        expect(verifyProviderBrokerRouteGrantV1({ ...input, nowMs: 200 }).valid).toBe(false);
        expect(verifyProviderBrokerRouteGrantV1({ ...input, nowMs: 99 }).valid).toBe(false);
        expect(verifyProviderBrokerRouteGrantV1({ ...input, trustRoots: [{ ...input.trustRoots[0]!, expiresAt: 150 }] }).valid).toBe(false);
    });

    it('retains signature and exact binding checks after a carrier admitted the stream', () => {
        expect(verifyProviderBrokerRouteGrantV1({ ...input, nowMs: 200, enforceExpiry: false })).toEqual({
            valid: true,
            authority: input.authority,
        });
        expect(verifyProviderBrokerRouteGrantV1({
            ...input,
            nowMs: 200,
            enforceExpiry: false,
            authenticatedRemoteEndpointId: 'c'.repeat(64),
        })).toEqual({ valid: false, reasonCode: 'transport_identity_mismatch' });
    });
});
