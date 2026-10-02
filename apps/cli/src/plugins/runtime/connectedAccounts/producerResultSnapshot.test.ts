import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
    snapshotConnectedAccountEstablishedResult,
} from './producerResultSnapshot';

describe('connected-account producer result snapshots', () => {
    it('preserves a provider quota family separately from its window and rejects malformed family metadata', () => {
        const operation = { kind: 'quota' } as const;
        const options = { quotaLeafUnavailable: false } as const;
        const quota = { observedAtMs: 100, limits: [{ id: 'codex_spark:primary', providerLimitId: 'codex_spark', used: 20, remaining: 80 }] };
        expect(snapshotConnectedAccountEstablishedResult(operation, quota, options)).toEqual(quota);
        for (const providerLimitId of ['', 42, 'x'.repeat(257)]) {
            expect(() => snapshotConnectedAccountEstablishedResult(operation, {
                ...quota, limits: [{ ...quota.limits[0], providerLimitId }],
            }, options)).toThrow(expect.objectContaining({ code: 'connected_account_producer_result_invalid' }));
        }
    });

    it('admits detached subscription observations and rejects invalid subscription authority fields', () => {
        const operation = { kind: 'quota' } as const;
        const options = { quotaLeafUnavailable: false } as const;
        for (const status of ['subscribed', 'unavailable'] as const) {
            const subscription = {
                status,
                renewal: 'off',
                observedAtMs: 100,
                staleAfterMs: 1_000,
                currentPeriodEndAtMs: 200,
                lastRefreshError: { observedAtMs: 110, code: 'network' },
            };
            const quota = { observedAtMs: 110, limits: [{ id: 'requests', remaining: 3 }], subscription };
            const result = snapshotConnectedAccountEstablishedResult(operation, quota, options);
            expect(result).toEqual(quota);
            if (!result || !('limits' in result)) throw new Error('Expected a quota snapshot');
            subscription.observedAtMs = 900;
            subscription.lastRefreshError.observedAtMs = 900;
            expect(result.subscription).toMatchObject({ observedAtMs: 100, lastRefreshError: { observedAtMs: 110 } });
            for (const invalidSubscription of [
                { ...subscription, recordId: 'another-account' },
                { ...subscription, lastRefreshError: { ...subscription.lastRefreshError, authority: true } },
                { ...subscription, lastRefreshError: { observedAtMs: 110, code: 'unsupported' } },
            ]) {
                expect(() => snapshotConnectedAccountEstablishedResult(operation, { ...quota, subscription: invalidSubscription }, options))
                    .toThrow(expect.objectContaining({ code: 'connected_account_producer_result_invalid', operation: 'quota' }));
            }
        }
    });
    it('snapshots reset inventory and rejects unknown authority fields in inventory and receipts', () => {
        const read = { kind: 'recoveryCredits.read' } as const;
        const consume = { kind: 'recoveryCredits.consume', request: { idempotencyKey: 'reset-1' } } as const;
        const inventory = { observedAtMs: 100, availableCount: 1, credits: [{ providerCreditId: 'credit-1', status: 'available', expiresAtMs: 200 }] };
        expect(snapshotConnectedAccountEstablishedResult(read, inventory, { quotaLeafUnavailable: false })).toEqual(inventory);
        expect(snapshotConnectedAccountEstablishedResult(consume, { status: 'consumed' }, { quotaLeafUnavailable: false })).toEqual({ status: 'consumed' });
        for (const value of [
            { ...inventory, accountId: 'other' },
            { ...inventory, credits: [{ ...inventory.credits[0], authority: true }] },
            { ...inventory, credits: [{ ...inventory.credits[0], providerCreditId: 'x'.repeat(257) }] },
        ]) {
            expect(() => snapshotConnectedAccountEstablishedResult(read, value, { quotaLeafUnavailable: false })).toThrow('Connected-account producer result is invalid');
        }
        expect(() => snapshotConnectedAccountEstablishedResult(consume, { status: 'consumed', accountId: 'other' }, { quotaLeafUnavailable: false })).toThrow('Connected-account producer result is invalid');
    });
    it('projects a bounded protocol diagnostic with health facts', () => {
        const result = snapshotConnectedAccountEstablishedResult(
            Object.freeze({ kind: 'status' as const }),
            Object.freeze({
                status: 'connected',
                displayName: 'Account A',
                scopes: Object.freeze(['read']),
                diagnostic: Object.freeze({
                    code: 'provider_notice',
                    severity: 'warning',
                    message: 'The provider recommends reconnecting soon.',
                    details: Object.freeze({ retryable: true }),
                    remediation: Object.freeze({ kind: 'retry' as const }),
                }),
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        );

        expect(result).toEqual({
            status: 'connected',
            displayName: 'Account A',
            scopes: ['read'],
            diagnostic: {
                code: 'provider_notice',
                severity: 'warning',
                message: 'The provider recommends reconnecting soon.',
                details: { retryable: true },
                remediation: { kind: 'retry' },
            },
        });
    });

    it('preserves health facts when an optional diagnostic cannot cross the protocol boundary', () => {
        const result = snapshotConnectedAccountEstablishedResult(
            Object.freeze({ kind: 'status' as const }),
            Object.freeze({
                status: 'connected',
                displayName: 'Account A',
                scopes: Object.freeze(['read']),
                diagnostic: Object.freeze({
                    code: 'provider_notice',
                    severity: 'unsupported',
                    message: 'must not cross the host boundary',
                }),
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        );

        expect(result).toEqual({
            status: 'connected',
            displayName: 'Account A',
            scopes: ['read'],
        });
    });

    it('preserves revocation facts when an optional diagnostic cannot cross the protocol boundary', () => {
        const result = snapshotConnectedAccountEstablishedResult(
            Object.freeze({ kind: 'revoke' as const }),
            Object.freeze({
                status: 'remoteRevoked',
                diagnostic: Object.freeze({
                    code: 'provider_notice',
                    severity: 'unsupported',
                    message: 'must not cross the host boundary',
                }),
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        );

        expect(result).toEqual({ status: 'remoteRevoked' });
    });

    it('keeps required diagnostic result variants fail-closed', () => {
        const invalidDiagnostic = Object.freeze({
            code: 'provider_notice',
            severity: 'unsupported',
        });

        expect(() => snapshotConnectedAccountEstablishedResult(
            Object.freeze({ kind: 'status' as const }),
            Object.freeze({
                status: 'rejected',
                diagnostic: invalidDiagnostic,
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        )).toThrow('Connected-account producer result is invalid');

        expect(() => snapshotConnectedAccountEstablishedResult(
            Object.freeze({ kind: 'revoke' as const }),
            Object.freeze({
                status: 'outcomeUnknown',
                diagnostic: invalidDiagnostic,
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        )).toThrow('Connected-account producer result is invalid');
    });

    it('accepts Buffer file bytes and snapshots them as a detached Uint8Array', () => {
        const source = Buffer.from([1, 2, 3]);
        const result = snapshotConnectedAccountEstablishedResult(
            Object.freeze({
                kind: 'materialize' as const,
                request: Object.freeze({
                    kind: 'files' as const,
                    fileIds: Object.freeze(['credential']),
                }),
            }),
            Object.freeze({
                kind: 'files' as const,
                files: Object.freeze({ credential: source }),
            }),
            Object.freeze({ quotaLeafUnavailable: false }),
        );

        if (result.kind !== 'files') throw new Error('Expected file materialization');
        const bytes = result.files.credential;
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(Buffer.isBuffer(bytes)).toBe(false);
        expect(Object.getPrototypeOf(bytes)).toBe(Uint8Array.prototype);
        expect([...bytes]).toEqual([1, 2, 3]);
        source[0] = 9;
        expect([...bytes]).toEqual([1, 2, 3]);
    });
});
