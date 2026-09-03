import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import type {
    DaemonNpmRegistryProfileMutationRequestV1,
    DaemonNpmRegistryProfileSnapshotV1,
} from '@happier-dev/protocol/rpc';
import type { MachineAdministrationTargetV1 } from '@happier-dev/protocol';
import type { MarketplaceSourceV1 } from '@happier-dev/protocol/marketplace';

import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { buildActionRowAccessibilityLabel } from '@/components/ui/lists/actionRowAccessibility';
import { Modal } from '@/modal';
import { randomUUID } from '@/platform/randomUUID';
import {
    machineAdministrationTargetsEqual,
} from '@/sync/domains/machines/administration/targetSelection';
import {
    type FreshMachineAdministrationExecutionTargetV1,
    type MachineAdministrationTargetSelectionV1,
} from '@/sync/domains/machines/administration/useTargetSelection';
import { isMachineAdministrationExecutionTargetCurrent } from '@/sync/domains/machines/administration/operationCurrentness';
import {
    machineNpmRegistryProfilesGet,
    machineNpmRegistryProfilesMutate,
} from '@/sync/ops/machineNpmRegistryProfiles';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

import { showNpmRegistryProfileEditor } from './NpmRegistryProfileEditor';

type LocalRegistryMutation = DaemonNpmRegistryProfileMutationRequestV1 extends infer TMutation
    ? TMutation extends DaemonNpmRegistryProfileMutationRequestV1
        ? Omit<TMutation, 'machineId' | 'expectedRevision' | 'mutationId'>
        : never
    : never;

type RegistryProfileView = DaemonNpmRegistryProfileSnapshotV1['profiles'][number];
type LoadedSnapshot = Readonly<{
    selectionKey: string;
    snapshot: DaemonNpmRegistryProfileSnapshotV1;
}>;

/**
 * The "no private registry" choice in a source's binding menu.
 *
 * Profile ids are lowercase and non-empty by schema, so the empty string cannot
 * collide with one; unbinding is a real selectable choice rather than a second
 * control beside the menu.
 */
const UNBOUND_REGISTRY_PROFILE_ID = '';

type NpmRegistryProfilesTargetSelection = Pick<
    MachineAdministrationTargetSelectionV1,
    'selectedTarget' | 'canExecute' | 'resolveExecutionTarget'
>;

export type NpmRegistryProfilesSectionProps = Readonly<{
    daemonOperationsAvailable: boolean;
    targetSelection: NpmRegistryProfilesTargetSelection;
    marketplaceSources?: readonly MarketplaceSourceV1[];
    onSetMarketplaceSourceProfile?: (
        sourceId: string,
        profileId: string | null,
    ) => Promise<Readonly<{ status: 'success' | 'unavailable' | 'outcomeUnknown' | 'superseded' }>>;
}>;

