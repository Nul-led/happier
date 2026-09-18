import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { SessionGettingStartedGuidance } from '@/components/sessions/guidance/SessionGettingStartedGuidance';
import { useShouldBlockNewSessionWithGettingStartedGuidance } from '@/components/sessions/guidance/useShouldBlockNewSessionWithGettingStartedGuidance';
import { NewSessionSimplePanel } from '@/components/sessions/new/components/NewSessionSimplePanel';
import { NewSessionWizard } from '@/components/sessions/new/components/NewSessionWizard';
import { NewSessionLaunchSurface } from '@/components/sessions/new/components/NewSessionLaunchSurface';
import { useNewSessionScreenModel } from '@/components/sessions/new/hooks/useNewSessionScreenModel';
import type { ExactTurnAutomationPrefill } from '@/components/automations/sessionLifecycle/exactTurnAutomationPrefill';
import { NewSessionScreenPortalScope } from '@/components/sessions/new/navigation/newSessionContainedModalScreen';
import {
    resolveNewSessionDraftRouteIdentity,
    resolveNewSessionDraftRouteScope,
} from '@/components/sessions/new/navigation/newSessionDraftRouteIdentity';
import { useResolveNewSessionOrdinaryEntryRoute } from '@/components/sessions/new/navigation/newSessionOrdinaryEntryRoute';
import { isNewSessionDraftLaunchInCustody } from '@/components/sessions/new/modules/newSessionDraftLaunchCustody';
import { NewSessionDraftComposerActions } from '@/components/sessions/drafts/NewSessionDraftComposerActions';
import { deleteNewSessionDraftAfterConfirmation } from '@/components/sessions/drafts/deleteNewSessionDraftAfterConfirmation';
import { buildSessionDraftSyncStatusBadge } from '@/components/sessions/drafts/sessionDraftStatusPresentation';
import {
    SessionDraftConflictResolution,
    useSessionDraftConflictComposerBanner,
} from '@/components/sessions/drafts/SessionDraftConflictResolution';
import { ComposerBannerCollapseProvider } from '@/components/sessions/composerBanners/ComposerBannerCollapseProvider';
import { ComposerAuxiliaryFrame } from '@/components/sessions/shell/view/ComposerAuxiliaryFrame';
import type { AgentInputStatusBadge } from '@/components/sessions/agentInput/agentInputContracts';
import { Modal } from '@/modal';
import { readAllActionOperations, useAllActionOperations } from '@/sync/domains/actionOperations/useActionOperations';
import { parseNewSessionCheckoutDraft } from '@/sync/domains/state/newSessionCheckoutDraft';
import {
    clearNewSessionOrdinaryEntryDraftIdExact,
    setNewSessionOrdinaryEntryDraftId,
} from '@/sync/domains/settings/localOnlyAccountSettings';
import { useActiveServerAccountScope, useSettingMutable } from '@/sync/store/hooks';
import {
    getSessionDraftSnapshot,
    subscribeSessionDraft,
    deleteSessionDraft,
    deleteSessionDraftWithScopedRuntime,
    type SessionDraftSnapshot,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { useServerCredentialAccountScopeBindings, useServerCredentialAccountScopeResolution } from '@/sync/domains/scope/useServerCredentialAccountScopes';
import { areServerAccountScopesEqual } from '@/sync/domains/scope/serverAccountScope';
import { getServerProfileById } from '@/sync/domains/server/serverProfiles';
import { createServerFetchAtEndpoint } from '@/sync/http/client';
import { runWithSessionDraftRepositoryScopedRuntime } from '@/sync/ops/sessionDrafts/runWithSessionDraftRepositoryScopedRuntime';
import { peekTempData, type NewSessionData } from '@/utils/sessions/tempDataStore';
import { t } from '@/text';

function hasSeededCheckoutIntent(value: unknown): boolean {
    const draft = parseNewSessionCheckoutDraft(value);
    return draft.checkoutCreationDraft !== null;
}

function NewSessionScreenInner(props: Readonly<{
    composerTopContent?: React.ReactNode;
    draftId: string;
    statusBadges?: ReadonlyArray<AgentInputStatusBadge>;
    statusTrailingActions?: React.ReactNode;
    automationExactTurnRetarget?: ExactTurnAutomationPrefill | null;
}>) {
    const model = useNewSessionScreenModel(props);

    if (model.variant === 'simple') {
        return (
            <NewSessionLaunchSurface
                overlay={model.launchOverlay}
                onRequestClose={model.launchOnRequestClose}
                overlayPresentation={model.overlayPresentation}
                focusReturnRef={model.overlayFocusReturnRef}
                overlayAccessibilityLabel={model.overlayAccessibilityLabel}
            >
                <NewSessionSimplePanel {...model.simpleProps} />
            </NewSessionLaunchSurface>
        );
    }

    const { layout, profiles, agent, machine, footer } = model.wizardProps;

    return (
        <NewSessionLaunchSurface
            overlay={model.launchOverlay}
            onRequestClose={model.launchOnRequestClose}
            overlayPresentation={model.overlayPresentation}
            focusReturnRef={model.overlayFocusReturnRef}
            overlayAccessibilityLabel={model.overlayAccessibilityLabel}
        >
            <NewSessionWizard
                popoverBoundaryRef={model.popoverBoundaryRef}
                layout={layout}
                profiles={profiles}
                agent={agent}
                machine={machine}
                footer={footer}
            />
        </NewSessionLaunchSurface>
    );
}

function NewSessionContent(props: Readonly<{
    allowBlockingGuidance: boolean;
    composerTopContent?: React.ReactNode;
    draftId: string;
    statusBadges?: ReadonlyArray<AgentInputStatusBadge>;
    statusTrailingActions?: React.ReactNode;
    automationExactTurnRetarget?: ExactTurnAutomationPrefill | null;
}>) {
    const shouldBlock = useShouldBlockNewSessionWithGettingStartedGuidance();

    if (props.allowBlockingGuidance && shouldBlock) {
        return <SessionGettingStartedGuidance variant="newSessionBlocking" />;
    }

    return (
        <NewSessionScreenPortalScope>
            <NewSessionScreenInner {...props} />
        </NewSessionScreenPortalScope>
    );
}

function NewSessionScreen(props: Readonly<{
    automationExactTurnRetarget?: ExactTurnAutomationPrefill | null;
}>) {
    const router = useRouter();
    const {
        dataId,
        draftId: routeDraftId,
        draftOrigin,
        machineId,
        directory,
        draftServerId,
        draftAccountId,
    } = useLocalSearchParams<{
        dataId?: string;
        draftId?: string;
        draftOrigin?: string;
        spawnServerId?: string;
        machineId?: string;
        directory?: string;
        draftServerId?: string;
        draftAccountId?: string;
    }>();
    const activeDraftScope = useActiveServerAccountScope();
    const requestedDraftScopeResolution = useServerCredentialAccountScopeResolution(draftServerId);
    const draftScope = resolveNewSessionDraftRouteScope({
        activeScope: activeDraftScope,
        draftServerId,
        draftAccountId,
        requestedScopeResolution: requestedDraftScopeResolution,
    });
    const requestedDraftScopeBindings = useServerCredentialAccountScopeBindings(
        draftServerId ? [draftServerId] : [],
    );
    const requestedDraftScopeBinding = draftServerId
        ? [...requestedDraftScopeBindings.values()].find((binding) => (
            draftScope !== null && areServerAccountScopesEqual(binding.scope, draftScope)
        )) ?? null
        : null;
    const requestedDraftProfile = React.useMemo(
        () => draftScope && requestedDraftScopeBinding
            ? getServerProfileById(draftScope.serverId)
            : null,
        [draftScope, requestedDraftScopeBinding],
    );
    const requestedDraftActiveRequest = React.useMemo(
        () => requestedDraftProfile && draftScope
            ? createServerFetchAtEndpoint({
                endpointUrl: requestedDraftProfile.serverUrl,
                serverId: draftScope.serverId,
            })
            : null,
        [draftScope, requestedDraftProfile],
    );
    const resolveOrdinaryEntry = useResolveNewSessionOrdinaryEntryRoute();
    const [ordinaryEntryDraftId, setOrdinaryEntryDraftId] = useSettingMutable('newSessionOrdinaryEntryDraftId');
    const draftIdentity = React.useMemo(() => {
        const explicitIdentity = resolveNewSessionDraftRouteIdentity({ routeDraftId });
        if (!explicitIdentity.shouldWriteRouteParam) {
            return {
                draftId: explicitIdentity.draftId,
                draftOrigin: draftOrigin === 'ordinary' ? 'ordinary' as const : null,
                shouldWriteRouteParam: false,
            };
        }
        const ordinaryEntry = resolveOrdinaryEntry();
        return {
            draftId: ordinaryEntry.draftId,
            draftOrigin: ordinaryEntry.draftOrigin,
            shouldWriteRouteParam: true,
        };
    }, [draftOrigin, resolveOrdinaryEntry, routeDraftId]);
    React.useEffect(() => {
        if (!draftIdentity.shouldWriteRouteParam) return;
        router.setParams({ draftId: draftIdentity.draftId, draftOrigin: draftIdentity.draftOrigin ?? undefined });
    }, [draftIdentity.draftId, draftIdentity.draftOrigin, draftIdentity.shouldWriteRouteParam, router]);
    const draftAddress = React.useMemo(() => ({
        kind: 'newSession' as const,
        draftId: draftIdentity.draftId,
    }), [draftIdentity.draftId]);
    const subscribeDraft = React.useCallback((listener: () => void) => (
        draftScope ? subscribeSessionDraft(draftScope, draftAddress, listener) : () => undefined
    ), [draftAddress, draftScope]);
    const getDraftSnapshot = React.useCallback((): SessionDraftSnapshot | null => (
        draftScope ? getSessionDraftSnapshot(draftScope, draftAddress) : null
    ), [draftAddress, draftScope]);
    const exactDraft = React.useSyncExternalStore(subscribeDraft, getDraftSnapshot, getDraftSnapshot);
    React.useEffect(() => {
        if (draftIdentity.draftOrigin !== 'ordinary' || exactDraft?.materialized !== true) return;
        const pointerDelta = setNewSessionOrdinaryEntryDraftId(draftIdentity.draftId);
        if (pointerDelta && pointerDelta.newSessionOrdinaryEntryDraftId !== ordinaryEntryDraftId) {
            setOrdinaryEntryDraftId(pointerDelta.newSessionOrdinaryEntryDraftId);
        }
    }, [draftIdentity.draftId, draftIdentity.draftOrigin, exactDraft?.materialized, ordinaryEntryDraftId, setOrdinaryEntryDraftId]);
    const actionOperations = useAllActionOperations();
    const launchInCustody = Boolean(draftScope && exactDraft && isNewSessionDraftLaunchInCustody({
        accountId: draftScope.accountId,
        launchUserAttemptId: exactDraft.localSupplement.launchUserAttemptId,
        operations: actionOperations,
    }));
    const startAnother = React.useCallback(() => {
        const nextEntry = resolveOrdinaryEntry({ forceFresh: true });
        router.push({ pathname: '/new', params: {
            draftId: nextEntry.draftId,
            draftOrigin: nextEntry.draftOrigin,
        } });
    }, [resolveOrdinaryEntry, router]);
    const deleteDraft = React.useCallback(async () => {
        if (!draftScope || launchInCustody) return;
        const deleted = await deleteNewSessionDraftAfterConfirmation({
            confirm: () => Modal.confirm(
                t('sessionDrafts.delete.confirmTitle'),
                t('sessionDrafts.delete.confirmDescription'),
                { confirmText: t('common.delete'), cancelText: t('common.cancel'), destructive: true },
            ),
            readCurrentDraftDeletionDisposition: () => {
                const currentDraft = getSessionDraftSnapshot(draftScope, draftAddress);
                if (!currentDraft) return 'missing';
                return isNewSessionDraftLaunchInCustody({
                    accountId: draftScope.accountId,
                    launchUserAttemptId: currentDraft.localSupplement.launchUserAttemptId,
                    operations: readAllActionOperations(),
                }) ? 'launch-custody' : 'deletable';
            },
            deleteDraft: () => {
                if (activeDraftScope && areServerAccountScopesEqual(activeDraftScope, draftScope)) {
                    return deleteSessionDraft({ scope: draftScope, address: draftAddress });
                }
                if (!requestedDraftScopeBinding || !requestedDraftActiveRequest) return Promise.resolve(false);
                return runWithSessionDraftRepositoryScopedRuntime({
                    binding: requestedDraftScopeBinding,
                    activeRequest: requestedDraftActiveRequest,
                    operation: ({ runtime, isCurrent }) => deleteSessionDraftWithScopedRuntime({
                        scope: draftScope,
                        address: draftAddress,
                        runtime,
                        isCurrent,
                    }),
                }).then((deleted) => deleted === true);
            },
        });
        if (!deleted) return;
        const pointerDelta = clearNewSessionOrdinaryEntryDraftIdExact(
            { newSessionOrdinaryEntryDraftId: ordinaryEntryDraftId },
            draftIdentity.draftId,
        );
        if (pointerDelta) setOrdinaryEntryDraftId(pointerDelta.newSessionOrdinaryEntryDraftId);
        const nextEntry = resolveOrdinaryEntry({ forceFresh: true });
        router.replace({ pathname: '/new', params: {
            draftId: nextEntry.draftId,
            draftOrigin: nextEntry.draftOrigin,
        } });
    }, [
        activeDraftScope,
        draftAddress,
        draftIdentity.draftId,
        draftScope,
        launchInCustody,
        ordinaryEntryDraftId,
        requestedDraftActiveRequest,
        requestedDraftScopeBinding,
        resolveOrdinaryEntry,
        router,
        setOrdinaryEntryDraftId,
    ]);

    const tempData = React.useMemo(() => {
        return typeof dataId === 'string' ? peekTempData<NewSessionData>(dataId) : null;
    }, [dataId]);

    const hasSeededDraftIntent = React.useMemo(() => {
        if (exactDraft?.materialized === true) return true;
        return hasSeededCheckoutIntent({ checkoutCreationDraft: tempData?.checkoutCreationDraft ?? null });
    }, [exactDraft?.materialized, tempData?.checkoutCreationDraft]);

    const hasSeededRouteIntent = React.useMemo(() => {
        return (
            (typeof machineId === 'string' && machineId.trim().length > 0)
            || (typeof directory === 'string' && directory.trim().length > 0)
            || (typeof tempData?.machineId === 'string' && tempData.machineId.trim().length > 0)
            || (typeof tempData?.directory === 'string' && tempData.directory.trim().length > 0)
            || (typeof tempData?.path === 'string' && tempData.path.trim().length > 0)
        );
    }, [machineId, directory, tempData]);

    const draftConflictBanner = useSessionDraftConflictComposerBanner(exactDraft?.conflict ?? null);
    const draftSyncStatusBadge = React.useMemo(
        () => buildSessionDraftSyncStatusBadge(exactDraft?.status ?? 'clean'),
        [exactDraft?.status],
    );
    const composerTopContent = React.useMemo(() => (
        draftScope && exactDraft?.materialized === true && exactDraft.conflict && !draftConflictBanner.collapsed ? (
            <ComposerAuxiliaryFrame>
                <SessionDraftConflictResolution
                    scope={draftScope}
                    address={draftAddress}
                    conflict={exactDraft.conflict}
                />
            </ComposerAuxiliaryFrame>
        ) : null
    ), [draftAddress, draftConflictBanner.collapsed, draftScope, exactDraft?.conflict, exactDraft?.materialized]);
    const statusBadges = React.useMemo(() => [
        ...(draftSyncStatusBadge ? [draftSyncStatusBadge] : []),
        ...(draftConflictBanner.statusBadge ? [draftConflictBanner.statusBadge] : []),
    ], [draftConflictBanner.statusBadge, draftSyncStatusBadge]);
    const statusTrailingActions = React.useMemo(() => (
        draftScope && exactDraft?.materialized === true ? (
            <NewSessionDraftComposerActions
                deleteDisabled={launchInCustody}
                onStartAnother={startAnother}
                onDelete={deleteDraft}
            />
        ) : null
    ), [deleteDraft, draftScope, exactDraft?.materialized, launchInCustody, startAnother]);

    return (
        <NewSessionContent
            allowBlockingGuidance={!hasSeededDraftIntent && !hasSeededRouteIntent}
            composerTopContent={composerTopContent}
            draftId={draftIdentity.draftId}
            statusBadges={statusBadges}
            statusTrailingActions={statusTrailingActions}
            automationExactTurnRetarget={props.automationExactTurnRetarget ?? null}
        />
    );
}

function NewSessionScreenWithComposerBannerScope(props: Readonly<{
    automationExactTurnRetarget?: ExactTurnAutomationPrefill | null;
}>) {
    const { draftId } = useLocalSearchParams<{ draftId?: string }>();
    return (
        <ComposerBannerCollapseProvider key={typeof draftId === 'string' ? draftId : 'new-session'}>
            <NewSessionScreen automationExactTurnRetarget={props.automationExactTurnRetarget ?? null} />
        </ComposerBannerCollapseProvider>
    );
}

export default React.memo(NewSessionScreenWithComposerBannerScope);
