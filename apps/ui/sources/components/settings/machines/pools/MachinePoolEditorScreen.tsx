import * as React from 'react';
import { Pressable, View } from 'react-native';
import { useNavigation, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { isPersistentMachine, type MachinePoolMemberInputV1, type MachinePoolViewV1 } from '@happier-dev/protocol';
import { ItemList } from '@/components/ui/lists/ItemList';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Item } from '@/components/ui/lists/Item';
import { Switch } from '@/components/ui/forms/Switch';
import { Text, TextInput } from '@/components/ui/text/Text';
import { StatusPill, type StatusPillVariant } from '@/components/ui/status/StatusPill';
import { SelectionList, resolvePopoverSelectionListHeightBehavior, type SelectionListStep } from '@/components/ui/selectionList';
import { SettingsActionFooter } from '@/components/ui/settingsSurface/SettingsActionFooter';
import { SETTINGS_TEXT_INPUT_METRICS } from '@/components/ui/forms/settingsTextInputMetrics';
import { Modal } from '@/modal';
import { t } from '@/text';
import { useMachineListByServerId, useMachineListStatusByServerId } from '@/sync/domains/state/storage';
import type { Machine } from '@/sync/domains/state/storageTypes';
import { createMachinePool, deleteMachinePool, MachinePoolActionApprovalPendingError, updateMachinePool } from '@/sync/ops/machinePools';
import { useMachinePoolProjections, type MachinePoolProjection } from '@/sync/engine/machines/useMachinePoolProjections';
import { MachinePoolActionError } from '@/sync/api/machines/machinePoolActions';
import { randomUUID } from '@/platform/randomUUID';
import { safeRouterBack } from '@/utils/navigation/safeRouterBack';
import { invalidateMachinePoolProjection } from '@/sync/engine/machines/machinePoolProjection';
import { resolveMachinePoolMemberLabel } from '@/components/machines/pools/machinePoolRowPresentation';
import { createMachinePoolEditorTierState, isMachinePoolHomeOffline, isMachinePoolRefreshFailed, moveMachinePoolEditorTier, normalizeMachinePoolEditorMembers, normalizeMachinePoolEditorTierState } from './machinePoolEditorModel';
import { useApprovalArtifact } from '@/components/approvals/useApprovalArtifact';
import { useMachinesSettingsViewModel } from '../machinesSettingsViewModel';
import { useServerProfilesGeneration } from '@/hooks/server/useServerProfilesGeneration';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { restoreFocusToBestTarget, useRetargetNavigationFocusReturnIntent } from '@/keyboard/focusReturn';
import {
    machinePoolSettingsRowTestId,
    resolveMachinePoolDeleteFocusTargetTestId,
} from '../sections/MachinePoolsSection';

type Draft = Readonly<{ name: string; description: string; members: readonly MachinePoolMemberInputV1[]; tierCount: number }>;
const draftFromView = (view: MachinePoolViewV1 | null): Draft => {
    const tierState = createMachinePoolEditorTierState(view?.pool.members.map(({ machineId, priorityTier, enabled }) => ({ machineId, priorityTier, enabled })) ?? []);
    return { name: view?.pool.name ?? '', description: view?.pool.description ?? '', ...tierState };
};
const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? '' : value ?? '';
const MEMBER_PICKER_MAX_HEIGHT = 520;
const NO_MACHINES: readonly Machine[] = [];
const tierLabel = (tier: number) => tier === 0 ? t('machinePools.primary') : t('machinePools.fallback', { number: tier });

function MachinePoolSelectionListModalContent(props: Readonly<{
    testID: string;
    listAccessibilityLabel: string;
    rootStep: SelectionListStep;
    onSelect(optionId: string): void;
    onClose(): void;
}>) {
    return <SelectionList
        testID={props.testID}
        rootStep={props.rootStep}
        selectedOptionId={null}
        listAccessibilityLabel={props.listAccessibilityLabel}
        maxHeight={MEMBER_PICKER_MAX_HEIGHT}
        heightBehavior={resolvePopoverSelectionListHeightBehavior()}
        keyboardHintsEnabled
        onRequestClose={props.onClose}
        onSelect={(optionId) => {
            props.onSelect(optionId);
            props.onClose();
        }}
    />;
}

