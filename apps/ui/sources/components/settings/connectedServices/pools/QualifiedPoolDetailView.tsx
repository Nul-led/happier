import * as React from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useSharedValue } from 'react-native-reanimated';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { SurfaceAsOfLabel } from '@/components/ui/surfaces/SurfaceAsOfLabel';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { IconButton } from '@/components/ui/buttons/IconButton';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/forms/dropdown/DropdownMenu';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { FieldItem } from '@/components/ui/forms/FieldItem';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { PageHeaderMarkTile } from '@/components/ui/layout/PageHeaderEntityParts';
import { AttentionBanner } from '@/components/ui/lists/AttentionBanner';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { SectionContentRow } from '@/components/ui/lists/SectionContentRow';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import {
    DEFAULT_REORDER_ROW_HEIGHT,
    useListInlineReorder,
} from '@/components/ui/lists/useListInlineReorder';
import { SurfaceFreshnessLine } from '@/components/ui/surfaces/SurfaceFreshnessLine';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { Text } from '@/components/ui/text/Text';
import {
    TREE_DROP_OVERLAY_KIND_NONE,
    type TreeDropOverlayKind,
    type TreeDropOverlaySharedValues,
} from '@/components/ui/treeDragDrop';
import { Typography } from '@/constants/Typography';
import { buildSummaryMeters } from '@/sync/domains/connectedServices/connectedServiceQuotaBadges';
import type { ConnectedAccountIdentityPresenter } from '@/hooks/ui/useConnectedAccountIdentityPrivacy';
import type { UseQualifiedConnectedAccountGroupsResult } from '@/hooks/server/connectedServices/useQualifiedConnectedAccountGroups';
import { Modal } from '@/modal';
import { formatResetCountdown } from '@/sync/domains/connectedServices/formatResetCountdown';
import { resolveQuotaMeterTone } from '@/sync/domains/connectedServices/resolveQuotaTone';
import { isPoolUsageLimitSwitchEnabled } from '@/sync/domains/connectedServices/connectedServicePoolPolicy';
import { projectConnectedServiceQuotaSnapshotForLimitSelection } from '@/sync/domains/connectedServices/projectConnectedServiceQuotaSnapshotForLimitSelection';
import {
    type QualifiedConnectedAccountUiGroup,
    type QualifiedConnectedAccountUiGroupMember,
} from '@/sync/domains/connectedServices/qualifiedConnectedAccountUiSource';
import { reorderConnectedServicePoolMembersV1, sameQualifiedConnectedAccountGroupRef } from '@happier-dev/protocol';
import {
    presentQualifiedConnectedAccountTarget,
    type QualifiedConnectedAccountPresentationAccount,
} from '@/sync/domains/connectedServices/qualifiedConnectedAccountTargetPresentation';
import { t } from '@/text';
import { formatAsOfTime } from '@/utils/time/formatAsOfTime';
import { formatResetAtTime } from '@/utils/time/formatResetAtTime';
import {
    resolveConnectedServiceQuotaMeterLimitIdentity,
    type ConnectedServiceAuthGroupPolicyV1,
    type ConnectedServiceQuotaSnapshotV1,
    type QualifiedConnectedAccountQuotaSnapshotV4,
    type QualifiedConnectedAccountRef,
} from '@happier-dev/protocol';

import { ACCOUNT_BLOCK_GAUGE_LABEL_FORMATTER } from '../account/accountBlockFormatters';
import { AgentDefaultMenuButton } from '../defaults/AgentDefaultMenuButton';
import type { AgentDefaultChoice } from '../defaults/agentDefaultChoices';
import { UsageMeterRow, UsageMeterStack } from '../usage/UsageMeterRow';
import { PoolMembersDropOverlay } from './PoolMembersDropOverlay';
import { PoolMembersSelectField, type PoolMembershipCandidate } from './PoolMembersSelectField';
import { PoolMemberRow, type PoolMemberNote, type PoolMemberUsage } from './PoolMemberRow';
import { PoolQuotaLimitsSelectField, type PoolQuotaLimitCandidate } from './PoolQuotaLimitsSelectField';
import { computePoolMembershipDiff } from './poolMembershipDiff';
import { derivePoolUsage, resolvePoolNextMember, type PoolUsage } from './derivePoolUsage';

type GroupStrategy = ConnectedServiceAuthGroupPolicyV1['strategy'];
type GroupRecoveryMode = ConnectedServiceAuthGroupPolicyV1['recoveryMode'];
type SwitchOnKey = keyof ConnectedServiceAuthGroupPolicyV1['switchOn'];
type QuotaSnapshot = ConnectedServiceQuotaSnapshotV1 | QualifiedConnectedAccountQuotaSnapshotV4;

const SWITCH_ON_KEYS: ReadonlyArray<SwitchOnKey> = ['usageLimit', 'authExpired', 'accountChanged', 'refreshFailure'];
const RECOVERY_MODES: ReadonlyArray<GroupRecoveryMode> = ['switch_or_wait', 'switch_then_resume', 'wait_until_reset', 'off'];
const TEST_ID = 'connected-services-pool-detail';
const EMPTY_LABELS: Readonly<Record<string, string | undefined>> = Object.freeze({});
const EMPTY_USAGE: Readonly<Record<string, PoolMemberQuota>> = Object.freeze({});
/** Advanced rows under the disclosure: restore, switch when, stale probe, two switch limits, recovery, prompts. */
const ADVANCED_SETTING_COUNT = 7;
/** Width at which the pool meter can carry the wide reset column (label, bar, value, "next in … · 14:20"). */
const LEFT_WIDE_MIN_WIDTH_PX = 520;
/** The member drop overlay measures against this container; the lifted row must not be clipped. */
const MEMBERS_REORDER_CONTAINER_STYLE = { position: 'relative', overflow: 'visible' } as const;

const identityPresenter: ConnectedAccountIdentityPresenter = (input) => ({
    label: input.label ?? null,
    email: input.email ?? null,
    accountId: input.accountId ?? null,
});

/** An account of this service, eligible for pool membership. */
export type QualifiedPoolDetailAccount = QualifiedConnectedAccountPresentationAccount & Readonly<{
    status?: unknown;
}>;

/** One member's usage as the batched quota owner holds it. */
export type PoolMemberQuota = Readonly<{
    snapshot: QuotaSnapshot | null;
    loading: boolean;
}>;

/**
 * The mutation surface this view drives, satisfied by `useQualifiedConnectedAccountGroups` (the one
 * pool read/mutation owner). Every mutation returns the UPDATED group or `null`; sequential
 * mutations thread the returned group into the next call.
 */
export type QualifiedPoolDetailMutations = Pick<
    UseQualifiedConnectedAccountGroupsResult,
    'mutating' | 'patch' | 'patchMember' | 'addMember' | 'removeMember' | 'setActiveAccount' | 'delete'
>;

