import * as React from 'react';
import { I18nManager, Platform, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SurfaceCard } from '@/components/ui/cards/SurfaceCard';
import { Icon } from '@/components/ui/icons/Icon';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { resolveSessionAwarenessContentLabel } from '@/sync/domains/session/awareness/sessionAwarenessContentLabels';
import { t } from '@/text';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';

import type { SessionCompanionDensity } from '../state/sessionCompanionPreference';
import {
    resolveSessionSummaryRows,
    type SessionSummaryCardModel,
    type SessionSummaryDestination,
    type SessionSummaryRow,
} from './sessionSummaryProjection';
import {
    resolveSessionSummaryApprovalEmphasisMotion,
    shouldEmphasizeNewSessionSummaryApproval,
} from './sessionSummaryApprovalEmphasis';

/**
 * The first-party Session Summary card.
 *
 * Every value comes from the pure projection; this component only renders it and
 * routes each row to the EXISTING owning surface. A row whose destination has no
 * handler renders as quiet text rather than a dead pressable, and the card never
 * mutates Git, approvals, goals or usage inline.
 */

export type SessionSummaryDestinationHandlers =
    Partial<Readonly<Record<SessionSummaryDestination, () => void>>>;

const stylesheet = StyleSheet.create((theme) => ({
    root: { gap: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titleWrap: { flex: 1, minWidth: 0, gap: 2 },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.primary, fontSize: 15 },
    agent: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 12 },
    rows: { gap: 2 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 28,
        borderRadius: 8,
        paddingHorizontal: 6,
        marginHorizontal: -6,
    },
    rowPressed: { backgroundColor: theme.colors.surface.pressed },
    rowLabel: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 13, flex: 1, minWidth: 0 },
    rowLabelLead: { ...Typography.default('semiBold'), color: theme.colors.text.primary },
    rowValue: { ...Typography.tabular(), color: theme.colors.text.secondary, fontSize: 13 },
    footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    footerLabel: { ...Typography.default(), color: theme.colors.text.link, fontSize: 13, flex: 1 },
    stale: { ...Typography.default(), color: theme.colors.text.tertiary, fontSize: 12 },
    staleValue: { opacity: 0.7 },
}));

function operationalPresentation(value: SessionSummaryCardModel['operational']): Readonly<{
    label: string;
    variant: StatusPillVariant;
}> | null {
    switch (value) {
        case null: return null;
        case 'failed': return { label: t('status.error'), variant: 'danger' };
        case 'action_required': return { label: t('status.actionRequired'), variant: 'warning' };
        case 'permission_required': return { label: t('status.permissionRequired'), variant: 'warning' };
        case 'working': return { label: t('status.working'), variant: 'info' };
        case 'ready': return { label: t('status.ready'), variant: 'success' };
        case 'pending_input': return { label: t('status.queuedInput'), variant: 'neutral' };
        case 'none': return { label: t('status.online'), variant: 'neutral' };
    }
}

type RowPresentation = Readonly<{ label: string; value: string | null; stale: boolean }>;

function rowPresentation(row: SessionSummaryRow): RowPresentation {
    switch (row.kind) {
        case 'approvals':
            return {
                label: t('sessionBoard.companion.summary.approvals', { count: row.count }),
                value: null,
                stale: false,
            };
        case 'activity':
            return {
                label: row.title ?? (row.liveCount > 0
                    ? t('tools.workflowActivityView.agentFraction', {
                        complete: row.liveCount,
                        total: row.totalCount,
                    })
                    : t('tools.workflowActivityView.agentsCount', { count: row.totalCount })),
                value: row.statusLabel ?? (row.liveCount > 0 ? t('status.working') : null),
                stale: false,
            };
        case 'work':
            return { label: row.label, value: null, stale: false };
        case 'workflow':
            return {
                label: t('sessionBoard.companion.summary.workflows', { count: row.runCount }),
                value: null,
                stale: false,
            };
        case 'workspace':
            return {
                label: row.branch ?? row.label,
                value: row.changedFiles && row.changedFiles > 0
                    ? t('sessionBoard.companion.summary.changedFiles', { count: row.changedFiles })
                    : null,
                stale: false,
            };
        case 'usage':
            return {
                label: row.tokens === null
                    ? t('sessionBoard.companion.summary.contextOnly')
                    : t('sessionBoard.companion.summary.tokens', { count: row.tokens }),
                value: row.contextPercent === null
                    ? null
                    : t('sessionBoard.companion.summary.contextPercent', { percent: Math.round(row.contextPercent) }),
                stale: row.stale,
            };
    }
}

