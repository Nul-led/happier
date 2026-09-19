import * as React from 'react';
import { useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { useRouter } from 'expo-router';

import {
    useEnsureSidechainsLoaded,
    type SidechainHydrationStatus,
} from '@/hooks/session/useEnsureSidechainsLoaded';
import { useSessionAgentActivityRoster } from '@/hooks/session/useSessionAgentActivity';
import { useSetting } from '@/sync/domains/state/storage';
import { useSessionMessagesReducerState } from '@/sync/store/hooks';
import { deriveSessionSubagentActivityPreview } from '@/sync/domains/session/subagents/deriveSessionSubagentActivityPreview';
import { partitionAgentActivityEntriesByLiveness } from '@/sync/domains/session/agentActivity';
import {
    readSessionAgentActivityRows,
    type SessionAgentActivityRow,
} from '@/components/sessions/agents/presentation/sessionAgentActivityRows';
import { useAppPaneScope } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { t } from '@/text';
import { useDeviceType } from '@/utils/platform/responsive';
import type { SessionSubagent } from '@/sync/domains/session/subagents/types';
import {
    createSessionTeammateLauncherDetailsTab,
    hasSessionTeammateLauncher,
} from '@/agents/registry/sessionSubagentUiBehavior';

import { createSessionSubagentDetailsTab } from '@/components/sessions/agents/navigation/createSessionSubagentDetailsTab';
import { resolveSessionSubagentFullRoute } from '@/components/sessions/agents/navigation/resolveSessionSubagentFullRoute';
import { resolveSessionSubagentAdvancedRoute } from '@/components/sessions/agents/navigation/resolveSessionSubagentAdvancedRoute';
import { SessionSubagentList } from '@/components/sessions/agents/list/SessionSubagentList';
import { SessionSubagentLaunchSection } from '@/components/sessions/agents/launch/SessionSubagentLaunchSection';
import { resolveTranscriptToolCallsCollapsedPreviewCount } from '@/sync/domains/settings/transcriptToolCallsCollapsedPreviewCount';
import { useSessionViewShellSession } from '@/components/sessions/shell/sessionViewStableSession';

const stylesheet = StyleSheet.create(() => ({
    container: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
    scroll: {
        flex: 1,
        minHeight: 0,
        minWidth: 0,
    },
    content: {
        paddingHorizontal: 12,
        paddingVertical: 12,
        gap: 16,
    },
}));

function deriveRightPanelPreviewSidechainIds(params: Readonly<{
    activeRows: readonly SessionAgentActivityRow[];
    recentRows: readonly SessionAgentActivityRow[];
    previewLimit: number;
}>): readonly string[] {
    if (params.previewLimit <= 0) return [];

    const sidechainIds = new Set<string>();
    const append = (subagent: SessionSubagent) => {
        if (sidechainIds.size >= params.previewLimit) return;
        const sidechainId = typeof subagent.transcript.sidechainId === 'string'
            ? subagent.transcript.sidechainId.trim()
            : '';
        if (!sidechainId) return;
        sidechainIds.add(sidechainId);
    };

    for (const row of params.activeRows) append(row.subagent);
    for (const row of params.recentRows) append(row.subagent);
    return [...sidechainIds];
}

function resolveRightPanelPreviewFallback(status: SidechainHydrationStatus | undefined): string | null {
    if (status === 'loaded') return null;
    if (status === 'error' || status === 'not_ready') return t('common.unavailable');
    return t('common.loading');
}

export const SessionRightPanelAgentsView = React.memo((props: Readonly<{
    sessionId: string;
    scopeId: string;
    /** The Session pane's exact Home; never infer it from a same-id live cache entry. */
    serverId?: string | null;
}>) => {
    const styles = stylesheet;
    const router = useRouter();
    const deviceType = useDeviceType();
    const pane = useAppPaneScope(props.scopeId);
    const session = useSessionViewShellSession(props.sessionId, props.serverId);
    const sessionServerId = props.serverId ?? session?.serverId ?? null;
    const accountScopeResolution = useServerCredentialAccountScopeResolution(sessionServerId);
    const accountScope = sessionServerId === null ? undefined
        : accountScopeResolution.kind === 'bound' ? accountScopeResolution.scope : null;
    const reducerState = useSessionMessagesReducerState(props.sessionId);
    const transcriptToolCallsCollapsedPreviewCount = useSetting('transcriptToolCallsCollapsedPreviewCount');
    // The enriched width: this pane already pays for the transcript, so it is the one surface that
    // can observe a permission prompt — the only way a row reaches `waiting`.
    const { entries, readSubagentForEntry, subagents } = useSessionAgentActivityRoster({
        sessionId: props.sessionId,
        serverId: sessionServerId ?? undefined,
        session,
    });

    // Both sections are cut from the MERGED status, so a row the publisher has already reported
    // finished leaves the live section without waiting for its tool result to arrive.
    const liveness = React.useMemo(() => partitionAgentActivityEntriesByLiveness(entries), [entries]);
    // Entry + local row pairs, not a roster of subagents plus side maps: the entry is the
    // canonical status and attention, the subagent is the operational handle a control
    // needs. That pairing is what removed this pane's `pendingPermissionById` index and,
    // with it, its local reinterpretation of `waiting` as "needs approval".
    const activeRows = React.useMemo(
        () => readSessionAgentActivityRows(liveness.live, readSubagentForEntry),
        [liveness.live, readSubagentForEntry],
    );
    const recentRows = React.useMemo(
        () => readSessionAgentActivityRows(liveness.finished, readSubagentForEntry),
        [liveness.finished, readSubagentForEntry],
    );
    const previewSidechainIds = React.useMemo(() => {
        return deriveRightPanelPreviewSidechainIds({
            activeRows,
            recentRows,
            previewLimit: resolveTranscriptToolCallsCollapsedPreviewCount(transcriptToolCallsCollapsedPreviewCount),
        });
    }, [activeRows, recentRows, transcriptToolCallsCollapsedPreviewCount]);
    const previewSidechainIdsSet = React.useMemo(() => new Set(previewSidechainIds), [previewSidechainIds]);
    const sidechainHydration = useEnsureSidechainsLoaded({
        enabled: previewSidechainIds.length > 0,
        sessionId: props.sessionId,
        sidechainIds: previewSidechainIds,
    });
    const activityPreviewById = React.useMemo(() => {
        const previews = new Map<string, string>();
        for (const subagent of subagents) {
            const preview = deriveSessionSubagentActivityPreview({
                accountScope,
                subagent,
                reducerState,
                session,
            });
            if (preview) {
                previews.set(subagent.id, preview);
                continue;
            }
            const sidechainId = typeof subagent.transcript.sidechainId === 'string'
                ? subagent.transcript.sidechainId.trim()
                : '';
            if (!previewSidechainIdsSet.has(sidechainId)) continue;
            const fallback = resolveRightPanelPreviewFallback(sidechainHydration.bySidechainId[sidechainId]?.status);
            if (fallback) previews.set(subagent.id, fallback);
        }
        return previews;
    }, [accountScope, previewSidechainIdsSet, reducerState, session, sidechainHydration.bySidechainId, subagents]);
    const openFull = React.useCallback((subagent: SessionSubagent) => {
        const route = resolveSessionSubagentFullRoute({
            sessionId: props.sessionId,
            serverId: sessionServerId,
            subagent,
        });
        if (!route) return;
        router.push(route as any);
    }, [props.sessionId, router, sessionServerId]);
    const openPreview = React.useCallback((subagent: SessionSubagent) => {
        const fullRoute = resolveSessionSubagentFullRoute({
            sessionId: props.sessionId,
            serverId: sessionServerId,
            subagent,
        });
        if (deviceType === 'phone' || !subagent.capabilities.canOpen) {
            if (fullRoute) router.push(fullRoute as any);
            return;
        }
        pane.openDetailsTab(createSessionSubagentDetailsTab(subagent), { intent: 'preview' });
    }, [deviceType, pane, props.sessionId, router, sessionServerId]);
    const openAdvanced = React.useCallback((subagent: SessionSubagent) => {
        const route = resolveSessionSubagentAdvancedRoute({
            sessionId: props.sessionId,
            serverId: sessionServerId,
            subagent,
        });
        if (!route) return;
        router.push(route as any);
    }, [props.sessionId, router, sessionServerId]);
    const openProviderTeammateLauncher = React.useCallback((teamId: string) => {
        const tab = createSessionTeammateLauncherDetailsTab({
            session,
            teamId,
        });
        if (!tab) return;
        pane.openDetailsTab(tab, { intent: 'preview' });
    }, [pane, session]);
    const onLaunchTeammate = hasSessionTeammateLauncher(session) ? openProviderTeammateLauncher : null;

    return (
        <View style={styles.container}>
            <ScrollView
                testID="session-rightpanel-agents-scroll"
                style={styles.scroll}
                contentContainerStyle={styles.content}
            >
                <SessionSubagentLaunchSection sessionId={props.sessionId} serverId={sessionServerId} scopeId={props.scopeId} session={session} subagents={subagents} />
                <SessionSubagentList
                    sessionId={props.sessionId}
                    serverId={sessionServerId}
                    testID="session-agents-section-active"
                    title={t('session.subagents.panel.active')}
                    emptyLabel={t('session.subagents.panel.emptyActive')}
                    rows={activeRows}
                    activityPreviewById={activityPreviewById}
                    onOpenPreview={openPreview}
                    onOpenFull={openFull}
                    onOpenAdvanced={openAdvanced}
                    onLaunchTeammate={onLaunchTeammate}
                />
                <SessionSubagentList
                    sessionId={props.sessionId}
                    serverId={sessionServerId}
                    testID="session-agents-section-recent"
                    title={t('session.subagents.panel.recent')}
                    emptyLabel={t('session.subagents.panel.emptyRecent')}
                    rows={recentRows}
                    activityPreviewById={activityPreviewById}
                    onOpenPreview={openPreview}
                    onOpenFull={openFull}
                    onOpenAdvanced={openAdvanced}
                    onLaunchTeammate={onLaunchTeammate}
                />
            </ScrollView>
        </View>
    );
});