export type QualifiedPoolDetailViewProps = Readonly<{
    group: QualifiedConnectedAccountUiGroup;
    /** Every account of this service (members and non-members alike). */
    accounts: ReadonlyArray<QualifiedPoolDetailAccount>;
    accountLabels?: Readonly<Record<string, string | undefined>>;
    serviceLabel: string;
    mutations: QualifiedPoolDetailMutations;
    /** `false` when the server or runtime cannot honor automatic fallback. */
    fallbackControlsEnabled?: boolean;
    fallbackDisabledSubtitle?: string;
    /** Explicit server permission combined with the applied service descriptor. */
    autoQuotaResetEnabled?: boolean;
    /** Explicit server permission for model-entitlement auto-disable policy. */
    autoDisablePlanInvalidEnabled?: boolean;
    /** Explicit negotiated permission to author a per-pool quota-family policy. */
    quotaLimitSelectionEnabled?: boolean;
    /** Each member's usage, keyed by account id, from the batched quota owner. */
    memberQuotaByAccountId?: Readonly<Record<string, PoolMemberQuota>>;
    /** The one identity presenter (privacy); defaults to showing identities as given. */
    presentIdentity?: ConnectedAccountIdentityPresenter;
    /** ★: the agents that sign in through this service and whether this pool is their default. */
    agentDefaults?: Readonly<{ choices: readonly AgentDefaultChoice[]; setDefault: (agentId: string, makeDefault: boolean) => void }> | null;
    onOpenAccount?: (account: QualifiedConnectedAccountRef) => void;
    /** Latest failure reported by the mutation owner; a rejected change must not fail silently. */
    error?: string | null;
    onShareWithTeam?: () => void;
    sharedWithTeamsAdministration?: React.ReactNode;
    /** Clock for countdowns; the live page passes nothing. */
    now?: number;
    /** Fixture frames (PLa) open these as the lab shows them. */
    initialAdvancedExpanded?: boolean;
    initialManageMembersOpen?: boolean;
}>;

function sortMembersByPriority(
    members: ReadonlyArray<QualifiedConnectedAccountUiGroupMember>,
): ReadonlyArray<QualifiedConnectedAccountUiGroupMember> {
    return [...members].sort((left, right) => (
        left.priority !== right.priority
            ? left.priority - right.priority
            : left.ref.accountId.localeCompare(right.ref.accountId)
    ));
}

function humanizeProviderLimitId(providerLimitId: string): string {
    return providerLimitId
        .split(/[_-]+/g)
        .filter(Boolean)
        .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function formatQuotaWindowDuration(durationMs: number): string {
    const totalMinutes = Math.max(1, Math.round(durationMs / 60_000));
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    return `${minutes}m`;
}

/** The "Usage limits that count" choices, from what the members that are on report. */
export function buildPoolQuotaLimitCandidates(input: Readonly<{
    snapshots: ReadonlyArray<QuotaSnapshot>;
    selectedProviderLimitIds: readonly string[];
    enabledMemberCount: number;
}>): PoolQuotaLimitCandidate[] {
    const evidenceById = new Map<string, {
        labels: Set<string>;
        meterIds: Set<string>;
        windowDurationsByMeterId: Map<string, number | null>;
        modelIds: Set<string>;
        reportingMembers: Set<number>;
    }>();
    for (const [snapshotIndex, snapshot] of input.snapshots.entries()) {
        for (const meter of snapshot.meters) {
            const id = resolveConnectedServiceQuotaMeterLimitIdentity(meter);
            const evidence = evidenceById.get(id) ?? {
                labels: new Set<string>(),
                meterIds: new Set<string>(),
                windowDurationsByMeterId: new Map<string, number | null>(),
                modelIds: new Set<string>(),
                reportingMembers: new Set<number>(),
            };
            const label = meter.label.trim().replace(/\s+[·•]\s+(Primary|Secondary)$/i, '').trim();
            if (label) evidence.labels.add(label);
            evidence.meterIds.add(meter.meterId);
            const duration = meter.windowDurationMs ?? null;
            const existingDuration = evidence.windowDurationsByMeterId.get(meter.meterId);
            evidence.windowDurationsByMeterId.set(
                meter.meterId,
                existingDuration === undefined || existingDuration === duration ? duration : null,
            );
            const modelId = meter.modelId?.trim();
            if (modelId) evidence.modelIds.add(modelId);
            evidence.reportingMembers.add(snapshotIndex);
            evidenceById.set(id, evidence);
        }
    }
    const candidates: PoolQuotaLimitCandidate[] = Array.from(evidenceById, ([providerLimitId, evidence]) => {
        const labels = Array.from(evidence.labels).sort((left, right) => (
            right.length - left.length || left.localeCompare(right)
        ));
        const providerLabel = labels.find((label) => label.toLowerCase() !== 'unknown') ?? null;
        const opaque = providerLabel === null && labels.some((label) => label.toLowerCase() === 'unknown');
        const windowDurations = Array.from(evidence.windowDurationsByMeterId.values());
        const windowSummary = windowDurations.length > 0 && windowDurations.every((duration) => duration !== null)
            ? Array.from(new Set(windowDurations as number[]))
                .sort((left, right) => left - right)
                .map(formatQuotaWindowDuration)
                .join(' + ')
            : null;
        return {
            providerLimitId,
            title: opaque
                ? t('connectedServices.detail.groupDetail.quotaLimitProviderAllowanceTitle')
                : providerLabel ?? humanizeProviderLimitId(providerLimitId),
            modelIds: Array.from(evidence.modelIds).sort(),
            windowCount: evidence.meterIds.size,
            windowSummary,
            reportingMemberCount: evidence.reportingMembers.size,
            enabledMemberCount: input.enabledMemberCount,
            ...(opaque ? { technicalId: providerLimitId } : {}),
        };
    });
    for (const providerLimitId of input.selectedProviderLimitIds) {
        if (evidenceById.has(providerLimitId)) continue;
        candidates.push({
            providerLimitId,
            title: humanizeProviderLimitId(providerLimitId),
            modelIds: [],
            windowCount: 0,
            windowSummary: null,
            reportingMemberCount: 0,
            enabledMemberCount: input.enabledMemberCount,
            technicalId: providerLimitId,
            unavailable: true,
        });
    }
    return candidates.sort((left, right) => left.title.localeCompare(right.title));
}

function resolveRecoveryModeLabel(mode: GroupRecoveryMode): string {
    if (mode === 'off') return t('connectedServices.detail.groupDetail.recoveryModeOffSubtitle');
    if (mode === 'wait_until_reset') return t('connectedServices.detail.groupDetail.recoveryModeWaitUntilResetSubtitle');
    if (mode === 'switch_then_resume') return t('connectedServices.detail.groupDetail.recoveryModeSwitchThenResumeSubtitle');
    return t('connectedServices.detail.groupDetail.recoveryModeSwitchOrWaitSubtitle');
}

function resolveSwitchOnLabel(key: SwitchOnKey): string {
    if (key === 'usageLimit') return t('connectedServices.pools.behavior.switchOn.usageLimit');
    if (key === 'authExpired') return t('connectedServices.pools.behavior.switchOn.authExpired');
    if (key === 'accountChanged') return t('connectedServices.pools.behavior.switchOn.accountChanged');
    return t('connectedServices.pools.behavior.switchOn.refreshFailure');
}

function isRecoveryMode(value: string): value is GroupRecoveryMode {
    return (RECOVERY_MODES as readonly string[]).includes(value);
}

function isStale(snapshot: QuotaSnapshot, now: number): boolean {
    return now > snapshot.fetchedAt + snapshot.staleAfterMs;
}

/** An integer typed in place, kept inside its bounds; the saved value comes back when refused. */
function parseBoundedInteger(draft: string, min: number, max: number): number | null {
    const value = Number(draft.trim());
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) return null;
    return value;
}