const SummaryRow = React.memo(function SummaryRow(props: Readonly<{
    row: SessionSummaryRow;
    onPress?: (() => void) | undefined;
    emphasized: boolean;
    approvalEmphasisSignal: number;
    reducedMotion: boolean;
    testID: string;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const presentation = rowPresentation(props.row);
    const emphasis = useSharedValue(1);
    React.useEffect(() => {
        if (props.row.kind !== 'approvals' || props.approvalEmphasisSignal === 0) return;
        const motion = resolveSessionSummaryApprovalEmphasisMotion(props.reducedMotion);
        emphasis.value = motion.initialOpacity;
        if (motion.durationMs > 0) {
            emphasis.value = withTiming(1, {
                duration: motion.durationMs,
                easing: motionTokens.easing.emphasized,
            });
        }
    }, [emphasis, props.approvalEmphasisSignal, props.reducedMotion, props.row.kind]);
    const emphasisStyle = useAnimatedStyle(() => ({ opacity: emphasis.value }));
    const accessibilityLabel = presentation.value
        ? `${presentation.label}, ${presentation.value}`
        : presentation.label;

    const body = (
        <>
            <Text
                numberOfLines={1}
                style={[
                    styles.rowLabel,
                    props.emphasized ? styles.rowLabelLead : null,
                    presentation.stale ? styles.staleValue : null,
                ]}
            >
                {presentation.label}
            </Text>
            {presentation.value ? (
                <Text style={[styles.rowValue, presentation.stale ? styles.staleValue : null]}>
                    {presentation.value}
                </Text>
            ) : null}
            {props.onPress ? (
                <Icon
                    name="caret-right"
                    size={14}
                    color={theme.colors.text.tertiary}
                    mirrored={I18nManager.isRTL}
                />
            ) : null}
        </>
    );

    const row = props.onPress ? (
        <Pressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={props.onPress}
            style={({ pressed }) => [
                styles.row,
                { minHeight: resolveMinimumInteractiveTargetSize(Platform.OS) },
                pressed && styles.rowPressed,
            ]}
        >
            {body}
        </Pressable>
    ) : (
        <View style={styles.row} testID={props.testID}>{body}</View>
    );
    return (
        <Animated.View
            style={emphasisStyle}
            testID={`${props.testID}-emphasis`}
        >
            {row}
        </Animated.View>
    );
});

export const SessionSummaryCard = React.memo(function SessionSummaryCard(props: Readonly<{
    model: SessionSummaryCardModel;
    density: SessionCompanionDensity;
    presentation?: 'card' | 'full';
    destinations?: SessionSummaryDestinationHandlers;
    /** Opens the full Companion, where every omitted row stays reachable. */
    onOpenFullSurface?: () => void;
    testID?: string;
}>) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const reducedMotion = useReducedMotionPreference();
    const testID = props.testID ?? 'session-companion-summary';
    const minimumInteractiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    // Content/current-realm unavailability is the stronger canonical truth.
    // Do not pair it with an "Online" or work pill inferred from unreadable facts.
    const status = props.model.scope === 'exact' && props.model.availability !== 'locked'
        ? operationalPresentation(props.model.operational)
        : null;
    const visible = React.useMemo(
        () => resolveSessionSummaryRows(
            props.model,
            props.presentation === 'full' || !props.onOpenFullSurface
                ? { kind: 'full' }
                : { kind: 'card', density: props.density },
        ),
        [props.density, props.model, props.onOpenFullSurface, props.presentation],
    );
    const approvalCount = React.useMemo(() => (
        props.model.rows.find((row) => row.kind === 'approvals')?.count ?? 0
    ), [props.model.rows]);
    const previousApprovalCountRef = React.useRef<number | null>(null);
    const [approvalEmphasisSignal, setApprovalEmphasisSignal] = React.useState(0);
    React.useEffect(() => {
        const previous = previousApprovalCountRef.current;
        previousApprovalCountRef.current = approvalCount;
        if (shouldEmphasizeNewSessionSummaryApproval(previous, approvalCount)) {
            setApprovalEmphasisSignal((signal) => signal + 1);
        }
    }, [approvalCount]);
    const identityPress = props.destinations?.sessionInfo;
    const title = props.model.title ?? t('sessionBoard.companion.summary.untitled');
    const availabilityLabel = props.model.scope === 'realm_unavailable'
        ? t('sessionBoard.board.unavailable.reason')
        : props.model.availability === 'locked'
        ? resolveSessionAwarenessContentLabel(props.model.encryption) ?? t('status.encryptedUnavailable')
        : null;

    const identityLines = (
        <>
            <Text numberOfLines={1} style={styles.title}>{title}</Text>
            {props.model.agentLabel ? (
                <Text numberOfLines={1} style={styles.agent}>{props.model.agentLabel}</Text>
            ) : null}
        </>
    );

    return (
        <SurfaceCard testID={testID} tone="surface" padding="md">
            {/* A group, not one element: each row below stays individually reachable. */}
            <View style={styles.root} accessibilityRole="summary">
                <View style={styles.titleRow}>
                    {/*
                      * A heading with nowhere to go is a heading, not a control
                      * that happens to be off. `disabled` on this element made a
                      * screen reader announce the session's own name as dimmed
                      * and unavailable.
                      */}
                    {identityPress ? (
                        <Pressable
                            testID={`${testID}-identity`}
                            style={[
                                styles.titleWrap,
                                {
                                    minHeight: minimumInteractiveTargetSize,
                                    justifyContent: 'center',
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={status ? `${title}, ${status.label}` : title}
                            onPress={identityPress}
                        >
                            {identityLines}
                        </Pressable>
                    ) : (
                        <View
                            testID={`${testID}-identity`}
                            style={styles.titleWrap}
                            accessibilityRole="header"
                            accessibilityLabel={status ? `${title}, ${status.label}` : title}
                        >
                            {identityLines}
                        </View>
                    )}
                    {status ? (
                        <StatusPill
                            testID={`${testID}-status`}
                            label={status.label}
                            variant={status.variant}
                            hideDot
                            labelVariant="micro"
                        />
                    ) : null}
                </View>

                {visible.rows.length > 0 ? (
                    <View style={styles.rows}>
                        {visible.rows.map((row, index) => (
                            <SummaryRow
                                key={row.kind}
                                row={row}
                                emphasized={index === 0}
                                approvalEmphasisSignal={row.kind === 'approvals' ? approvalEmphasisSignal : 0}
                                reducedMotion={reducedMotion}
                                testID={`${testID}-row-${row.kind}`}
                                onPress={props.destinations?.[row.destination]}
                            />
                        ))}
                    </View>
                ) : null}

                {visible.hiddenCount > 0 && props.onOpenFullSurface ? (
                    <Pressable
                        testID={`${testID}-more`}
                        accessibilityRole="button"
                        accessibilityLabel={t('sessionBoard.companion.summary.moreDetailsA11y', {
                            count: visible.hiddenCount,
                        })}
                        onPress={props.onOpenFullSurface}
                        style={({ pressed }) => [
                            styles.row,
                            { minHeight: resolveMinimumInteractiveTargetSize(Platform.OS) },
                            pressed && styles.rowPressed,
                        ]}
                    >
                        <Text style={styles.footerLabel}>{t('sessionBoard.companion.summary.moreDetails')}</Text>
                        <Icon
                            name="caret-right"
                            size={14}
                            color={theme.colors.text.link}
                            mirrored={I18nManager.isRTL}
                        />
                    </Pressable>
                ) : null}

                {availabilityLabel ? (
                    <Text testID={`${testID}-availability`} style={styles.stale}>{availabilityLabel}</Text>
                ) : null}
                {props.model.stale ? (
                    <Text style={styles.stale}>{t('sessionBoard.board.stale')}</Text>
                ) : null}
                {props.model.availability === 'partial' ? (
                    <Text style={styles.stale}>{t('sessionBoard.companion.summary.partial')}</Text>
                ) : null}
            </View>
        </SurfaceCard>
    );
});
