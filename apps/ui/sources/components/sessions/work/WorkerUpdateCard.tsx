import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type { WorkerUpdateV1 } from '@happier-dev/protocol';

import { hasAgentIconMark } from '@/agents/catalog/catalog';
import { AgentIcon } from '@/agents/registry/AgentIcon';
import { useSessionTranscriptSource } from '@/components/sessions/transcript/source/SessionTranscriptSourceContext';
import { buildSessionExecutionRunRouteHref } from '@/components/sessions/agents/navigation/buildSessionExecutionRunRouteHref';
import { resolveExecutionRunBackendLabel } from '@/components/sessions/runs/resolveExecutionRunBackendLabel';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { SurfaceCard } from '@/components/ui/cards/SurfaceCard';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { resolveWorkStatusTone } from '@/components/work/status/resolveWorkStatusTone';
import { describeWorkStatusBucket } from '@/components/work/status/workStatusBuckets';
import { workStatusSurfaceStyle, workStatusWordStyle } from '@/components/work/status/workStatusTreatment';
import { Typography } from '@/constants/Typography';
import { buildScopedSessionRouteHref } from '@/hooks/session/sessionRouteServerScope';
import { useSessionDisplayNameSource } from '@/sync/domains/state/storage';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';
import { formatShortRelativeTime } from '@/utils/time/formatShortRelativeTime';

const MARK_SIZE = 15;

function readOwnerWord(update: WorkerUpdateV1): string {
    if (update.workerKind === 'workflow_run') return t(`workflows.runState.${update.ownerState}`);
    switch (update.ownerState) {
        case 'settled': return t('sessionWork.workerUpdate.settled');
        case 'needs_input': return describeWorkStatusBucket('needs_you');
        case 'stalled': return t('sessionWork.workerUpdate.stalled');
        case 'published': return t('sessionWork.workerUpdate.published');
        case 'timeout': return t('sessionAgentActivity.status.timedOut');
        case 'failed': return t('workflows.runState.failed');
        case 'cancelled': return t('workflows.runState.cancelled');
        case 'succeeded': return t('workflows.runState.succeeded');
    }
}

const KIND_LABEL_KEYS = {
    session: 'sessionWork.kinds.session',
    execution_run: 'sessionWork.kinds.backgroundRun',
    workflow_run: 'sessionWork.kinds.workflowRun',
} as const satisfies Record<WorkerUpdateV1['workerKind'], string>;

/** A run has no agent of its own to show, so it is marked by its kind (Work rows use the same glyphs). */
const KIND_GLYPHS = {
    session: 'sparkle',
    execution_run: 'play-circle',
    workflow_run: 'stack-simple',
} as const satisfies Record<WorkerUpdateV1['workerKind'], IconName>;

/** A session worker is named by its own title when this device knows it; a run by its producer's headline. */
function useWorkerTitle(update: WorkerUpdateV1, serverId: string | null | undefined): string {
    const source = useSessionDisplayNameSource(update.workerKind === 'session' ? update.workerId : '', serverId);
    return update.workerKind === 'session' && source ? getSessionName(source, serverId) : update.headline;
}

const WorkerMark = React.memo(function WorkerMark(props: Readonly<{ update: WorkerUpdateV1 }>) {
    const { theme } = useUnistyles();
    const agentId = props.update.workerKind === 'session' ? props.update.engine?.agentId ?? null : null;
    if (agentId && hasAgentIconMark(agentId, theme)) return <AgentIcon agentId={agentId} size={MARK_SIZE} />;
    return <Icon name={KIND_GLYPHS[props.update.workerKind]} size={MARK_SIZE} color={theme.colors.text.secondary} />;
});

/**
 * One transcript card for host worker updates and retained historical completions (ORC §3.2, lab
 * `cards-T1`/`T2`): head (mark · worker · state word · kind · age), the result, then a footer of facts
 * with the inspect action. Healthy updates stay neutral; the tone owner rings and tints the ones
 * that need the person. Ids never show: the inspect action carries the pointer.
 */