export function NpmRegistryProfilesSection({
    daemonOperationsAvailable,
    targetSelection,
    marketplaceSources = [],
    onSetMarketplaceSourceProfile,
}: NpmRegistryProfilesSectionProps): React.ReactElement {
    const { theme } = useUnistyles();
    const selectedTarget = targetSelection.selectedTarget;
    const selectionKey = selectedTarget
        ? `${selectedTarget.serverIdentityId}\0${selectedTarget.machineId}`
        : '';
    const selectionKeyRef = React.useRef(selectionKey);
    selectionKeyRef.current = selectionKey;
    const resolveExecutionTargetRef = React.useRef(targetSelection.resolveExecutionTarget);
    resolveExecutionTargetRef.current = targetSelection.resolveExecutionTarget;
    const daemonOperationsAvailableRef = React.useRef(daemonOperationsAvailable);
    daemonOperationsAvailableRef.current = daemonOperationsAvailable;
    const refreshGenerationRef = React.useRef(0);
    const mutationRequestIdRef = React.useRef(0);
    const mutationInFlightRef = React.useRef(false);
    const bindingRequestIdRef = React.useRef(0);
    const bindingInFlightRef = React.useRef(false);
    const [loaded, setLoaded] = React.useState<LoadedSnapshot | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState(false);
    const [busyProfileId, setBusyProfileId] = React.useState<string | null>(null);
    const [busyBindingSourceId, setBusyBindingSourceId] = React.useState<string | null>(null);
    const [openBindingSourceId, setOpenBindingSourceId] = React.useState<string | null>(null);
    const snapshot = loaded?.selectionKey === selectionKey ? loaded.snapshot : null;

    const resolveExactExecutionTarget = React.useCallback((
        expectedTarget: MachineAdministrationTargetV1 | null,
    ): FreshMachineAdministrationExecutionTargetV1 | null => {
        const resolved = resolveExecutionTargetRef.current();
        return expectedTarget !== null
            && resolved !== null
            && machineAdministrationTargetsEqual(expectedTarget, resolved.target)
            ? resolved
            : null;
    }, []);

    const isExecutionTargetCurrent = React.useCallback((
        requestedSelection: string,
        executionTarget: FreshMachineAdministrationExecutionTargetV1,
    ): boolean => {
        return isMachineAdministrationExecutionTargetCurrent({
            expectedTarget: executionTarget,
            resolveCurrentTarget: resolveExecutionTargetRef.current,
            expectedSelectionKey: requestedSelection,
            currentSelectionKey: selectionKeyRef.current,
        });
    }, []);

    const refresh = React.useCallback(async () => {
        const generation = ++refreshGenerationRef.current;
        const requestedSelection = selectionKey;
        const requestedTarget = selectedTarget;
        if (!requestedTarget || !daemonOperationsAvailable) {
            if (!requestedTarget) setLoaded(null);
            setLoadError(false);
            setLoading(false);
            return;
        }
        const executionTarget = resolveExactExecutionTarget(requestedTarget);
        if (!executionTarget) {
            setLoadError(false);
            setLoading(false);
            return;
        }
        setLoading(true);
        setLoadError(false);
        try {
            const result = await machineNpmRegistryProfilesGet(executionTarget.machine.id, {
                serverId: executionTarget.serverId,
            });
            if (
                generation !== refreshGenerationRef.current
                || !isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) return;
            if (result.status === 'success') {
                setLoaded({ selectionKey: requestedSelection, snapshot: result.snapshot });
            } else {
                setLoadError(true);
            }
        } catch {
            if (
                generation === refreshGenerationRef.current
                && isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) {
                setLoadError(true);
            }
        } finally {
            if (
                generation === refreshGenerationRef.current
                && isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) {
                setLoading(false);
            }
        }
    }, [daemonOperationsAvailable, isExecutionTargetCurrent, resolveExactExecutionTarget, selectedTarget, selectionKey]);

    React.useEffect(() => { void refresh(); }, [refresh]);

    React.useEffect(() => {
        mutationRequestIdRef.current += 1;
        mutationInFlightRef.current = false;
        bindingRequestIdRef.current += 1;
        bindingInFlightRef.current = false;
        setBusyProfileId(null);
        setBusyBindingSourceId(null);
        // An open binding menu lists the previous machine's profiles; it must
        // not survive into a selection those profiles do not belong to.
        setOpenBindingSourceId(null);
    }, [daemonOperationsAvailable, selectionKey]);

    const mutate = React.useCallback(async (
        request: LocalRegistryMutation,
    ) => {
        if (
            !daemonOperationsAvailableRef.current
            || !selectedTarget
            || !targetSelection.canExecute
            || !snapshot
            || mutationInFlightRef.current
        ) return;
        const requestedSelection = selectionKey;
        const executionTarget = resolveExactExecutionTarget(selectedTarget);
        if (!executionTarget) return;
        const requestId = ++mutationRequestIdRef.current;
        const profileId = 'profileId' in request ? request.profileId : 'registry';
        mutationInFlightRef.current = true;
        setBusyProfileId(profileId);
        try {
            const result = await machineNpmRegistryProfilesMutate(executionTarget.machine.id, {
                ...request,
                machineId: executionTarget.machine.id,
                expectedRevision: snapshot.revision,
                mutationId: `registry-${request.action}-${randomUUID()}`,
            } as DaemonNpmRegistryProfileMutationRequestV1, { serverId: executionTarget.serverId });
            if (
                requestId !== mutationRequestIdRef.current
                || !daemonOperationsAvailableRef.current
                || !isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) return;
            if (result.status === 'success') {
                setLoaded({ selectionKey: requestedSelection, snapshot: result.snapshot });
                return;
            }
            if (result.status === 'outcomeUnknown') {
                await refresh();
                if (
                    requestId !== mutationRequestIdRef.current
                    || !daemonOperationsAvailableRef.current
                    || !isExecutionTargetCurrent(requestedSelection, executionTarget)
                ) return;
                await Modal.alert(
                    t('settingsPlugins.sourceAdministration.operationOutcomeUnknownTitle'),
                    t('settingsPlugins.sourceAdministration.operationOutcomeUnknownBody'),
                );
                return;
            }
            if (result.code === 'revision_conflict') {
                await refresh();
                if (
                    requestId !== mutationRequestIdRef.current
                    || !daemonOperationsAvailableRef.current
                    || !isExecutionTargetCurrent(requestedSelection, executionTarget)
                ) return;
                await Modal.alert(t('settingsPlugins.registriesConflictTitle'), t('settingsPlugins.registriesConflictBody'));
                return;
            }
            await Modal.alert(t('settingsPlugins.registriesErrorTitle'), t('settingsPlugins.registriesErrorBody'));
        } catch {
            if (
                requestId === mutationRequestIdRef.current
                && daemonOperationsAvailableRef.current
                && isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) {
                await Modal.alert(t('settingsPlugins.registriesErrorTitle'), t('settingsPlugins.registriesErrorBody'));
            }
        } finally {
            if (requestId === mutationRequestIdRef.current) {
                mutationInFlightRef.current = false;
                setBusyProfileId(null);
            }
        }
    }, [isExecutionTargetCurrent, refresh, resolveExactExecutionTarget, selectedTarget, selectionKey, snapshot, targetSelection.canExecute]);

    /**
     * One form answers the whole profile, then one revisioned mutation sends it.
     *
     * Creating and editing differ only in which mutation carries the result, so
     * they share the form rather than each owning a private question chain that
     * can drift apart.
     */
    const openProfileEditor = React.useCallback(async (current: RegistryProfileView | null) => {
        if (!daemonOperationsAvailableRef.current) return;
        const profile = await showNpmRegistryProfileEditor(current === null
            ? { mode: 'create' }
            : {
                mode: 'edit',
                subject: {
                    displayName: current.displayName,
                    origin: current.origin,
                    scopes: current.scopes,
                    useAsDefault: current.useAsDefault,
                    allowPrivateNetwork: current.allowPrivateNetwork,
                },
            });
        if (!profile) return;
        await mutate(current === null
            ? {
                action: 'add',
                profileId: `registry_${randomUUID().replaceAll('-', '_')}`,
                profile,
            }
            : { action: 'update', profileId: current.profileId, profile });
    }, [mutate]);

    const login = React.useCallback(async (profileId: string) => {
        if (!daemonOperationsAvailableRef.current) return;
        const secret = (await Modal.prompt(
            t('settingsPlugins.registriesLoginTitle'),
            t('settingsPlugins.registriesLoginBody'),
            { inputType: 'secure-text', confirmText: t('settingsPlugins.registriesLogin'), cancelText: t('common.cancel') },
        ))?.trim();
        if (!secret) return;
        await mutate({ action: 'login', profileId, credential: { kind: 'bearer_token', secret } });
    }, [mutate]);

    const remove = React.useCallback(async (profileId: string, displayName: string) => {
        if (!daemonOperationsAvailableRef.current) return;
        if (!await Modal.confirm(
            t('settingsPlugins.registriesRemoveTitle'),
            t('settingsPlugins.registriesRemoveBody', { name: displayName }),
            { destructive: true, confirmText: t('common.remove'), cancelText: t('common.cancel') },
        )) return;
        await mutate({ action: 'remove', profileId });
    }, [mutate]);

    const setMarketplaceBinding = React.useCallback(async (sourceId: string, profileId: string | null) => {
        if (
            !daemonOperationsAvailableRef.current
            || !selectedTarget
            || !targetSelection.canExecute
            || !onSetMarketplaceSourceProfile
            || bindingInFlightRef.current
        ) return;
        const executionTarget = resolveExactExecutionTarget(selectedTarget);
        if (!executionTarget) return;
        const requestId = ++bindingRequestIdRef.current;
        const requestedSelection = selectionKey;
        bindingInFlightRef.current = true;
        setBusyBindingSourceId(sourceId);
        try {
            const settlement = await onSetMarketplaceSourceProfile(sourceId, profileId);
            if (
                requestId !== bindingRequestIdRef.current
                || !daemonOperationsAvailableRef.current
                || !isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) return;
            if (settlement.status === 'outcomeUnknown') {
                await Modal.alert(
                    t('settingsPlugins.sourceAdministration.operationOutcomeUnknownTitle'),
                    t('settingsPlugins.sourceAdministration.operationOutcomeUnknownBody'),
                );
            } else if (settlement.status === 'unavailable') {
                await Modal.alert(t('settingsPlugins.registriesErrorTitle'), t('settingsPlugins.registriesErrorBody'));
            }
        } catch {
            if (
                requestId !== bindingRequestIdRef.current
                || !daemonOperationsAvailableRef.current
                || !isExecutionTargetCurrent(requestedSelection, executionTarget)
            ) return;
            await Modal.alert(t('settingsPlugins.registriesErrorTitle'), t('settingsPlugins.registriesErrorBody'));
        } finally {
            if (requestId !== bindingRequestIdRef.current) return;
            bindingInFlightRef.current = false;
            setBusyBindingSourceId(null);
        }
    }, [isExecutionTargetCurrent, onSetMarketplaceSourceProfile, resolveExactExecutionTarget, selectedTarget, selectionKey, targetSelection.canExecute]);

    return (
        <ItemGroup title={t('settingsPlugins.registriesTitle')} footer={t('settingsPlugins.registriesFooter')}>
            <Item
                testID="settings.plugins.registries.add"
                title={t('settingsPlugins.registriesAdd')}
                icon={<Icon name="plus-circle" size={29} color={theme.colors.accent.blue} />}
                onPress={() => { void openProfileEditor(null); }}
                disabled={!daemonOperationsAvailable || !targetSelection.canExecute || loading || busyProfileId !== null}
                showChevron={false}
            />
            {!selectedTarget ? (
                <Item testID="settings.plugins.registries.noMachine" title={t('settingsPlugins.registriesNoMachine')} mode="info" showChevron={false} />
            ) : null}
            {loading && !snapshot ? <Item title={t('common.loading')} mode="info" showChevron={false} /> : null}
            {loadError ? (
                <>
                    <Item testID="settings.plugins.registries.loadError" title={t('settingsPlugins.registriesLoadError')} mode="info" showChevron={false} />
                    <Item
                        testID="settings.plugins.registries.retry"
                        title={t('common.retry')}
                        onPress={() => { void refresh(); }}
                        disabled={!daemonOperationsAvailable || !targetSelection.canExecute || loading || busyProfileId !== null}
                        loading={loading}
                        showChevron={false}
                    />
                </>
            ) : null}
            {snapshot && snapshot.profiles.length === 0 && snapshot.pausedSources.length === 0 ? (
                <Item testID="settings.plugins.registries.empty" title={t('settingsPlugins.registriesEmpty')} mode="info" showChevron={false} />
            ) : null}
            {/*
              * One profile is one row. Edit, sign in or out, test and remove all
              * act on that same record, so they belong to its row rather than to
              * four look-alike rows a reader has to keep attributing back to the
              * profile above them — and that a screen reader traverses as five
              * separate list entries for one registry.
              */}
            {snapshot?.profiles.map((profile) => {
                const busy = busyProfileId === profile.profileId;
                const mutationsDisabled = !daemonOperationsAvailable || !targetSelection.canExecute || busyProfileId !== null;
                const status = t(`settingsPlugins.registriesAvailability.${profile.availability}`);
                const credentialAction = profile.hasCredentials
                    ? {
                        id: 'logout',
                        title: t('settingsPlugins.registriesLogout'),
                        icon: 'sign-out' as const,
                        inlineTestID: `settings.plugins.registries.logout.${profile.profileId}`,
                        onPress: () => { void mutate({ action: 'logout', profileId: profile.profileId }); },
                    }
                    : {
                        id: 'login',
                        title: t('settingsPlugins.registriesLogin'),
                        icon: 'sign-in' as const,
                        inlineTestID: `settings.plugins.registries.login.${profile.profileId}`,
                        onPress: () => { void login(profile.profileId); },
                    };
                const actions = [
                    {
                        id: 'edit',
                        title: t('settingsPlugins.registriesEdit'),
                        icon: 'pencil-simple' as const,
                        inlineTestID: `settings.plugins.registries.edit.${profile.profileId}`,
                        onPress: () => { void openProfileEditor(profile); },
                    },
                    credentialAction,
                    {
                        id: 'test',
                        title: t('settingsPlugins.registriesTest'),
                        icon: 'checks' as const,
                        inlineTestID: `settings.plugins.registries.test.${profile.profileId}`,
                        onPress: () => { void mutate({ action: 'test', profileId: profile.profileId }); },
                    },
                    {
                        id: 'remove',
                        title: t('settingsPlugins.registriesRemove'),
                        icon: 'trash' as const,
                        destructive: true,
                        inlineTestID: `settings.plugins.registries.remove.${profile.profileId}`,
                        onPress: () => { void remove(profile.profileId, profile.displayName); },
                    },
                ].map((action) => ({
                    ...action,
                    // Icon controls repeat across profiles, so each one names the
                    // profile it acts on instead of only what it does.
                    accessibilityLabel: buildActionRowAccessibilityLabel([action.title, profile.displayName]),
                    disabled: mutationsDisabled,
                }));
                return (
                    <Item
                        key={profile.profileId}
                        testID={`settings.plugins.registries.profile.${profile.profileId}`}
                        title={profile.displayName}
                        subtitle={`${profile.origin} · ${status}`}
                        subtitleLines={0}
                        icon={<Icon name="key" size={29} color={theme.colors.text.secondary} />}
                        mode="info"
                        showChevron={false}
                        // Progress belongs to the record being mutated, not to
                        // whichever control started it.
                        loading={busy}
                        rightElementOutsidePressable
                        rightElement={(
                            <ItemRowActions
                                title={profile.displayName}
                                compactActionIds={[profile.hasCredentials ? 'edit' : 'login']}
                                overflowTriggerTestID={`settings.plugins.registries.profile.${profile.profileId}.actions.overflow`}
                                actions={actions}
                            />
                        )}
                    />
                );
            })}
            {snapshot && marketplaceSources.length > 0 ? (
                <Item
                    testID="settings.plugins.registries.marketplaceBindings"
                    title={t('settingsPlugins.registriesMarketplaceBindingsTitle')}
                    mode="info"
                    showChevron={false}
                />
            ) : null}
            {/*
              * A source's registry is one choice, so it is one row with a
              * selection menu. Listing every source against every profile made
              * the pane grow multiplicatively — and still could not express
              * "use a different profile" without unbinding first, because the
              * bound state hid the alternatives instead of marking the current
              * one among them.
              */}
            {snapshot ? marketplaceSources.map((source) => {
                const boundProfile = source.registryProfileId
                    ? snapshot.profiles.find((profile) => profile.profileId === source.registryProfileId) ?? null
                    : null;
                const bindingDisabled = !daemonOperationsAvailable
                    || !targetSelection.canExecute
                    || !onSetMarketplaceSourceProfile
                    || busyProfileId !== null
                    || busyBindingSourceId !== null;
                return (
                    <DropdownMenu
                        key={`marketplace-binding:${source.id}`}
                        testID={`settings.plugins.registries.marketplaceBinding.${source.id}`}
                        open={openBindingSourceId === source.id}
                        onOpenChange={(next) => setOpenBindingSourceId(next ? source.id : null)}
                        variant="selectable"
                        rowKind="item"
                        showCategoryTitles={false}
                        matchTriggerWidth
                        connectToTrigger
                        selectedId={source.registryProfileId ?? UNBOUND_REGISTRY_PROFILE_ID}
                        trigger={({ open, toggle }) => (
                            <Item
                                testID={`settings.plugins.registries.marketplaceSource.${source.id}`}
                                title={source.title}
                                subtitle={boundProfile
                                    ? `${boundProfile.displayName} · ${boundProfile.origin}`
                                    : source.registryProfileId ?? source.sourceUrl}
                                subtitleLines={0}
                                icon={<Icon name="globe" size={29} color={theme.colors.text.secondary} />}
                                rightElement={(
                                    <Icon
                                        name={open ? 'caret-up' : 'caret-down'}
                                        size={16}
                                        color={theme.colors.text.secondary}
                                    />
                                )}
                                onPress={toggle}
                                disabled={bindingDisabled}
                                loading={busyBindingSourceId === source.id}
                                accessibilityExpanded={open}
                                showChevron={false}
                            />
                        )}
                        items={[
                            {
                                id: UNBOUND_REGISTRY_PROFILE_ID,
                                testID: `settings.plugins.registries.unbind.${source.id}`,
                                title: t('settingsPlugins.registriesMarketplaceUnbind', { source: source.title }),
                            },
                            ...snapshot.profiles.map((profile) => ({
                                id: profile.profileId,
                                testID: `settings.plugins.registries.bind.${source.id}.${profile.profileId}`,
                                title: t('settingsPlugins.registriesMarketplaceBind', {
                                    profile: profile.displayName,
                                    source: source.title,
                                }),
                                subtitle: profile.origin,
                            })),
                        ]}
                        onSelect={(profileId) => {
                            void setMarketplaceBinding(
                                source.id,
                                profileId === UNBOUND_REGISTRY_PROFILE_ID ? null : profileId,
                            );
                        }}
                    />
                );
            }) : null}
            {snapshot?.pausedSources.map((source) => (
                <Item
                    key={`paused:${source.origin}`}
                    testID={`settings.plugins.registries.paused.${source.origin}`}
                    title={t('settingsPlugins.registriesUpdatePaused')}
                    subtitle={`${source.origin} · ${t(`settingsPlugins.registriesPauseReason.${source.reason}`)}`}
                    mode="info"
                    showChevron={false}
                />
            ))}
        </ItemGroup>
    );
}
