import { describe, expect, it } from 'vitest';
import type { TeamCredentialUsageQueryResultV1 } from '@happier-dev/protocol/teams';

import { buildTeamCredentialUsageCsv } from './teamCredentialUsageExport';

const NO_TOKENS = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
const NO_COST = { reportedUsd: 0, estimatedUsd: 0, currency: 'USD' };

function result(overrides?: Partial<TeamCredentialUsageQueryResultV1>): TeamCredentialUsageQueryResultV1 {
    return {
        v: 1,
        totals: {
            eventCount: 4,
            requestCount: 12,
            tokens: { ...NO_TOKENS, total: 4200 },
            cost: { ...NO_COST, estimatedUsd: 3.5 },
        },
        coverage: {
            requestAdmissionCount: 12,
            agentObservationCount: 4,
            externalTerminalObservationCount: 0,
            directRecordedUseOnly: false,
            requestCountCoverage: 'complete',
            tokenCoverage: 'complete',
            costCoverage: 'complete',
            unobservedExternalRequestCount: 0,
        },
        series: [],
        nextCursor: null,
        limits: [],
        ...overrides,
    } as TeamCredentialUsageQueryResultV1;
}

function rows(csv: string): string[][] {
    return csv.trim().split('\n').map((line) => line.split(','));
}

describe('buildTeamCredentialUsageCsv', () => {
    it('carries the measurement provenance the screen showed into the file', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            result: result(),
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: null,
        });

        const [header, total] = rows(csv);
        expect(header).toContain('delivery_provenance');
        expect(header).toContain('request_count_coverage');
        // A spreadsheet outlives the screen: without provenance the reader
        // would take a partial brokered count for complete Team spend.
        expect(total?.[header?.indexOf('delivery_provenance') ?? -1]).toBe('recorded_by_happier');
        expect(total?.[header?.indexOf('request_count_coverage') ?? -1]).toBe('complete');
        expect(total?.[header?.indexOf('requests') ?? -1]).toBe('12');
    });

    it('does not export historical direct-use totals as complete after delivery becomes broker-only', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            result: result({
                coverage: {
                    requestAdmissionCount: 12,
                    agentObservationCount: 4,
                    externalTerminalObservationCount: 0,
                    directRecordedUseOnly: true,
                    requestCountCoverage: 'brokered_only',
                    tokenCoverage: 'partial',
                    costCoverage: 'partial',
                    unobservedExternalRequestCount: 0,
                },
            }),
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: null,
        });

        const [header, total] = rows(csv);
        expect(total?.[header?.indexOf('delivery_provenance') ?? -1]).toBe('historical_direct');
        expect(total?.[header?.indexOf('request_count_coverage') ?? -1]).toBe('brokered_only');
    });

    it('leaves an unpriced period empty rather than writing it as zero spend', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            result: result({
                totals: {
                    eventCount: 1,
                    requestCount: 3,
                    tokens: { ...NO_TOKENS, total: 100 },
                    cost: { ...NO_COST },
                },
                coverage: {
                    requestAdmissionCount: 3,
                    agentObservationCount: 1,
                    externalTerminalObservationCount: 0,
                    directRecordedUseOnly: false,
                    requestCountCoverage: 'complete',
                    tokenCoverage: 'complete',
                    costCoverage: 'partial',
                    unobservedExternalRequestCount: 0,
                },
            }),
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: null,
        });

        const [header, total] = rows(csv);
        expect(total?.[header?.indexOf('cost') ?? -1]).toBe('');
        expect(total?.[header?.indexOf('cost_coverage') ?? -1]).toBe('partial');
    });

    it('writes no request column for a resource whose use Happier never admits', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: null,
            result: result({
                totals: {
                    eventCount: 0,
                    requestCount: 0,
                    tokens: NO_TOKENS,
                    cost: NO_COST,
                },
                coverage: {
                    requestAdmissionCount: 0,
                    agentObservationCount: 0,
                    externalTerminalObservationCount: 0,
                    directRecordedUseOnly: true,
                    requestCountCoverage: 'brokered_only',
                    tokenCoverage: 'unavailable',
                    costCoverage: 'unavailable',
                    unobservedExternalRequestCount: 0,
                },
            }),
        });

        const [header, total] = rows(csv);
        expect(total?.[header?.indexOf('requests') ?? -1]).toBe('');
        expect(total?.[header?.indexOf('delivery_provenance') ?? -1]).toBe('historical_direct');
    });

    it('exports request-only external admission without false token or cost zeroes', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            result: result({
                totals: {
                    eventCount: 3,
                    requestCount: 3,
                    tokens: NO_TOKENS,
                    cost: NO_COST,
                },
                coverage: {
                    requestAdmissionCount: 3,
                    agentObservationCount: 0,
                    externalTerminalObservationCount: 0,
                    directRecordedUseOnly: false,
                    requestCountCoverage: 'complete',
                    tokenCoverage: 'unavailable',
                    costCoverage: 'unavailable',
                    unobservedExternalRequestCount: 3,
                },
            }),
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: null,
        });

        const [header, total] = rows(csv);
        expect(total?.[header.indexOf('requests')]).toBe('3');
        expect(total?.[header.indexOf('tokens')]).toBe('');
        expect(total?.[header.indexOf('cost')]).toBe('');
        expect(total?.[header.indexOf('unobserved_external_request_count')]).toBe('3');
    });

    it('exports the ranked slices of the dimension the reader is looking at', () => {
        const csv = buildTeamCredentialUsageCsv({
            resourceName: 'Acme Claude',
            result: result({
                breakdown: [{
                    key: 'account-maya',
                    label: 'Maya Chen',
                    totals: {
                        eventCount: 2,
                        requestCount: 7,
                        tokens: { ...NO_TOKENS, total: 900 },
                        cost: { ...NO_COST, estimatedUsd: 1.25 },
                    },
                }],
            }),
            startMs: Date.UTC(2026, 7, 15),
            endMs: Date.UTC(2026, 8, 14),
            breakdown: 'member',
        });

        const parsed = rows(csv);
        const header = parsed[0] ?? [];
        const slice = parsed[2] ?? [];
        expect(parsed).toHaveLength(3);
        expect(slice[header.indexOf('scope')]).toBe('breakdown');
        expect(slice[header.indexOf('dimension')]).toBe('member');
        expect(slice[header.indexOf('key')]).toBe('account-maya');
        expect(slice[header.indexOf('label')]).toBe('Maya Chen');
        expect(slice[header.indexOf('cost')]).toBe('1.25');
    });
});