export function WorkerUpdateCard(props: Readonly<{
    update: WorkerUpdateV1;
    serverId?: string | null;
    navigationEnabled?: boolean;
    /** When the update reached the transcript; drives the head's age. */
    at?: number;
    /** Replaces the result body while retaining the shared head, footer and inspection. */
    children?: React.ReactNode;
    /** Extra footer facts a caller owns (a PR, a review outcome), before the card's own. */
    facts?: React.ReactNode;
}>) {
    const transcriptSource = useSessionTranscriptSource();
    const { update } = props;
    const title = useWorkerTitle(update, props.serverId);
    const status = resolveWorkStatusTone({ kind: 'worker_update', facts: { update, word: readOwnerWord(update) } });
    const engine = update.engine;
    const engineLabel = engine ? resolveExecutionRunBackendLabel({ kind: 'backend', backendId: engine.agentId }) ?? engine.agentId : null;
    const age = props.at === undefined ? '' : formatShortRelativeTime(props.at);
    const kindLabel = age ? `${t(KIND_LABEL_KEYS[update.workerKind])} · ${age}` : t(KIND_LABEL_KEYS[update.workerKind]);
    const pointer = update.transcriptPointer;
    const inspectLabel = pointer?.kind === 'session' ? t('runs.openSession') : t('runs.openRun');
    const canInspect = update.canInspect && props.navigationEnabled !== false && transcriptSource.navigate !== null && pointer !== undefined;
    const inspect = () => {
        if (!canInspect || !pointer) return;
        if (pointer.kind === 'workflow_run') {
            const query = props.serverId ? `?serverId=${encodeURIComponent(props.serverId)}` : '';
            transcriptSource.navigate?.(`/workflows/runs/${encodeURIComponent(pointer.runId)}${query}`);
            return;
        }
        const href = pointer.kind === 'session'
            ? buildScopedSessionRouteHref({ sessionId: pointer.sessionId, serverId: props.serverId })
            : buildSessionExecutionRunRouteHref({ sessionId: pointer.sessionId, runId: pointer.runId, serverId: props.serverId });
        if (href) transcriptSource.navigate?.(href);
    };
    const body = props.children === undefined
        ? (update.result ? <Text testID="worker-update-result" selectable style={styles.result}>{update.result}</Text> : null)
        : props.children;
    const hasFooter = props.facts !== undefined || engine !== undefined || update.truncated === true || canInspect;
    return (
        <SurfaceCard testID={`worker-update:${update.workerId}`} tone="muted" padding="none" style={workStatusSurfaceStyle(status.tone)}>
            <View style={[styles.head, body ? null : styles.headAlone]}>
                <WorkerMark update={update} />
                <Text testID="worker-update-title" numberOfLines={1} style={styles.title}>{title}</Text>
                <Text testID="worker-update-state" numberOfLines={1} style={[styles.word, workStatusWordStyle(status.tone)]}>{status.word}</Text>
                <View style={styles.grow} />
                <Text testID="worker-update-kind" numberOfLines={1} style={styles.kind}>{kindLabel}</Text>
            </View>
            {body ? <View style={styles.body}>{body}</View> : null}
            {hasFooter ? (
                <View testID="worker-update-footer" style={styles.footer}>
                    {props.facts}
                    {engine ? <Text testID="worker-update-engine" numberOfLines={1} style={styles.fact}>{engineLabel}{engine.modelId ? ` · ${engine.modelId}` : ''}</Text> : null}
                    {update.truncated ? <Text testID="worker-update-truncated" numberOfLines={1} style={styles.fact}>{t('sessionWork.workerUpdate.truncated')}</Text> : null}
                    <View style={styles.grow} />
                    {canInspect ? <RoundButton testID="worker-update-inspect" size="small" display="inverted" title={inspectLabel} onPress={inspect} /> : null}
                </View>
            ) : null}
        </SurfaceCard>
    );
}

const styles = StyleSheet.create((theme) => ({
    head: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        paddingHorizontal: theme.margins.md,
        paddingTop: theme.margins.md,
        paddingBottom: theme.margins.xs,
    },
    title: {
        ...Typography.rowTitle(),
        color: theme.colors.text.primary,
        flexShrink: 1,
    },
    word: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
        flexShrink: 1,
    },
    headAlone: {
        paddingBottom: theme.margins.md,
    },
    grow: {
        flexGrow: 1,
    },
    kind: {
        ...Typography.rowMeta(),
        ...Typography.tabular(),
        color: theme.colors.text.tertiary,
        flexShrink: 1,
    },
    body: {
        paddingHorizontal: theme.margins.md,
        paddingBottom: theme.margins.md,
    },
    result: {
        ...Typography.default(),
        color: theme.colors.text.primary,
    },
    footer: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: theme.margins.sm,
        minWidth: 0,
        paddingLeft: theme.margins.md,
        paddingRight: theme.margins.sm,
        paddingVertical: theme.margins.xs,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: theme.colors.border.default,
    },
    fact: {
        ...Typography.rowMeta(),
        color: theme.colors.text.secondary,
        flexShrink: 1,
    },
}));
