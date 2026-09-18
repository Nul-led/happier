import type {
    TeamCredentialUsageBreakdownDimensionV1,
    TeamCredentialUsageQueryResultV1,
} from '@happier-dev/protocol/teams';

import {
    buildUsageCsvDocument,
    exportUsageCsvDocument,
    formatUsageExportFileTimestamp,
} from '@/components/settings/usage/usageExportFile';
import { resolveDisplayCost } from '@/sync/api/account/usageAnalytics';

/**
 * One shared credential's recorded usage, as a file.
 *
 * The export carries the same measurement provenance the screen shows, because
 * a spreadsheet outlives the screen: a reader who only has the file must still
 * be able to tell a brokered request count from a partial one, and an unpriced
 * period from a free one. Nothing here recomputes a total — every number is the
 * Home's own answer, resolved through the same cost owner the screen uses.
 */
export type TeamCredentialUsageExportInput = Readonly<{
    resourceName: string;
    result: TeamCredentialUsageQueryResultV1;
    startMs: number;
    endMs: number;
    /** The dimension whose ranked slices are in `result.breakdown`, if any. */
    breakdown: TeamCredentialUsageBreakdownDimensionV1 | null;
}>;

function requestCell(result: TeamCredentialUsageQueryResultV1, requestCount: number): string {
    return result.coverage.requestCountCoverage === 'brokered_only' && requestCount === 0
        ? ''
        : String(requestCount);
}

function tokenCell(result: TeamCredentialUsageQueryResultV1, tokenCount: number): string {
    return result.coverage.tokenCoverage === 'unavailable'
        || (result.coverage.tokenCoverage === 'partial' && tokenCount === 0)
        ? ''
        : String(tokenCount);
}

function costCell(
    result: TeamCredentialUsageQueryResultV1,
    cost: TeamCredentialUsageQueryResultV1['totals']['cost'],
): string {
    const resolved = resolveDisplayCost(cost);
    // A period the Home could not price has no cost, which is not the same
    // number as zero; an empty cell keeps that distinction in the file.
    return result.coverage.costCoverage === 'unavailable'
        || (result.coverage.costCoverage === 'partial' && resolved === 0)
        ? ''
        : String(resolved);
}

export function buildTeamCredentialUsageCsv(input: TeamCredentialUsageExportInput): string {
    const { result } = input;
    const deliveryProvenance = result.coverage.directRecordedUseOnly
        ? 'historical_direct'
        : 'recorded_by_happier';
    const common = [
        deliveryProvenance,
        result.coverage.requestCountCoverage,
        result.coverage.tokenCoverage,
        result.coverage.costCoverage,
        String(result.coverage.requestAdmissionCount),
        String(result.coverage.agentObservationCount),
        String(result.coverage.externalTerminalObservationCount),
        String(result.coverage.unobservedExternalRequestCount),
    ];
    return buildUsageCsvDocument([
        [
            'resource', 'range_start_utc', 'range_end_utc', 'scope', 'dimension', 'key', 'label',
            'requests', 'tokens', 'cost', 'currency',
            'delivery_provenance', 'request_count_coverage', 'token_coverage', 'cost_coverage',
            'request_admission_count', 'agent_observation_count', 'external_terminal_observation_count',
            'unobserved_external_request_count',
        ],
        [
            input.resourceName,
            new Date(input.startMs).toISOString(),
            new Date(input.endMs).toISOString(),
            'total',
            '',
            '',
            '',
            requestCell(result, result.coverage.requestAdmissionCount),
            tokenCell(result, result.totals.tokens.total),
            costCell(result, result.totals.cost),
            result.totals.cost.currency,
            ...common,
        ],
        ...(input.breakdown === null ? [] : (result.breakdown ?? []).map((entry) => [
            input.resourceName,
            new Date(input.startMs).toISOString(),
            new Date(input.endMs).toISOString(),
            'breakdown',
            input.breakdown ?? '',
            entry.key,
            entry.label ?? '',
            requestCell(result, entry.totals.requestCount),
            tokenCell(result, entry.totals.tokens.total),
            costCell(result, entry.totals.cost),
            entry.totals.cost.currency,
            ...common,
        ])),
    ]);
}

export async function exportTeamCredentialUsageCsv(
    input: TeamCredentialUsageExportInput,
): Promise<boolean> {
    return await exportUsageCsvDocument({
        csv: buildTeamCredentialUsageCsv(input),
        fileName: `team-credential-usage-${formatUsageExportFileTimestamp(new Date())}.csv`,
    });
}
