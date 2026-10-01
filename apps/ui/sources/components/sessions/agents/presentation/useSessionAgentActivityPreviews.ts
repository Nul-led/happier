import * as React from 'react';

import {
    useEnsureSidechainsLoaded,
    type SidechainHydrationStatus,
} from '@/hooks/session/useEnsureSidechainsLoaded';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { deriveSessionSubagentActivityPreview } from '@/sync/domains/session/subagents/deriveSessionSubagentActivityPreview';
import { resolveTranscriptToolCallsCollapsedPreviewCount } from '@/sync/domains/settings/transcriptToolCallsCollapsedPreviewCount';
import { useSetting } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { useSessionMessagesReducerState } from '@/sync/store/hooks';
import { t } from '@/text';

import type { SessionAgentActivityRow } from './sessionAgentActivityRows';

const EMPTY_PREVIEWS: ReadonlyMap<string, string> = new Map();

/**
 * The sidechains worth hydrating for a preview line, in the order the rows are drawn and capped by
 * the person's collapsed-preview setting: a long roster never asks for every transcript at once.
 */
function selectPreviewSidechainIds(
    rows: readonly SessionAgentActivityRow[],
    previewLimit: number,
): readonly string[] {
    if (previewLimit <= 0) return [];
    const sidechainIds = new Set<string>();
    for (const row of rows) {
        if (sidechainIds.size >= previewLimit) break;
        const sidechainId = row.subagent.transcript.sidechainId?.trim() ?? '';
        if (sidechainId) sidechainIds.add(sidechainId);
    }
    return [...sidechainIds];
}

function resolvePreviewFallback(status: SidechainHydrationStatus | undefined): string | null {
    if (status === 'loaded') return null;
    if (status === 'error' || status === 'not_ready') return t('common.unavailable');
    return t('common.loading');
}

/**
 * The one-line "what it is doing now" under each agent row (lab `convo-W1`: "Team agent · reading
 * RetryBanne…"), keyed by subagent id.
 *
 * A row whose sidechain is already loaded reads its latest step straight from the reducer; the first
 * few unloaded ones (in draw order) are hydrated on demand and say "Loading" meanwhile, never a
 * guessed line.
 */
export function useSessionAgentActivityPreviews(params: Readonly<{
    sessionId: string;
    serverId: string | null;
    session: Session | null;
    /** The rows as drawn, top to bottom; the order decides which sidechains are hydrated first. */
    rows: readonly SessionAgentActivityRow[];
}>): ReadonlyMap<string, string> {
    const accountScopeResolution = useServerCredentialAccountScopeResolution(params.serverId);
    const accountScope = params.serverId === null ? undefined
        : accountScopeResolution.kind === 'bound' ? accountScopeResolution.scope : null;
    const reducerState = useSessionMessagesReducerState(params.sessionId);
    const collapsedPreviewCount = useSetting('transcriptToolCallsCollapsedPreviewCount');
    const previewSidechainIds = React.useMemo(
        () => selectPreviewSidechainIds(params.rows, resolveTranscriptToolCallsCollapsedPreviewCount(collapsedPreviewCount)),
        [collapsedPreviewCount, params.rows],
    );
    const previewSidechainIdSet = React.useMemo(() => new Set(previewSidechainIds), [previewSidechainIds]);
    const sidechainHydration = useEnsureSidechainsLoaded({
        enabled: previewSidechainIds.length > 0,
        sessionId: params.sessionId,
        sidechainIds: previewSidechainIds,
    });

    return React.useMemo(() => {
        if (params.rows.length === 0) return EMPTY_PREVIEWS;
        const previews = new Map<string, string>();
        for (const { subagent } of params.rows) {
            const preview = deriveSessionSubagentActivityPreview({
                accountScope,
                subagent,
                reducerState,
                session: params.session,
            });
            if (preview) {
                previews.set(subagent.id, preview);
                continue;
            }
            const sidechainId = subagent.transcript.sidechainId?.trim() ?? '';
            if (!previewSidechainIdSet.has(sidechainId)) continue;
            const fallback = resolvePreviewFallback(sidechainHydration.bySidechainId[sidechainId]?.status);
            if (fallback) previews.set(subagent.id, fallback);
        }
        return previews;
    }, [accountScope, params.rows, params.session, previewSidechainIdSet, reducerState, sidechainHydration.bySidechainId]);
}