/**
 * The pool page (lab `csvc` PL/PLa/PLS, round 3): who is in use and what happens when it runs out,
 * what is left across the pool, the members with their own meters (order, active member, on/off),
 * how it chooses (Behavior and Advanced, every policy field the pool owner has), who uses it, and
 * delete. Presentational: the group, accounts, members' usage and the one mutation owner arrive as
 * props, so the dev fixture renders the same view without touching a real account.
 */
export const QualifiedPoolDetailView = React.memo(function QualifiedPoolDetailView(
    props: QualifiedPoolDetailViewProps,
) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { accounts, group, mutations } = props;
    const now = props.now ?? Date.now();
    const present = props.presentIdentity ?? identityPresenter;
    const fallbackControlsEnabled = props.fallbackControlsEnabled ?? true;
    const fallbackDisabledSubtitle = fallbackControlsEnabled ? undefined : props.fallbackDisabledSubtitle;
    const memberQuota = props.memberQuotaByAccountId ?? EMPTY_USAGE;
    const accountLabels = props.accountLabels ?? EMPTY_LABELS;
    const [advancedExpanded, setAdvancedExpanded] = React.useState(props.initialAdvancedExpanded === true);
    const [membersMenuOpen, setMembersMenuOpen] = React.useState(props.initialManageMembersOpen === true);
    const [recoveryOpen, setRecoveryOpen] = React.useState(false);
    const [moreOpen, setMoreOpen] = React.useState(false);
    /** The pool meter shows the reset clock ("· 14:20") only where the row has room for it. */
    const [leftWide, setLeftWide] = React.useState(true);
    const onLeftLayout = React.useCallback((event: LayoutChangeEvent) => {
        const width = event.nativeEvent.layout.width;
        if (!Number.isFinite(width) || width <= 0) return;
        const next = width >= LEFT_WIDE_MIN_WIDTH_PX;
        setLeftWide((current) => (current === next ? current : next));
    }, []);
    /** Account ids in the order a drop just produced, held only while the priority patches run. */
    const [optimisticOrder, setOptimisticOrder] = React.useState<ReadonlyArray<string> | null>(null);

    const overlayVisible = useSharedValue(0);
    const overlayKind = useSharedValue<TreeDropOverlayKind>(TREE_DROP_OVERLAY_KIND_NONE);
    const overlayTop = useSharedValue(0);
    const overlayHeight = useSharedValue(0);
    const overlayLeft = useSharedValue(0);
    const overlayRight = useSharedValue(0);
    const overlayDepth = useSharedValue(0);
    const overlayShared = React.useMemo<TreeDropOverlaySharedValues>(() => ({
        overlayVisible, overlayKind, overlayTop, overlayHeight, overlayLeft, overlayRight, overlayDepth,
    }), [overlayDepth, overlayHeight, overlayKind, overlayLeft, overlayRight, overlayTop, overlayVisible]);

    const label = React.useMemo(() => presentQualifiedConnectedAccountTarget({
        target: { kind: 'group', service: group.ref.service, groupId: group.ref.groupId },
        accounts,
        groups: [group],
        labelsByKey: EMPTY_LABELS,
        serviceTitle: props.serviceLabel,
    }).primaryLabel, [accounts, group, props.serviceLabel]);

    /** One identity per account: the canonical presenter's name, then the privacy presenter over name and email. */
    const identityOf = React.useCallback((accountId: string) => {
        const presentation = presentQualifiedConnectedAccountTarget({
            target: { kind: 'account', account: { service: group.ref.service, accountId } },
            accounts,
            groups: [group],
            labelsByKey: EMPTY_LABELS,
            accountLabel: accountLabels[accountId],
            serviceTitle: props.serviceLabel,
        });
        const account = accounts.find((candidate) => candidate.ref.accountId === accountId);
        const rawEmail = account?.providerIdentity?.email?.trim() || null;
        // The whole page is one service, so the identity line is the email alone, and only when the
        // name is not already the email (an account nobody named is called by its email).
        const email = rawEmail && rawEmail !== presentation.primaryLabel ? rawEmail : null;
        const shown = present({ label: presentation.primaryLabel, labelKind: presentation.primaryLabelKind, email });
        return { name: shown.label ?? presentation.primaryLabel, email: shown.email };
    }, [accountLabels, accounts, group, present, props.serviceLabel]);

    const sortedMembers = React.useMemo(() => {
        const byPriority = sortMembersByPriority(group.members);
        if (!optimisticOrder) return byPriority;
        const byAccountId = new Map(byPriority.map((member) => [member.ref.accountId, member]));
        const ordered = optimisticOrder
            .map((accountId) => byAccountId.get(accountId))
            .filter((member): member is QualifiedConnectedAccountUiGroupMember => member != null);
        const seen = new Set(ordered.map((member) => member.ref.accountId));
        return [...ordered, ...byPriority.filter((member) => !seen.has(member.ref.accountId))];
    }, [group.members, optimisticOrder]);
    const memberItems = React.useMemo(() => sortedMembers.map((member) => ({ id: member.ref.accountId })), [sortedMembers]);
    const memberAccountIds = React.useMemo(() => sortedMembers.map((member) => member.ref.accountId), [sortedMembers]);

    /** Snapshots as the pool counts them: only the limits the pool is told to count. */
    const countedSnapshotByAccountId = React.useMemo(() => {
        const byId: Record<string, QuotaSnapshot | null> = {};
        for (const member of group.members) {
            byId[member.ref.accountId] = projectConnectedServiceQuotaSnapshotForLimitSelection(
                memberQuota[member.ref.accountId]?.snapshot ?? null,
                group.policy.quotaLimitSelection,
            );
        }
        return byId;
    }, [group.members, group.policy.quotaLimitSelection, memberQuota]);

    const usage: PoolUsage = React.useMemo(() => derivePoolUsage({
        now,
        members: group.members.map((member) => ({
            accountId: member.ref.accountId,
            enabled: member.enabled,
            meters: countedSnapshotByAccountId[member.ref.accountId]?.meters ?? null,
        })),
    }), [countedSnapshotByAccountId, group.members, now]);

    const nextAccountId = React.useMemo(() => resolvePoolNextMember({
        strategy: group.policy.strategy,
        activeAccountId: group.activeAccountId,
        members: group.members.map((member) => ({ accountId: member.ref.accountId, enabled: member.enabled, priority: member.priority })),
        roomByAccountId: usage.roomByAccountId,
        lowestRemainingByAccountId: usage.lowestRemainingByAccountId,
    }), [group.activeAccountId, group.members, group.policy.strategy, usage]);

    /** Persist a dropped order: applied locally once, then one priority patch per moved member. */
    const commitOrder = React.useCallback(async (orderedAccountIds: ReadonlyArray<string>) => {
        setOptimisticOrder([...orderedAccountIds]);
        try {
            await reorderConnectedServicePoolMembersV1({
                group, accountIds: orderedAccountIds,
                members: (current) => current.members.map((member) => ({ accountId: member.ref.accountId, priority: member.priority })),
                patch: (current, accountId, priority) => {
                    const member = current.members.find((candidate) => candidate.ref.accountId === accountId)!;
                    return mutations.patchMember({ group: current, account: member.ref, priority });
                },
            });
        } finally {
            setOptimisticOrder(null);
        }
    }, [group, mutations]);

    const reorder = useListInlineReorder({
        items: memberItems,
        enabled: sortedMembers.length > 1,
        overlayShared,
        onCommitOrder: commitOrder,
        fallbackRowHeight: DEFAULT_REORDER_ROW_HEIGHT,
    });

    const moveMember = React.useCallback((accountId: string, direction: -1 | 1) => {
        const order = sortedMembers.map((member) => member.ref.accountId);
        const index = order.indexOf(accountId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= order.length) return;
        const next = [...order];
        next.splice(index, 1);
        next.splice(target, 0, accountId);
        void commitOrder(next);
    }, [commitOrder, sortedMembers]);

    const patchPolicy = React.useCallback(async (policy: Partial<ConnectedServiceAuthGroupPolicyV1>) => {
        if (!fallbackControlsEnabled) return;
        await mutations.patch({ group, policy });
    }, [fallbackControlsEnabled, group, mutations]);

    const [nameDraftState, setNameDraft] = React.useState<Readonly<{ ref: QualifiedConnectedAccountUiGroup['ref']; value: string }> | null>(null);
    const nameDraft = nameDraftState && sameQualifiedConnectedAccountGroupRef(nameDraftState.ref, group.ref)
        ? nameDraftState.value
        : null;
    if (nameDraftState && nameDraft === null) setNameDraft(null);
    const rename = React.useCallback(() => {
        if (!mutations.mutating) setNameDraft({ ref: group.ref, value: group.displayName?.trim() ?? '' });
    }, [group.displayName, mutations.mutating]);
    const saveName = React.useCallback(async () => {
        if (nameDraft === null || mutations.mutating) return;
        if (await mutations.patch({ group, displayName: nameDraft.trim() || null })) setNameDraft(null);
    }, [group, mutations, nameDraft]);

    const setMemberEnabled = React.useCallback((account: QualifiedConnectedAccountRef, enabled: boolean) => {
        void mutations.patchMember({ group, account, enabled });
    }, [group, mutations]);

    const setActiveMember = React.useCallback((account: QualifiedConnectedAccountRef) => {
        // The caller owns the runtime-cooldown override prompt: `setActiveAccount` rethrows it so one
        // owner decides whether to retry.
        void mutations.setActiveAccount({ group, account });
    }, [group, mutations]);

    const removeMember = React.useCallback(async (account: QualifiedConnectedAccountRef) => {
        const ok = await Modal.confirm(
            t('connectedServices.detail.groupActions.removeMemberConfirmTitle'),
            t('connectedServices.detail.groupActions.removeMemberConfirmBody', { profileId: identityOf(account.accountId).name }),
            {
                confirmText: t('connectedServices.detail.groupActions.removeMember'),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!ok) return;
        await mutations.removeMember({ group, account });
    }, [group, identityOf, mutations]);

    const membershipCandidates = React.useMemo<ReadonlyArray<PoolMembershipCandidate>>(
        () => accounts.map((account) => {
            const identity = identityOf(account.ref.accountId);
            return {
                accountId: account.ref.accountId,
                title: identity.name,
                ...(identity.email ? { subtitle: identity.email } : {}),
            };
        }),
        [accounts, identityOf],
    );

    /** Apply a membership change: removals first, then adds, threading the returned group. */
    const commitMembership = React.useCallback(async (nextSelectedAccountIds: ReadonlyArray<string>) => {
        const { toAdd, toRemove } = computePoolMembershipDiff(memberAccountIds, nextSelectedAccountIds);
        let current = group;
        for (const accountId of toRemove) {
            const member = current.members.find((candidate) => candidate.ref.accountId === accountId);
            if (!member) continue;
            const next = await mutations.removeMember({ group: current, account: member.ref });
            if (!next) return;
            current = next;
        }
        for (const accountId of toAdd) {
            const account = accounts.find((candidate) => candidate.ref.accountId === accountId);
            if (!account) continue;
            const next = await mutations.addMember({ group: current, account: account.ref });
            if (!next) return;
            current = next;
        }
    }, [accounts, group, memberAccountIds, mutations]);

    const deletePool = React.useCallback(async () => {
        const ok = await Modal.confirm(
            t('connectedServices.pools.delete.confirmTitle'),
            t('connectedServices.pools.delete.confirmMessage', { name: label }),
            {
                confirmText: t('connectedServices.pools.delete.title'),
                cancelText: t('common.cancel'),
                destructive: true,
            },
        );
        if (!ok) return;
        await mutations.delete(group);
    }, [group, label, mutations]);

    const enabledMembers = group.members.filter((member) => member.enabled);
    const enabledCount = enabledMembers.length;
    const memberCount = group.members.length;
    const activeMember = group.members.find((member) => member.ref.accountId === group.activeAccountId) ?? null;
    const activeName = activeMember ? identityOf(activeMember.ref.accountId).name : null;
    const nextName = nextAccountId ? identityOf(nextAccountId).name : null;
    const nextMember = nextAccountId ? group.members.find((member) => member.ref.accountId === nextAccountId) ?? null : null;
    const agentDefaultTitles = (props.agentDefaults?.choices ?? []).filter((choice) => choice.isDefault).map((choice) => choice.title);

    // ── Now: who is in use, and what happens when it runs out ──
    const waiting = usage.firstBack !== null;
    const onlyOneOn = memberCount > 1 && enabledCount === 1;
    const firstOff = onlyOneOn
        ? sortedMembers.find((member) => !member.enabled && member.state.autoDisabledReason !== 'model_not_entitled') ?? null
        : null;
    let nowTitle: string;
    let nowDetail: string;
    let nowAction: Readonly<{ label: string; onPress: () => void; testID: string }> | null = null;
    if (waiting && usage.firstBack) {
        nowTitle = t('connectedServicesPool.allWaitingTitle');
        const first = usage.firstBack;
        const waits = group.policy.recoveryMode !== 'off';
        nowDetail = `${t('connectedServicesPool.allWaitingFirst', {
            name: identityOf(first.accountId).name,
            time: formatResetAtTime(first.atMs, now),
            countdown: formatResetCountdown(now, first.atMs, ACCOUNT_BLOCK_GAUGE_LABEL_FORMATTER) ?? '',
        })} ${waits ? t('connectedServicesPool.sessionsWait') : t('connectedServicesPool.sessionsStop')}`;
    } else if (!activeName) {
        nowTitle = t('connectedServicesPool.noActive');
        nowDetail = t('connectedServicesPool.noActiveDetail');
    } else {
        nowTitle = group.activeSince
            ? t('connectedServicesPool.usingSince', { name: activeName, time: formatAsOfTime(group.activeSince.atMs, now) })
            : t('connectedServicesPool.using', { name: activeName });
        const lead = group.policy.strategy === 'least_limited'
            ? t('connectedServicesPool.leadLeastLimited')
            : group.policy.strategy === 'priority' ? t('connectedServicesPool.leadInOrder') : null;
        if (onlyOneOn) {
            nowDetail = t('connectedServicesPool.onlyOneOn', { name: activeName });
            if (firstOff) {
                const offName = identityOf(firstOff.ref.accountId).name;
                nowAction = {
                    label: t('connectedServicesPool.turnOn', { name: offName }),
                    onPress: () => setMemberEnabled(firstOff.ref, true),
                    testID: `${TEST_ID}:now:turn-on`,
                };
            }
        } else if (group.policy.strategy === 'manual') {
            nowDetail = t('connectedServicesPool.manualStays', { name: activeName });
        } else if (!isPoolUsageLimitSwitchEnabled(group.policy)) {
            nowDetail = `${lead ?? ''} ${t('connectedServicesPool.fallbackOff', { name: activeName })}`.trim();
        } else {
            nowDetail = `${lead ?? ''} ${nextName
                ? t('connectedServicesPool.nextOnRunOut', { name: activeName, next: nextName })
                : t('connectedServicesPool.noNextOnRunOut', { name: activeName })}`.trim();
        }
        if (!nowAction && nextMember && nextName && fallbackControlsEnabled) {
            // Switch now = the pool's one active-member writer; it moves new turns, it does not claim
            // anything about sessions already running.
            nowAction = {
                label: t('connectedServicesPool.switchTo', { name: nextName }),
                onPress: () => setActiveMember(nextMember.ref),
                testID: `${TEST_ID}:now:switch`,
            };
        }
    }

    // ── Left across the pool ──
    const loadingEnabled = enabledMembers.some((member) => memberQuota[member.ref.accountId]?.loading === true
        && !memberQuota[member.ref.accountId]?.snapshot);
    const enabledSnapshots = enabledMembers
        .map((member) => countedSnapshotByAccountId[member.ref.accountId])
        .filter((snapshot): snapshot is QuotaSnapshot => snapshot != null);
    // "As of" is when the pool was last read; a member whose own reading is old says so on its row,
    // and the section says it is behind only when every reading it averages is old.
    const lastRead = enabledSnapshots.length > 0 ? Math.max(...enabledSnapshots.map((snapshot) => snapshot.fetchedAt)) : null;
    const allStale = enabledSnapshots.length > 0 && enabledSnapshots.every((snapshot) => isStale(snapshot, now));
    const roomLine = usage.room.reporting > 0
        ? [
            t('connectedServicesPool.roomCount', { count: usage.room.withRoom, total: usage.room.reporting }),
            ...(usage.room.unreported > 0 ? [t('connectedServicesPool.notReported', { count: usage.room.unreported })] : []),
        ].join(' · ')
        : null;

    const quotaLimitSelection = group.policy.quotaLimitSelection;
    const quotaLimitCandidates = React.useMemo(() => props.quotaLimitSelectionEnabled === true
        ? buildPoolQuotaLimitCandidates({
            snapshots: group.members
                .filter((member) => member.enabled)
                .map((member) => memberQuota[member.ref.accountId]?.snapshot ?? null)
                .filter((snapshot): snapshot is QuotaSnapshot => snapshot !== null),
            enabledMemberCount: group.members.filter((member) => member.enabled).length,
            selectedProviderLimitIds: quotaLimitSelection?.mode === 'selected' ? quotaLimitSelection.providerLimitIds : [],
        })
        : [], [group.members, memberQuota, props.quotaLimitSelectionEnabled, quotaLimitSelection]);
    const quotaLoadingMemberCount = enabledMembers.filter((member) => memberQuota[member.ref.accountId]?.loading === true).length;

    const moreItems: DropdownMenuItem[] = [
        { id: 'rename', title: t('connectedServicesPool.rename') },
        ...(props.onShareWithTeam ? [{ id: 'share', title: t('teams.credentials.create.action') }] : []),
        { id: 'delete', title: t('connectedServices.pools.delete.title'), destructive: true },
    ];

    const orderedMembers = reorder.frozenItems
        .map((item) => sortedMembers.find((member) => member.ref.accountId === item.id))
        .filter((member): member is QualifiedConnectedAccountUiGroupMember => member != null);

    const manageMembers = (
        <PoolMembersSelectField
            testID={`${TEST_ID}:members-select`}
            candidates={membershipCandidates}
            selectedAccountIds={memberAccountIds}
            onCommit={(next) => { void commitMembership(next); }}
            disabled={mutations.mutating}
            open={membersMenuOpen}
            onOpenChange={setMembersMenuOpen}
            searchPlaceholder={t('connectedServicesPool.searchAccounts', { service: props.serviceLabel })}
            renderTrigger={({ toggle, disabled }) => (
                <RoundButton
                    testID={`${TEST_ID}:manage-members`}
                    size="small"
                    display="secondary"
                    title={t('connectedServicesPool.manageMembers')}
                    leading={<Icon name="users" size={14} color={theme.colors.text.primary} />}
                    disabled={disabled}
                    onPress={toggle}
                />
            )}
        />
    );

    return (
        <ItemList testID={TEST_ID}>
            <SettingsPageHeader
                testID={`${TEST_ID}:summary`}
                title={label}
                alwaysShowTitle
                leading={(
                    <PageHeaderMarkTile appearance="glyph">
                        <Icon name="stack" size={26} color={theme.colors.text.secondary} />
                    </PageHeaderMarkTile>
                )}
                titleAccessory={(
                    <IconButton
                        testID={`${TEST_ID}:rename`}
                        accessibilityLabel={t('connectedServicesPool.rename')}
                        iconName="pencil-simple"
                        variant="plain"
                        iconSize={15}
                        onPress={() => { void rename(); }}
                    />
                )}
                meta={[{
                    key: 'members',
                    text: memberCount > 0
                        ? t('connectedServicesPool.membersOn', { service: props.serviceLabel, on: enabledCount, total: memberCount })
                        : props.serviceLabel,
                }]}
                actions={(
                    <View style={styles.headerActions}>
                        {props.agentDefaults ? (
                            <AgentDefaultMenuButton
                                testID={`${TEST_ID}:default-for`}
                                choices={props.agentDefaults.choices}
                                onChange={props.agentDefaults.setDefault}
                            />
                        ) : null}
                        <DropdownMenu
                            open={moreOpen}
                            onOpenChange={setMoreOpen}
                            items={moreItems}
                            selectedId={null}
                            onSelect={(id) => {
                                if (id === 'rename') void rename();
                                if (id === 'share') props.onShareWithTeam?.();
                                if (id === 'delete') void deletePool();
                            }}
                            variant="selectable"
                            rowKind="item"
                            showCategoryTitles={false}
                            placement="bottom"
                            popoverAnchorAlign="end"
                            trigger={({ toggle }) => (
                                <IconButton
                                    testID={`${TEST_ID}:more`}
                                    accessibilityLabel={t('connectedServicesPool.moreActions')}
                                    iconName="dots-three"
                                    variant="plain"
                                    onPress={toggle}
                                />
                            )}
                        />
                    </View>
                )}
            />
            {nameDraft !== null ? (
                <ItemGroup>
                    <SectionContentRow>
                        <FieldItem label={t('connectedServices.detail.groupDetail.nameTitle')}>
                            <FieldTextInput testID={`${TEST_ID}:name-field`} value={nameDraft} onChangeText={(value) => setNameDraft({ ref: group.ref, value })} editable={!mutations.mutating} accessibilityLabel={t('connectedServices.detail.groupDetail.nameTitle')} onSubmitEditing={() => { void saveName(); }} />
                        </FieldItem>
                    </SectionContentRow>
                    <SectionContentRow>
                        <View style={styles.headerActions}>
                            <RoundButton testID={`${TEST_ID}:name-cancel`} size="small" display="secondary" title={t('common.cancel')} disabled={mutations.mutating} onPress={() => setNameDraft(null)} />
                            <RoundButton testID={`${TEST_ID}:name-save`} size="small" title={t('common.save')} disabled={mutations.mutating} onPress={() => { void saveName(); }} />
                        </View>
                    </SectionContentRow>
                </ItemGroup>
            ) : null}
            {props.error ? (
                <AttentionBanner testID={`${TEST_ID}:error`} title={t('common.error')} description={props.error} />
            ) : null}

            {memberCount > 0 ? (
                <ItemGroup>
                    <Item
                        testID={`${TEST_ID}:now`}
                        title={nowTitle}
                        subtitle={nowDetail}
                        subtitleLines={0}
                        leftElement={waiting ? <Icon name="clock" size={18} color={theme.colors.state.warning.foreground} /> : undefined}
                        rightElement={nowAction ? (
                            <RoundButton
                                testID={nowAction.testID}
                                size="small"
                                display="secondary"
                                title={nowAction.label}
                                onPress={nowAction.onPress}
                            />
                        ) : undefined}
                        rightElementOutsidePressable
                        showChevron={false}
                        accessoryLayout="adaptive"
                        mode="info"
                    />
                </ItemGroup>
            ) : null}

            {memberCount > 0 ? (
                <ItemGroup
                    title={t('connectedServicesPool.leftTitle')}
                    description={t('connectedServicesPool.leftDescription')}
                    action={lastRead !== null && !allStale ? <SurfaceAsOfLabel at={lastRead} testID={`${TEST_ID}:left:as-of`} /> : undefined}
                >
                    {allStale && lastRead !== null ? (
                        <SectionContentRow>
                            <SurfaceFreshnessLine
                                testID={`${TEST_ID}:left:stale`}
                                asOf={lastRead}
                                reason={t('connectedServicesPool.usageNotAnswering', { service: props.serviceLabel })}
                                tone="warning"
                            />
                        </SectionContentRow>
                    ) : null}
                    {usage.windows.length > 0 ? (
                        <SectionContentRow testID={`${TEST_ID}:left`}>
                            <View onLayout={onLeftLayout}>
                                <UsageMeterStack>
                                    {usage.windows.map((window) => (
                                        <UsageMeterRow
                                            key={window.meterId}
                                            testID={`${TEST_ID}:left:${window.meterId}`}
                                            label={window.label}
                                            remainingPct={window.remainingPct}
                                            resetsAt={window.resetsAt}
                                            tone={resolveQuotaMeterTone({ remainingPct: window.remainingPct, status: window.estimated ? 'estimated' : 'ok' })}
                                            now={now}
                                            size={leftWide ? 'wide' : 'default'}
                                            resetPrefix="next"
                                            estimated={window.estimated}
                                        />
                                    ))}
                                </UsageMeterStack>
                            </View>
                            {roomLine ? <Text testID={`${TEST_ID}:left:room`} style={styles.roomLine}>{roomLine}</Text> : null}
                        </SectionContentRow>
                    ) : loadingEnabled ? (
                        <SurfaceStateCard testID={`${TEST_ID}:left:loading`} size="line" kind="loading" title={t('common.loading')} />
                    ) : (
                        <SurfaceStateCard testID={`${TEST_ID}:left:none`} size="line" kind="empty" title={t('connectedServicesPool.nothingReported')} />
                    )}
                </ItemGroup>
            ) : null}

            {memberCount === 0 ? (
                <ItemGroup surface="none">
                    <SurfaceStateCard
                        testID={`${TEST_ID}:no-members`}
                        kind="empty"
                        size="details"
                        icon={<Icon name="stack" size={28} color={theme.colors.text.secondary} />}
                        title={t('connectedServicesPool.emptyTitle')}
                        reason={t('connectedServicesPool.emptyReason', { service: props.serviceLabel })}
                        action={{ label: t('connectedServicesPool.manageMembers'), onPress: () => setMembersMenuOpen(true) }}
                    />
                </ItemGroup>
            ) : null}

            <ItemGroup
                title={t('connectedServicesPool.membersTitle')}
                description={memberCount > 0 ? t('connectedServicesPool.membersDescription') : undefined}
                action={manageMembers}
                // No members: the invitation above says it; no empty sheet under the title.
                surface={memberCount > 0 ? 'sheet' : 'none'}
            >
                {memberCount > 0 ? (
                    <View style={MEMBERS_REORDER_CONTAINER_STYLE}>
                        {orderedMembers.map((member, index) => {
                            const accountId = member.ref.accountId;
                            const identity = identityOf(accountId);
                            const quota = memberQuota[accountId];
                            const snapshot = countedSnapshotByAccountId[accountId] ?? null;
                            const isActive = accountId === group.activeAccountId;
                            const plan = snapshot?.planLabel ?? null;
                            const autoOff = member.state.autoDisabledReason === 'model_not_entitled';
                            const note: PoolMemberNote | null = autoOff
                                ? { icon: 'info', text: t('connectedServicesPool.autoOffModel') }
                                : member.enabled && snapshot && isStale(snapshot, now)
                                    ? { icon: 'clock', text: t('connectedServicesPool.checkedAt', { time: formatAsOfTime(snapshot.fetchedAt, now) }) }
                                    : null;
                            const memberUsage: PoolMemberUsage = !member.enabled
                                ? { kind: 'off' }
                                : snapshot
                                    ? { kind: 'meters', meters: buildSummaryMeters(snapshot.meters, [], 'primary').slice(0, 2) }
                                    : quota?.loading ? { kind: 'loading' } : { kind: 'none' };
                            const actionId = (suffix: string) => `connected-services-pool:${group.ref.groupId}:member:${accountId}:action:${suffix}`;
                            const actions: ItemAction[] = [
                                {
                                    id: actionId('move-up'),
                                    title: t('connectedServices.pools.detail.moveUp'),
                                    icon: 'arrow-up',
                                    disabled: index === 0,
                                    onPress: index === 0 ? undefined : () => moveMember(accountId, -1),
                                },
                                {
                                    id: actionId('move-down'),
                                    title: t('connectedServices.pools.detail.moveDown'),
                                    icon: 'arrow-down',
                                    disabled: index === memberCount - 1,
                                    onPress: index === memberCount - 1 ? undefined : () => moveMember(accountId, 1),
                                },
                                {
                                    id: actionId('remove'),
                                    title: t('connectedServices.detail.groupActions.removeMember'),
                                    icon: 'minus-circle',
                                    destructive: true,
                                    onPress: () => void removeMember(member.ref),
                                },
                            ];
                            return (
                                <PoolMemberReorderRow key={accountId} accountId={accountId} reorder={reorder}>
                                    <PoolMemberRow
                                        testID={`${TEST_ID}:member:${accountId}`}
                                        title={identity.name}
                                        identityLabel={[identity.email, plan].filter(Boolean).join(' · ') || null}
                                        active={isActive}
                                        enabled={member.enabled}
                                        note={note}
                                        usage={memberUsage}
                                        now={now}
                                        onMakeActive={!isActive && fallbackControlsEnabled ? () => setActiveMember(member.ref) : null}
                                        onEnabledChange={(next) => setMemberEnabled(member.ref, next)}
                                        onOpen={props.onOpenAccount ? () => props.onOpenAccount?.(member.ref) : null}
                                        actions={actions}
                                        reorderGesture={reorder.gestureForRow(accountId, index)}
                                    />
                                </PoolMemberReorderRow>
                            );
                        })}
                        <PoolMembersDropOverlay shared={overlayShared} testID={`${TEST_ID}:drop-overlay`} />
                    </View>
                ) : null}
            </ItemGroup>

            <ItemGroup title={t('connectedServicesPool.behaviorTitle')}>
                <SegmentedChoiceItem<GroupStrategy>
                    testID={`${TEST_ID}:strategy`}
                    testIDPrefix={`${TEST_ID}:strategy`}
                    title={t('connectedServicesPool.strategyTitle')}
                    subtitle={fallbackDisabledSubtitle}
                    disabled={!fallbackControlsEnabled}
                    value={group.policy.strategy}
                    onChange={(strategy) => { void patchPolicy({ strategy }); }}
                    options={[
                        { id: 'least_limited', label: t('connectedServicesPool.strategyLeastLimited'), description: t('connectedServicesPool.strategyLeastLimitedDescription') },
                        { id: 'priority', label: t('connectedServicesPool.strategyInOrder'), description: t('connectedServicesPool.strategyInOrderDescription') },
                        { id: 'manual', label: t('connectedServicesPool.strategyManual'), description: t('connectedServicesPool.strategyManualDescription') },
                    ]}
                />
                <Item
                    testID={`${TEST_ID}:auto-switch`}
                    title={t('connectedServicesPool.fallbackTitle')}
                    subtitle={fallbackDisabledSubtitle ?? t('connectedServicesPool.fallbackDescription')}
                    disabled={!fallbackControlsEnabled}
                    rightElement={(
                        <Switch
                            testID={`${TEST_ID}:auto-switch:toggle`}
                            value={group.policy.autoSwitch}
                            onValueChange={fallbackControlsEnabled ? (autoSwitch) => { void patchPolicy({ autoSwitch }); } : undefined}
                            disabled={!fallbackControlsEnabled}
                            accessibilityLabel={t('connectedServicesPool.fallbackTitle')}
                            compact
                        />
                    )}
                    showChevron={false}
                />
                <FieldValueItem
                    testID={`${TEST_ID}:soft-switch-threshold`}
                    fieldTestID={`${TEST_ID}:soft-switch-threshold:field`}
                    title={t('connectedServicesPool.switchEarlyTitle')}
                    subtitle={t('connectedServicesPool.switchEarlyDescription')}
                    disabled={!fallbackControlsEnabled}
                    kind="integer"
                    value={String(group.policy.softSwitchRemainingPercent)}
                    onCommit={(draft) => {
                        const value = parseBoundedInteger(draft, 0, 100);
                        if (value === null) return String(group.policy.softSwitchRemainingPercent);
                        void patchPolicy({ softSwitchRemainingPercent: value });
                    }}
                />
                {props.quotaLimitSelectionEnabled === true ? (
                    <PoolQuotaLimitsSelectField
                        testID={`${TEST_ID}:quota-limits`}
                        candidates={quotaLimitCandidates}
                        selection={quotaLimitSelection}
                        loadingMemberCount={quotaLoadingMemberCount}
                        onCommit={(next) => { void patchPolicy({ quotaLimitSelection: next }); }}
                        disabled={!fallbackControlsEnabled || mutations.mutating}
                    />
                ) : null}
                {props.autoQuotaResetEnabled === true ? (
                    <Item
                        testID={`${TEST_ID}:auto-quota-reset`}
                        title={t('connectedServicesPool.autoResetsTitle')}
                        subtitle={t('connectedServicesPool.autoResetsDescription')}
                        rightElement={(
                            <Switch
                                testID={`${TEST_ID}:auto-quota-reset:toggle`}
                                value={group.policy.autoUseQuotaResetsWhenExhausted === true}
                                onValueChange={(autoUseQuotaResetsWhenExhausted) => { void patchPolicy({ autoUseQuotaResetsWhenExhausted }); }}
                                accessibilityLabel={t('connectedServicesPool.autoResetsTitle')}
                                disabled={!fallbackControlsEnabled || mutations.mutating}
                                compact
                            />
                        )}
                        showChevron={false}
                    />
                ) : null}
                {props.autoDisablePlanInvalidEnabled === true ? (
                    <Item
                        testID={`${TEST_ID}:auto-disable-plan-invalid`}
                        title={t('connectedServicesPool.autoOffTitle')}
                        subtitle={t('connectedServicesPool.autoOffDescription')}
                        rightElement={(
                            <Switch
                                testID={`${TEST_ID}:auto-disable-plan-invalid:toggle`}
                                value={group.policy.autoDisablePlanInvalidAccounts === true}
                                onValueChange={(autoDisablePlanInvalidAccounts) => { void patchPolicy({ autoDisablePlanInvalidAccounts }); }}
                                accessibilityLabel={t('connectedServicesPool.autoOffTitle')}
                                disabled={!fallbackControlsEnabled || mutations.mutating}
                                compact
                            />
                        )}
                        showChevron={false}
                    />
                ) : null}
                <ExpandableItem
                    testID={`${TEST_ID}:advanced`}
                    expanded={advancedExpanded}
                    onExpandedChange={setAdvancedExpanded}
                    header={(state) => (
                        <Item
                            testID={`${TEST_ID}:advanced:header`}
                            {...state.headerProps}
                            title={t('connectedServicesPool.advancedTitle')}
                            // A leading caret would indent every row of the section (the group aligns titles
                            // to its leading column), so the disclosure glyph trails the count.
                            detail={t('connectedServicesPool.advancedCount', { count: ADVANCED_SETTING_COUNT })}
                            rightElement={<Icon name={state.expanded ? 'caret-down' : 'caret-right'} size={14} color={theme.colors.text.secondary} />}
                            showChevron={false}
                        />
                    )}
                >
                    <Item
                        testID={`${TEST_ID}:auto-restore-primary`}
                        title={t('connectedServicesPool.restoreFirstTitle')}
                        subtitle={t('connectedServicesPool.restoreFirstDescription')}
                        disabled={!fallbackControlsEnabled}
                        rightElement={(
                            <Switch
                                testID={`${TEST_ID}:auto-restore-primary:toggle`}
                                value={group.policy.autoRestorePrimaryWhenReset}
                                onValueChange={fallbackControlsEnabled ? (autoRestorePrimaryWhenReset) => { void patchPolicy({ autoRestorePrimaryWhenReset }); } : undefined}
                                disabled={!fallbackControlsEnabled}
                                accessibilityLabel={t('connectedServicesPool.restoreFirstTitle')}
                                compact
                            />
                        )}
                        showChevron={false}
                    />
                    <Item
                        testID={`${TEST_ID}:switch-on`}
                        title={t('connectedServicesPool.switchWhenTitle')}
                        subtitle={t('connectedServicesPool.switchWhenDescription')}
                        subtitleAccessory={(
                            <View style={styles.checks} accessibilityRole="none">
                                {SWITCH_ON_KEYS.map((key) => {
                                    const checked = group.policy.switchOn[key];
                                    return (
                                        <Pressable
                                            key={key}
                                            testID={`${TEST_ID}:switch-on:${key}`}
                                            accessibilityRole="checkbox"
                                            accessibilityState={{ checked, disabled: !fallbackControlsEnabled }}
                                            accessibilityLabel={resolveSwitchOnLabel(key)}
                                            disabled={!fallbackControlsEnabled}
                                            hitSlop={6}
                                            style={styles.check}
                                            onPress={() => { void patchPolicy({ switchOn: { ...group.policy.switchOn, [key]: !checked } }); }}
                                        >
                                            <Icon
                                                name={checked ? 'check-square' : 'square'}
                                                size={18}
                                                weight={checked ? 'fill' : 'regular'}
                                                color={checked ? theme.colors.text.primary : theme.colors.text.tertiary}
                                            />
                                            <Text style={styles.checkLabel}>{resolveSwitchOnLabel(key)}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        )}
                        showChevron={false}
                        mode="info"
                    />
                    <FieldValueItem
                        testID={`${TEST_ID}:stale-probe-after`}
                        fieldTestID={`${TEST_ID}:stale-probe-after:field`}
                        title={t('connectedServicesPool.staleAfterTitle')}
                        subtitle={t('connectedServicesPool.staleAfterDescription')}
                        disabled={!fallbackControlsEnabled}
                        kind="integer"
                        value={String(Math.max(1, Math.round(group.policy.probeIfSnapshotOlderThanMs / 60_000)))}
                        onCommit={(draft) => {
                            const minutes = parseBoundedInteger(draft, 1, Number.MAX_SAFE_INTEGER);
                            if (minutes === null) return String(Math.max(1, Math.round(group.policy.probeIfSnapshotOlderThanMs / 60_000)));
                            void patchPolicy({ probeIfSnapshotOlderThanMs: minutes * 60_000 });
                        }}
                    />
                    <FieldValueItem
                        testID={`${TEST_ID}:switches-per-turn`}
                        fieldTestID={`${TEST_ID}:switches-per-turn:field`}
                        title={t('connectedServicesPool.switchesPerTurnTitle')}
                        subtitle={t('connectedServicesPool.switchLimitsDescription')}
                        disabled={!fallbackControlsEnabled}
                        kind="integer"
                        value={String(group.policy.maxSwitchesPerTurn)}
                        onCommit={(draft) => {
                            const value = parseBoundedInteger(draft, 0, Number.MAX_SAFE_INTEGER);
                            if (value === null) return String(group.policy.maxSwitchesPerTurn);
                            void patchPolicy({ maxSwitchesPerTurn: value });
                        }}
                    />
                    <FieldValueItem
                        testID={`${TEST_ID}:switches-per-hour`}
                        fieldTestID={`${TEST_ID}:switches-per-hour:field`}
                        title={t('connectedServicesPool.switchesPerHourTitle')}
                        disabled={!fallbackControlsEnabled}
                        kind="integer"
                        value={String(group.policy.maxSwitchesPerSessionHour)}
                        onCommit={(draft) => {
                            const value = parseBoundedInteger(draft, 0, Number.MAX_SAFE_INTEGER);
                            if (value === null) return String(group.policy.maxSwitchesPerSessionHour);
                            void patchPolicy({ maxSwitchesPerSessionHour: value });
                        }}
                    />
                    <DropdownMenu
                        open={recoveryOpen}
                        onOpenChange={setRecoveryOpen}
                        items={RECOVERY_MODES.map((mode) => ({ id: mode, title: resolveRecoveryModeLabel(mode) }))}
                        selectedId={group.policy.recoveryMode}
                        onSelect={(mode) => {
                            if (isRecoveryMode(mode)) void patchPolicy({ recoveryMode: mode });
                        }}
                        itemTrigger={{
                            title: t('connectedServicesPool.recoveryTitle'),
                            subtitle: t('connectedServicesPool.recoveryDescription'),
                            showSelectedDetail: true,
                            showSelectedSubtitle: false,
                            itemProps: { testID: `${TEST_ID}:recovery-mode`, disabled: !fallbackControlsEnabled },
                        }}
                        rowKind="item"
                        variant="selectable"
                    />
                    <Item
                        testID={`${TEST_ID}:recovery-prompt`}
                        title={t('connectedServicesPool.recoveryPromptsTitle')}
                        subtitle={t('connectedServicesPool.recoveryPromptsDescription')}
                        showChevron={false}
                        mode="info"
                    />
                </ExpandableItem>
            </ItemGroup>

            {props.agentDefaults ? (
                <ItemGroup title={t('connectedServicesPool.usedByTitle')}>
                    {agentDefaultTitles.length > 0 ? agentDefaultTitles.map((title) => (
                        <Item
                            key={title}
                            testID={`${TEST_ID}:used-by:${title}`}
                            title={title}
                            subtitle={t('connectedServicesPool.usedByDefault')}
                            subtitleLeading={<Icon name="star" size={11} weight="fill" color={theme.colors.text.secondary} />}
                            showChevron={false}
                            mode="info"
                        />
                    )) : (
                        <Item
                            testID={`${TEST_ID}:used-by:none`}
                            title={t('connectedServicesPool.usedByNone')}
                            showChevron={false}
                            mode="info"
                        />
                    )}
                </ItemGroup>
            ) : null}

            {props.sharedWithTeamsAdministration}

            {/* The irreversible action closes the page, its consequence said once. */}
            <ItemGroup surface="none">
                <View style={styles.exit}>
                    <RoundButton
                        testID={`${TEST_ID}:delete`}
                        size="small"
                        display="destructive"
                        title={t('connectedServices.pools.delete.title')}
                        onPress={() => void deletePool()}
                    />
                    <Text style={styles.exitNote}>
                        {agentDefaultTitles.length > 0
                            ? t('connectedServicesPool.deleteNote', { agents: agentDefaultTitles.join(', ') })
                            : t('connectedServicesPool.deleteNoteNoAgent')}
                    </Text>
                </View>
            </ItemGroup>
        </ItemList>
    );
});

/** Wraps a member row in the reorder transform + layout reporter so the drag math measures real heights. */
const PoolMemberReorderRow = React.memo(function PoolMemberReorderRow(props: Readonly<{
    accountId: string;
    reorder: ReturnType<typeof useListInlineReorder<{ id: string }>>;
    children: React.ReactNode;
}>) {
    const { accountId, reorder } = props;
    const onLayout = React.useCallback(
        (event: Parameters<typeof reorder.onRowLayout>[1]) => reorder.onRowLayout(accountId, event),
        [accountId, reorder],
    );
    return (
        <Animated.View style={reorder.animatedStyleForRow(accountId)} onLayout={onLayout}>
            {props.children}
        </Animated.View>
    );
});

const stylesheet = StyleSheet.create((theme) => ({
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    roomLine: {
        ...Typography.default(),
        fontSize: 12.5,
        lineHeight: 17,
        color: theme.colors.text.secondary,
        marginTop: 8,
    },
    checks: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 16,
        rowGap: 8,
        marginTop: 10,
    },
    check: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    checkLabel: {
        ...Typography.default(),
        fontSize: 14,
        color: theme.colors.text.primary,
    },
    exit: {
        alignItems: 'flex-start',
        gap: 8,
    },
    exitNote: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
    },
}));