function memberStatusPresentation(state: MachinePoolViewV1['pool']['members'][number]['state']): Readonly<{
    label: string;
    variant: StatusPillVariant;
}> {
    if (state === 'connected') return { label: t('status.online'), variant: 'success' };
    if (state === 'offline') return { label: t('status.offline'), variant: 'warning' };
    if (state === 'revoked') return { label: t('machinePools.memberRevoked'), variant: 'danger' };
    if (state === 'replaced') return { label: t('machinePools.memberReplaced'), variant: 'danger' };
    if (state === 'temporary') return { label: t('machinePools.memberTemporary'), variant: 'danger' };
    return { label: t('machinePools.unavailable'), variant: 'neutral' };
}

type MachinePoolEditorScreenProps = Readonly<{ serverId: string; poolId?: string | null }>;
type MachinePoolEditorContentProps = MachinePoolEditorScreenProps & Readonly<{
    machines: readonly Machine[];
    machineListStatus: 'idle' | 'loading' | 'signedOut' | 'error';
    poolProjection: MachinePoolProjection | null;
}>;

/**
 * Account identity belongs to the canonical Pool projection. Keying the stateful aggregate editor
 * here withdraws every private draft/ref/approval lifetime as soon as that owner publishes an
 * unbound or replacement Account, without teaching Settings how credentials are observed.
 */
export function MachinePoolEditorScreen(props: MachinePoolEditorScreenProps) {
    const machineListByServerId = useMachineListByServerId();
    const machines = React.useMemo(
        () => machineListByServerId[props.serverId] ?? NO_MACHINES,
        [machineListByServerId, props.serverId],
    );
    const machineListStatus = useMachineListStatusByServerId()[props.serverId] ?? 'idle';
    const poolScopes = React.useMemo(
        () => props.serverId ? [{ serverId: props.serverId, machines }] : [],
        [machines, props.serverId],
    );
    const poolProjection = useMachinePoolProjections(poolScopes)[0] ?? null;
    return <MachinePoolEditorContent
        key={`${props.serverId}:${poolProjection?.accountId ?? 'unbound'}`}
        {...props}
        machines={machines}
        machineListStatus={machineListStatus}
        poolProjection={poolProjection}
    />;
}

