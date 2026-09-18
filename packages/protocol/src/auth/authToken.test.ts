import { describe, expect, it } from 'vitest';

import {
    AUTH_TOKEN_KIND_AUTHORITIES,
    AuthTokenAuthenticationEvidenceSnapshotV1Schema,
    AuthTokenProvenanceV2Schema,
    AuthTokenProvenanceSchema,
} from './authToken.js';

describe('auth token provenance contract', () => {
    it('accepts exactly the canonical kind/authority pairings', () => {
        const canonicalPairings = [
            { kind: 'account', authority: 'present_user' },
            { kind: 'account_directory', authority: 'present_user' },
            { kind: 'terminal', authority: 'account_automation' },
            { kind: 'api_token', authority: 'account_automation' },
            { kind: 'ephemeral_session_runner', authority: 'session_runtime' },
        ] as const;

        for (const pairing of canonicalPairings) {
            expect(AUTH_TOKEN_KIND_AUTHORITIES[pairing.kind]).toBe(pairing.authority);
            expect(AuthTokenProvenanceSchema.parse({ v: 1, ...pairing })).toEqual({
                v: 1,
                ...pairing,
            });
        }
    });

    it('fails closed on non-canonical pairings', () => {
        const invalidPairings = [
            { kind: 'account', authority: 'account_automation' },
            { kind: 'account_directory', authority: 'account_automation' },
            { kind: 'terminal', authority: 'present_user' },
            { kind: 'api_token', authority: 'present_user' },
            { kind: 'ephemeral_session_runner', authority: 'present_user' },
            { kind: 'ephemeral_session_runner', authority: 'account_automation' },
        ] as const;

        for (const pairing of invalidPairings) {
            expect(
                AuthTokenProvenanceSchema.safeParse({ v: 1, ...pairing }).success,
            ).toBe(false);
        }
    });

    it('rejects expanded provenance contracts', () => {
        expect(AuthTokenProvenanceSchema.safeParse({
            v: 1,
            kind: 'account',
            authority: 'present_user',
            mintOrigin: 'unexpected',
        }).success).toBe(false);
    });

    it('rejects unknown, future, malformed, and expanded markers', () => {
        expect(AuthTokenProvenanceSchema.safeParse({ v: 2, kind: 'account', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ kind: 'account', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'account', authority: 'present_user', extra: true }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'future', authority: 'present_user' }).success).toBe(false);
        expect(AuthTokenProvenanceSchema.safeParse({ v: 1, kind: 'account', authority: 'future' }).success).toBe(false);
    });

    it('accepts only bounded server-produced authentication evidence in v2', () => {
        expect(AuthTokenProvenanceV2Schema.parse({
            v: 2,
            kind: 'account',
            authority: 'present_user',
            evidence: [
                { kind: 'home_method', methodId: 'key_challenge' },
                {
                    kind: 'provider',
                    providerId: 'acme-oidc',
                    identityId: 'identity-1',
                    runtimeFingerprint: 'runtime-1',
                    teamConnectionId: 'connection-1',
                },
            ],
        })).toMatchObject({ v: 2, evidence: expect.any(Array) });
        expect(AuthTokenProvenanceV2Schema.safeParse({
            v: 2,
            kind: 'account',
            authority: 'present_user',
            evidence: [],
        }).success).toBe(false);
        expect(AuthTokenProvenanceV2Schema.safeParse({
            v: 2,
            kind: 'account',
            authority: 'present_user',
            evidence: [{ kind: 'provider', providerId: 'acme-oidc', identityId: 'identity-1', runtimeFingerprint: 'runtime-1', teamConnectionId: 'connection-1', extra: true }],
        }).success).toBe(false);
    });

    it('uses one closed versioned snapshot for persisted unattended evidence', () => {
        const snapshot = {
            v: 1 as const,
            evidence: [{ kind: 'home_method' as const, methodId: 'email_password' }],
        };
        expect(AuthTokenAuthenticationEvidenceSnapshotV1Schema.parse(snapshot)).toEqual(snapshot);
        expect(AuthTokenAuthenticationEvidenceSnapshotV1Schema.safeParse({
            ...snapshot,
            callerApproved: true,
        }).success).toBe(false);
        expect(AuthTokenAuthenticationEvidenceSnapshotV1Schema.safeParse({
            v: 2,
            evidence: snapshot.evidence,
        }).success).toBe(false);
        expect(AuthTokenAuthenticationEvidenceSnapshotV1Schema.safeParse({
            ...snapshot,
            evidence: [...snapshot.evidence, ...snapshot.evidence],
        }).success).toBe(false);
    });
});
