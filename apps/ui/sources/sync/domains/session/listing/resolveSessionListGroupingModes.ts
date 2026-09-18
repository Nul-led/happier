import {
    normalizeSessionListGroupingModeV1,
    normalizeSessionListSectionModeV1,
    resolveSessionListLayoutApplicability,
    resolveSessionListLayoutChoice,
    type SessionListGroupingMode,
    type SessionListSectionMode,
} from './sessionListLayout';

export type { SessionListGroupingMode, SessionListSectionMode } from './sessionListLayout';

type SessionListGroupingModeParams = Readonly<{
    activeGroupingV1?: SessionListGroupingMode;
    inactiveGroupingV1?: SessionListGroupingMode;
    sectionModeV1?: SessionListSectionMode;
}>;

/**
 * Resolves the effective grouping from the canonical current settings enums.
 *
 * The released Protocol schema still parses the predecessor
 * `groupInactiveSessionsByProject` Boolean and its compatibility migration seeds
 * `sessionListInactiveGroupingV1` from it, but the runtime layout decision consumes
 * only the canonical current enums: a contradictory legacy value never wins, and a
 * missing canonical value resolves to the Protocol default (`date`).
 */
export function resolveSessionListGroupingModes(params: SessionListGroupingModeParams): Readonly<{
    activeGrouping: SessionListGroupingMode;
    inactiveGrouping: SessionListGroupingMode;
    sectionMode: SessionListSectionMode;
}> {
    return {
        activeGrouping: normalizeSessionListGroupingModeV1(params.activeGroupingV1),
        inactiveGrouping: params.inactiveGroupingV1 === 'project' ? 'project' : 'date',
        sectionMode: normalizeSessionListSectionModeV1(params.sectionModeV1),
    };
}

export function usesProjectGroupingInSessionList(params: SessionListGroupingModeParams): boolean {
    const groupingModes = resolveSessionListGroupingModes(params);
    return resolveSessionListLayoutApplicability({
        choice: resolveSessionListLayoutChoice({
            sessionListSectionModeV1: groupingModes.sectionMode,
            sessionListActiveGroupingV1: groupingModes.activeGrouping,
        }),
        activeGroupingV1: groupingModes.activeGrouping,
        inactiveGroupingV1: groupingModes.inactiveGrouping,
    }).usesProjectGrouping;
}