function MachinePoolEditorContent(props: MachinePoolEditorContentProps) {
    const router = useRouter(); const navigation = useNavigation(); const { theme } = useUnistyles();
    const isFocused = useIsFocused();
    const { machines, machineListStatus, poolProjection } = props;
    const isNew = !props.poolId;
    const lifetimeCurrentRef = React.useRef(true);
    React.useEffect(() => () => { lifetimeCurrentRef.current = false; }, []);
    // The projection owner is the only place that decides feature enablement and
    // whether a list is hydrated. Preserve a null loading marker for an enabled
    // Home whose first list has not arrived, while a settled disabled feature is
    // represented by an empty list so an old route cannot remain editable.
    const pools = poolProjection === null
        ? null
        : poolProjection.featureStatus === 'disabled'
            ? []
            : poolProjection.featureEnabled
                ? (poolProjection.ready || poolProjection.pools.length > 0 ? poolProjection.pools : null)
                : (poolProjection.pools.length > 0 ? poolProjection.pools : null);
    const existing = pools?.find((item) => item.pool.id === props.poolId) ?? null;
    const createIdRef = React.useRef(isNew ? randomUUID() : '');
    const [draft, setDraft] = React.useState<Draft>(() => draftFromView(existing));
    const [saving, setSaving] = React.useState(false); const [error, setError] = React.useState<string | null>(null);
    const [approvalId, setApprovalId] = React.useState<string | null>(null);
    const {
        artifact: approvalArtifact,
        isLoading: approvalArtifactLoading,
        error: approvalArtifactError,
    } = useApprovalArtifact({ artifactId: approvalId, serverId: props.serverId });
    const approvalStatus = approvalArtifact?.header?.approvalStatus;
    const approvalPending = approvalId !== null && (
        approvalArtifactLoading || approvalStatus === 'open' || approvalStatus === 'approved' || approvalStatus === 'executing'
    );
    const retargetNavigationFocusReturn = useRetargetNavigationFocusReturnIntent();
    const pendingDeleteFocusTargetRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (approvalId && approvalStatus === 'executed' && isFocused) {
            const nextFocusTarget = pendingDeleteFocusTargetRef.current;
            if (nextFocusTarget && props.poolId) {
                retargetNavigationFocusReturn(
                    machinePoolSettingsRowTestId(props.serverId, props.poolId),
                    nextFocusTarget,
                );
            }
            router.dismissTo('/settings/machines');
        }
    }, [approvalId, approvalStatus, isFocused, props.poolId, props.serverId, retargetNavigationFocusReturn, router]);
    const [invalidMemberIds, setInvalidMemberIds] = React.useState<ReadonlySet<string>>(() => new Set());
    const [conflict, setConflict] = React.useState<MachinePoolViewV1 | null | undefined>(undefined);
    const memberPickerModalIdRef = React.useRef<string | null>(null);
    const loadedRevisionRef = React.useRef(existing?.pool.revision ?? null);
    const nameInputRef = React.useRef<React.ComponentRef<typeof TextInput>>(null);
    const memberRowRefsByMachineIdRef = React.useRef(
        new Map<string, React.RefObject<React.ComponentRef<typeof Pressable> | null>>(),
    );
    const getMemberRowRef = React.useCallback((machineId: string) => {
        const existingRef = memberRowRefsByMachineIdRef.current.get(machineId);
        if (existingRef) return existingRef;
        const createdRef: React.RefObject<React.ComponentRef<typeof Pressable> | null> = { current: null };
        memberRowRefsByMachineIdRef.current.set(machineId, createdRef);
        return createdRef;
    }, []);
    React.useEffect(() => {
        if (existing && loadedRevisionRef.current === null) { loadedRevisionRef.current = existing.pool.revision; setDraft(draftFromView(existing)); }
    }, [existing]);
    const homeOffline = isMachinePoolHomeOffline(machineListStatus)
        || isMachinePoolHomeOffline(poolProjection?.status ?? 'loading');
    // A Pool-list failure is not an offline Home and leaves CAS-protected editing reachable. A
    // feature-discovery failure still fails write authority closed, while retaining readable rows
    // and using the same canonical refresh owner.
    const refreshFailed = !homeOffline
        && (poolProjection?.featureStatus === 'error'
            || isMachinePoolRefreshFailed(machineListStatus)
            || isMachinePoolRefreshFailed(poolProjection?.status ?? 'loading'));
    const [retrying, setRetrying] = React.useState(false);
    const retryRefresh = React.useCallback(async () => {
        if (retrying) return;
        setRetrying(true);
        try {
            await invalidateMachinePoolProjection(props.serverId, { forceFeatures: true });
        } catch {
            // The projection owner records the failed status; the row above already says so.
        } finally {
            if (lifetimeCurrentRef.current) setRetrying(false);
        }
    }, [props.serverId, retrying]);
    const featurePending = poolProjection === null || poolProjection.featureStatus === 'loading';
    const waitingForExisting = !isNew && pools === null && !featurePending && !refreshFailed;
    const existingMissing = !isNew && pools !== null && !existing;
    const featureUnavailable = poolProjection?.ready === true && !poolProjection.featureEnabled;
    // A direct route must never turn an unknown, malformed, or disabled feature decision into
    // write authority. The shared projection is the decision owner; the editor only consumes its
    // positive enabled result.
    const waitingForFeature = (featurePending || (isNew && pools === null)) && !homeOffline && !refreshFailed;
    const formDisabled = saving
        || approvalPending
        || homeOffline
        || !poolProjection?.featureEnabled
        || waitingForExisting
        || existingMissing;
    const eligibleMachines = React.useMemo(() => machines.filter((machine) => (
        isPersistentMachine(machine)
        &&
        !(typeof machine.revokedAt === 'number' && machine.revokedAt > 0)
        && !machine.replacedByMachineId
    )), [machines]);
    const availableMachines = React.useMemo(() => eligibleMachines.filter((machine) => !draft.members.some((member) => member.machineId === machine.id)), [draft.members, eligibleMachines]);
    const orderedMembers = React.useMemo(() => draft.members
        .map((member) => ({
            member,
            label: resolveMachinePoolMemberLabel(member.machineId, machines),
        }))
        .sort((a, b) => a.member.priorityTier - b.member.priorityTier
            || a.label.localeCompare(b.label)
            || a.member.machineId.localeCompare(b.member.machineId)), [draft.members, machines]);
    React.useEffect(() => {
        const firstInvalid = orderedMembers.find(({ member }) => invalidMemberIds.has(member.machineId));
        if (!firstInvalid) return;
        restoreFocusToBestTarget(getMemberRowRef(firstInvalid.member.machineId));
    }, [getMemberRowRef, invalidMemberIds, orderedMembers]);
    const memberPickerStep = React.useMemo<SelectionListStep>(() => ({
        id: 'machine-pool-members',
        inputPlaceholder: t('modelPickerOverlay.searchPlaceholder'),
        emptyStateLabel: t('machinePools.noMachines'),
        sections: [{
            kind: 'static',
            id: 'machines',
            options: availableMachines.map((machine) => {
                const label = resolveMachinePoolMemberLabel(machine.id, machines);
                const status = machine.active ? t('status.online') : t('status.offline');
                return {
                    id: machine.id,
                    testID: `settings.machinePools.editor.memberPicker.${machine.id}`,
                    label,
                    subtitle: status,
                    accessibilityLabel: `${label}. ${status}`,
                    disabled: false,
                };
            }),
        }],
    }), [availableMachines, machines]);
    const closeMemberPicker = React.useCallback(() => {
        if (!memberPickerModalIdRef.current) return;
        Modal.hide(memberPickerModalIdRef.current);
        memberPickerModalIdRef.current = null;
    }, []);
    const openMemberPicker = React.useCallback(() => {
        if (formDisabled || availableMachines.length === 0) return;
        closeMemberPicker();
        memberPickerModalIdRef.current = Modal.show({
            component: MachinePoolSelectionListModalContent,
            props: {
                testID: 'settings.machinePools.editor.memberPicker',
                listAccessibilityLabel: t('machinePools.addMachines'),
                rootStep: memberPickerStep,
                onSelect: (machineId: string) => setDraft((current) => current.members.some((member) => member.machineId === machineId) ? current : ({
                    ...current,
                    ...normalizeMachinePoolEditorTierState(
                        [...current.members, { machineId, priorityTier: 0, enabled: true }],
                        current.tierCount,
                    ),
                })),
            },
            chrome: {
                kind: 'card',
                title: t('machinePools.addMachines'),
                testID: 'settings.machinePools.editor.memberPicker.modal',
                scrollHost: 'body',
                bodyScroll: 'none',
            },
            closeOnBackdrop: true,
        });
    }, [availableMachines.length, closeMemberPicker, formDisabled, memberPickerStep]);
    React.useEffect(() => closeMemberPicker, [closeMemberPicker]);
    const updateMember = React.useCallback((machineId: string, patch: Partial<MachinePoolMemberInputV1>) => setDraft((current) => ({ ...current, members: current.members.map((member) => member.machineId === machineId ? { ...member, ...patch } : member) })), []);
    /**
     * Moving the last member out of an intermediate tier renumbers the remaining tiers right away,
     * so the visible structure is always the one Save will persist.
     */
    const moveMember = React.useCallback((machineId: string, priorityTier: number) => setDraft((current) => ({
        ...current,
        ...normalizeMachinePoolEditorTierState(
            current.members.map((member) => member.machineId === machineId ? { ...member, priorityTier } : member),
            current.tierCount,
        ),
    })), []);
    const memberActionsModalIdRef = React.useRef<string | null>(null);
    const closeMemberActions = React.useCallback(() => {
        if (!memberActionsModalIdRef.current) return;
        Modal.hide(memberActionsModalIdRef.current);
        memberActionsModalIdRef.current = null;
    }, []);
    React.useEffect(() => closeMemberActions, [closeMemberActions]);
    /**
     * Tier placement and removal share one labeled action list per member instead of stacking a
     * control row under every machine. Tiers are named destinations, so nothing implies an order
     * inside a tier, and every option carries the machine it acts on.
     */
    const openMemberActions = React.useCallback((member: MachinePoolMemberInputV1, machineLabel: string) => {
        if (formDisabled) return;
        closeMemberActions();
        const otherTiers = Array.from({ length: draft.tierCount }, (_, tier) => tier)
            .filter((tier) => tier !== member.priorityTier);
        const rootStep: SelectionListStep = {
            id: 'machine-pool-member-actions',
            sections: [
                ...(otherTiers.length > 0 ? [{
                    kind: 'static' as const,
                    id: 'tiers',
                    title: t('machinePools.moveTo'),
                    options: otherTiers.map((tier) => ({
                        id: `tier:${tier}`,
                        testID: `settings.machinePools.editor.member.${member.machineId}.tier.${tier}`,
                        label: tierLabel(tier),
                        accessibilityLabel: `${t('machinePools.moveTo')} ${tierLabel(tier)}. ${machineLabel}`,
                    })),
                }] : []),
                {
                    kind: 'static' as const,
                    id: 'membership',
                    options: [{
                        id: 'remove',
                        testID: `settings.machinePools.editor.member.${member.machineId}.remove`,
                        label: t('machinePools.removeMember'),
                        accessibilityLabel: `${t('machinePools.removeMember')}. ${machineLabel}`,
                    }],
                },
            ],
        };
        memberActionsModalIdRef.current = Modal.show({
            component: MachinePoolSelectionListModalContent,
            props: {
                testID: `settings.machinePools.editor.memberActions.${member.machineId}`,
                listAccessibilityLabel: machineLabel,
                rootStep,
                onSelect: (optionId: string) => {
                    if (optionId === 'remove') {
                        setDraft((current) => ({
                            ...current,
                            ...normalizeMachinePoolEditorTierState(
                                current.members.filter((item) => item.machineId !== member.machineId),
                                current.tierCount,
                            ),
                        }));
                        return;
                    }
                    const tier = Number.parseInt(optionId.slice('tier:'.length), 10);
                    if (Number.isInteger(tier)) moveMember(member.machineId, tier);
                },
            },
            chrome: {
                kind: 'card',
                title: machineLabel,
                testID: 'settings.machinePools.editor.memberActions.modal',
                scrollHost: 'body',
                bodyScroll: 'none',
            },
            closeOnBackdrop: true,
        });
    }, [closeMemberActions, draft.tierCount, formDisabled, moveMember]);
    const save = React.useCallback(async () => {
        if (formDisabled) return;
        if (!draft.name.trim()) {
            setError(t('machinePools.nameRequired'));
            restoreFocusToBestTarget(nameInputRef);
            return;
        }
        // A save replaces any earlier proposal, including a delete whose approval was rejected.
        // Its post-delete focus target must not survive into this pool's own approval return.
        pendingDeleteFocusTargetRef.current = null;
        setSaving(true); setError(null); setApprovalId(null); setInvalidMemberIds(new Set()); setConflict(undefined);
        try {
            const members = normalizeMachinePoolEditorMembers(draft.members);
            if (isNew) await createMachinePool(props.serverId, { poolId: createIdRef.current, name: draft.name, description: draft.description || null, members });
            else await updateMachinePool(props.serverId, { poolId: props.poolId!, expectedRevision: loadedRevisionRef.current ?? existing?.pool.revision ?? 0, name: draft.name, description: draft.description || null, members });
            if (!lifetimeCurrentRef.current) return;
            safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' });
        } catch (cause) {
            if (!lifetimeCurrentRef.current) return;
            if (cause instanceof MachinePoolActionApprovalPendingError) setApprovalId(cause.artifactId);
            else if (cause instanceof MachinePoolActionError && cause.detail?.code === 'pool_changed') setConflict(cause.detail.current ?? null);
            else if (cause instanceof MachinePoolActionError && cause.detail?.code === 'member_machine_not_eligible') {
                setInvalidMemberIds(new Set(cause.detail.machineIds));
                setError(t('machinePools.memberNotEligible'));
            } else setError(t('machinePools.saveFailed'));
        } finally { if (lifetimeCurrentRef.current) setSaving(false); }
    }, [draft, existing?.pool.revision, formDisabled, isNew, navigation, props.poolId, props.serverId, router]);
    const remove = React.useCallback(async () => {
        if (!existing || formDisabled) return;
        const confirmed = await Modal.confirm(t('machinePools.deleteTitle'), t('machinePools.deleteBody'), { cancelText: t('common.cancel'), confirmText: t('common.delete'), destructive: true });
        if (!confirmed || !lifetimeCurrentRef.current) return;
        pendingDeleteFocusTargetRef.current = null;
        setSaving(true); setError(null); setApprovalId(null);
        const nextFocusTarget = resolveMachinePoolDeleteFocusTargetTestId(
            props.serverId,
            pools ?? [],
            existing.pool.id,
        );
        try {
            await deleteMachinePool(props.serverId, { poolId: existing.pool.id, expectedRevision: loadedRevisionRef.current ?? existing.pool.revision });
            if (!lifetimeCurrentRef.current) return;
            retargetNavigationFocusReturn(
                machinePoolSettingsRowTestId(props.serverId, existing.pool.id),
                nextFocusTarget,
            );
            safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' });
        } catch (cause) {
            if (!lifetimeCurrentRef.current) return;
            if (cause instanceof MachinePoolActionApprovalPendingError) {
                pendingDeleteFocusTargetRef.current = nextFocusTarget;
                setApprovalId(cause.artifactId);
            }
            else if (cause instanceof MachinePoolActionError && cause.detail?.code === 'pool_changed') setConflict(cause.detail.current ?? null);
            else setError(t('machinePools.deleteFailed'));
        }
        finally { if (lifetimeCurrentRef.current) setSaving(false); }
    }, [existing, formDisabled, navigation, pools, props.serverId, retargetNavigationFocusReturn, router]);
    const reloadConflict = React.useCallback(async () => {
        if (!conflict) return;
        const confirmed = await Modal.confirm(t('machinePools.reloadTitle'), t('machinePools.reloadBody'), { cancelText: t('common.cancel'), confirmText: t('machinePools.reload') });
        if (!confirmed || !lifetimeCurrentRef.current) return; loadedRevisionRef.current = conflict.pool.revision; setDraft(draftFromView(conflict)); setConflict(undefined);
    }, [conflict]);

    return <>
        <ItemList keyboardShouldPersistTaps="handled">
            {homeOffline ? <ItemGroup><Item testID="settings.machinePools.editor.offline" title={t('machinePools.homeOffline')} mode="info" /></ItemGroup> : null}
            {refreshFailed ? <ItemGroup>
                <Item testID="settings.machinePools.editor.refreshFailed" title={t('machinePools.refreshFailed')} mode="info" />
                <Item
                    testID="settings.machinePools.editor.retry"
                    title={t('common.retry')}
                    disabled={retrying}
                    onPress={() => { void retryRefresh(); }}
                />
            </ItemGroup> : null}
            {featureUnavailable ? <ItemGroup>
                <Item testID="settings.machinePools.editor.featureUnavailable" title={t('machinePools.featureUnavailable')} mode="info" />
                <Item
                    testID="settings.machinePools.editor.featureUnavailable.back"
                    title={t('common.back')}
                    onPress={() => safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' })}
                />
            </ItemGroup> : null}
            {waitingForFeature ? <ItemGroup><Item testID="settings.machinePools.editor.loading" title={t('common.loading')} mode="info" /></ItemGroup> : null}
            {waitingForExisting ? <ItemGroup><Item testID="settings.machinePools.editor.loading" title={t('common.loading')} mode="info" /></ItemGroup> : null}
            {existingMissing ? <ItemGroup><Item testID="settings.machinePools.editor.missing" title={t('machinePools.poolNotFound')} mode="info" /></ItemGroup> : null}
            <ItemGroup title={t('machinePools.basics')} footer={t('machinePools.privacy')}>
                <View style={styles.field}><Text style={styles.label}>{t('machinePools.name')}</Text><TextInput ref={nameInputRef} testID="settings.machinePools.editor.name" accessibilityLabel={t('machinePools.name')} value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} style={[styles.input, { color: theme.colors.input.text, backgroundColor: theme.colors.input.background, borderColor: theme.colors.border.default }]} editable={!formDisabled} /></View>
                <View style={styles.field}><Text style={styles.label}>{t('machinePools.description')}</Text><TextInput testID="settings.machinePools.editor.description" accessibilityLabel={t('machinePools.description')} value={draft.description} onChangeText={(description) => setDraft((current) => ({ ...current, description }))} style={[styles.input, styles.multiline, { color: theme.colors.input.text, backgroundColor: theme.colors.input.background, borderColor: theme.colors.border.default }]} editable={!formDisabled} multiline /></View>
            </ItemGroup>
            {conflict !== undefined ? <ItemGroup title={t('machinePools.conflictTitle')}>
                <Item testID="settings.machinePools.editor.conflict" title={conflict ? t('machinePools.conflictBody') : t('machinePools.conflictNoReload')} mode="info" />
                {conflict ? <Item testID="settings.machinePools.editor.reload" title={t('machinePools.reload')} onPress={() => { void reloadConflict(); }} /> : null}
            </ItemGroup> : null}
            {error ? <ItemGroup><Item testID="settings.machinePools.editor.error" title={error} mode="info" /></ItemGroup> : null}
            {approvalId ? <ItemGroup><Item
                testID="settings.machinePools.editor.approval"
                title={t('approvals.title')}
                subtitle={approvalArtifactError ? t('approvals.loadError') : approvalPending ? t('approvals.status.open') : t('approvals.details')}
                onPress={() => {
                    const completion = `&completionHref=${encodeURIComponent('/settings/machines')}`;
                    const deleteFocusTarget = pendingDeleteFocusTargetRef.current;
                    const focus = deleteFocusTarget && props.poolId
                        ? `&completionFocusFrom=${encodeURIComponent(machinePoolSettingsRowTestId(props.serverId, props.poolId))}&completionFocusTo=${encodeURIComponent(deleteFocusTarget)}`
                        : '';
                    router.push(`/inbox/approvals/${encodeURIComponent(approvalId)}?serverId=${encodeURIComponent(props.serverId)}${completion}${focus}`);
                }}
            /></ItemGroup> : null}
            <ItemGroup>
                <Item
                    testID="settings.machinePools.editor.placementChangeNotice"
                    title={t('machinePools.placementChangeNotice')}
                    mode="info"
                />
            </ItemGroup>
            {Array.from({ length: draft.tierCount }, (_, tier) => <ItemGroup key={tier} title={tierLabel(tier)}>
                {tier > 0 ? <Item testID={`settings.machinePools.editor.tier.${tier}.earlier`} title={t('machinePools.moveTierEarlier')} accessibilityLabel={`${t('machinePools.moveTierEarlier')}. ${tierLabel(tier)}`} onPress={() => setDraft((current) => ({ ...current, ...normalizeMachinePoolEditorTierState(moveMachinePoolEditorTier(current.members, tier, tier - 1), current.tierCount) }))} disabled={formDisabled} /> : null}
                {tier + 1 < draft.tierCount ? <Item testID={`settings.machinePools.editor.tier.${tier}.later`} title={t('machinePools.moveTierLater')} accessibilityLabel={`${t('machinePools.moveTierLater')}. ${tierLabel(tier)}`} onPress={() => setDraft((current) => ({ ...current, ...normalizeMachinePoolEditorTierState(moveMachinePoolEditorTier(current.members, tier, tier + 1), current.tierCount) }))} disabled={formDisabled} /> : null}
                {orderedMembers
                    .filter(({ member }) => member.priorityTier === tier)
                    .map(({ member, label }) => {
                        const machine = machines.find((item) => item.id === member.machineId);
                        const savedMember = existing?.pool.members.find((item) => item.machineId === member.machineId);
                        const memberStatus = savedMember
                            ? memberStatusPresentation(savedMember.state)
                            : memberStatusPresentation(machine?.active ? 'connected' : 'offline');
                        const ineligible = invalidMemberIds.has(member.machineId);
                        return <Item
                            key={member.machineId}
                            testID={`settings.machinePools.editor.member.${member.machineId}`}
                            pressableRef={getMemberRowRef(member.machineId)}
                            title={label}
                            subtitle={ineligible ? t('machinePools.memberNotEligibleDetail') : undefined}
                            accessibilityLabel={[label, tierLabel(tier), memberStatus.label, ineligible ? t('machinePools.memberNotEligibleDetail') : null].filter(Boolean).join('. ')}
                            rightElementOutsidePressable
                            rightElement={<View style={styles.memberControls}>
                                <StatusPill testID={`settings.machinePools.editor.member.${member.machineId}.status`} label={memberStatus.label} variant={memberStatus.variant} />
                                <Switch testID={`settings.machinePools.editor.member.${member.machineId}.enabled`} value={member.enabled} disabled={formDisabled} accessibilityLabel={`${t('machinePools.enableMember')}. ${label}`} onValueChange={(enabled) => updateMember(member.machineId, { enabled })} />
                            </View>}
                            disabled={formDisabled}
                            onPress={() => openMemberActions(member, label)}
                        />;
                    })}
            </ItemGroup>)}
            <ItemGroup title={t('machinePools.addMachines')}>
                <Item testID="settings.machinePools.editor.addMachines" title={t('machinePools.addMachines')} onPress={openMemberPicker} disabled={formDisabled || availableMachines.length === 0} />
                {/* A disabled action always says why. "No persistent machines" would be untrue when
                    the Home has eligible machines that are simply already in this pool. */}
                {eligibleMachines.length === 0 ? <Item
                    testID="settings.machinePools.editor.noMachines"
                    title={t('machinePools.noMachines')}
                    mode="info"
                /> : availableMachines.length === 0 ? <Item
                    testID="settings.machinePools.editor.allMachinesAdded"
                    title={t('machinePools.allMachinesAdded')}
                    mode="info"
                /> : null}
                <Item testID="settings.machinePools.editor.addFallback" title={t('machinePools.addFallback')} onPress={() => setDraft((current) => ({ ...current, tierCount: current.tierCount + 1 }))} disabled={formDisabled} />
            </ItemGroup>
        </ItemList>
        <SettingsActionFooter primaryLabel={isNew ? t('machinePools.create') : t('machinePools.save')} primaryTestID="settings.machinePools.editor.save" primaryDisabled={formDisabled} onPrimaryPress={() => { void save(); }} secondaryLabel={!isNew ? t('machinePools.delete') : t('common.cancel')} secondaryTestID={!isNew ? 'settings.machinePools.editor.delete' : 'settings.machinePools.editor.cancel'} secondaryTone={!isNew ? 'destructive' : 'default'} onSecondaryPress={!isNew ? (formDisabled ? null : () => { void remove(); }) : () => safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' })} />
    </>;
}

function MachinePoolRouteUnavailable() {
    const router = useRouter();
    const navigation = useNavigation();
    return <ItemList>
        <ItemGroup>
            <Item
                testID="settings.machinePools.routeUnavailable"
                title={t('common.unavailable')}
                mode="info"
            />
            <Item
                testID="settings.machinePools.routeUnavailable.back"
                title={t('common.back')}
                onPress={() => safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' })}
            />
        </ItemGroup>
    </ItemList>;
}

/**
 * The searchable Settings catalog can open creation without a Home parameter. Pool administration
 * is Home-local, so this presents the incumbent Machines Settings Home set and records the exact
 * choice in the route before mounting the editor. It never falls back to whichever Home is focused
 * after the choice.
 */
function MachinePoolHomeChooserScreen() {
    const router = useRouter();
    const navigation = useNavigation();
    const viewModel = useMachinesSettingsViewModel();
    const projections = useMachinePoolProjections(viewModel.visibleMachineGroups);

    return <ItemList>
        <ItemGroup title={t('homeGovernance.chooseHome')} footer={t('machinePools.benefit')}>
            {viewModel.visibleMachineGroups.map((group, index) => {
                const projection = projections[index];
                const signedOut = isMachinePoolHomeOffline(group.status)
                    || isMachinePoolHomeOffline(projection?.status ?? 'loading');
                const featureUnavailable = projection?.featureStatus === 'disabled';
                const featurePending = !projection || projection.featureStatus === 'loading';
                const featureError = projection?.featureStatus === 'error';
                const refreshFailed = isMachinePoolRefreshFailed(group.status)
                    || featureError
                    || isMachinePoolRefreshFailed(projection?.status ?? 'loading');
                const subtitle = signedOut
                    ? t('machinePools.homeOffline')
                    : refreshFailed
                        ? t('machinePools.refreshFailed')
                        : featureUnavailable
                            ? t('machinePools.featureUnavailable')
                            : featurePending
                                ? t('common.loading')
                                : undefined;
                return <Item
                    key={group.serverId}
                    testID={`settings.machinePools.home.${group.serverId}`}
                    title={group.serverName}
                    subtitle={subtitle}
                    accessibilityLabel={featureError
                        ? `${group.serverName}. ${t('machinePools.refreshFailed')}. ${t('common.retry')}`
                        : undefined}
                    loading={featurePending && !refreshFailed}
                    disabled={signedOut || featureUnavailable || featurePending}
                    onPress={() => {
                        if (featureError) {
                            void invalidateMachinePoolProjection(group.serverId, { forceFeatures: true }).catch(() => {});
                            return;
                        }
                        router.setParams({ serverId: group.serverId });
                    }}
                />;
            })}
            {viewModel.visibleMachineGroups.length === 0 ? <Item
                testID="settings.machinePools.home.empty"
                title={t('common.unavailable')}
                mode="info"
            /> : null}
            <Item
                testID="settings.machinePools.home.back"
                title={t('common.back')}
                onPress={() => safeRouterBack({ router, navigation, fallbackHref: '/settings/machines' })}
            />
        </ItemGroup>
    </ItemList>;
}

function ExactMachinePoolEditorRoute(props: Readonly<{ serverId: string; poolId: string | null }>) {
    useServerProfilesGeneration();
    if (!getServerProfileById(props.serverId)) return <MachinePoolRouteUnavailable />;
    return <MachinePoolEditorScreen serverId={props.serverId} poolId={props.poolId} />;
}

export function MachinePoolEditorRoute(props: Readonly<{ params: { serverId?: string | string[]; poolId?: string | string[] } }>) {
    const serverId = single(props.params.serverId).trim();
    if (!serverId) return <MachinePoolHomeChooserScreen />;
    return <ExactMachinePoolEditorRoute serverId={serverId} poolId={single(props.params.poolId).trim() || null} />;
}

const styles = StyleSheet.create((theme) => ({
    field: { paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
    label: { color: theme.colors.text.secondary },
    input: { ...SETTINGS_TEXT_INPUT_METRICS, minHeight: 48, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
    multiline: { minHeight: 88, textAlignVertical: 'top' },
    memberControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
