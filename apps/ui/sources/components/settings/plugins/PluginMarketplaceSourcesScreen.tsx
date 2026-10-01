import * as React from 'react';
import { useIsFocused } from '@/components/appShell/workspace/destinationRoute';
import type { MarketplaceSourceV1 } from '@happier-dev/protocol/marketplace';

import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { createActionInputForm } from '@/components/plugins/actions/actionInputForm';
import { presentActionInputForm } from '@/components/plugins/actions/presentActionInputForm';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SectionActionButton } from '@/components/ui/lists/SectionActionButton';
import { buildActionRowAccessibilityLabel } from '@/components/ui/lists/actionRowAccessibility';
import { Modal } from '@/modal';
import { t } from '@/text';

import { NpmRegistryProfilesSection } from './NpmRegistryProfilesSection';
import { usePluginSettingsScreenState } from './model/usePluginSettingsScreenState';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';

/**
 * The incumbent failure presentation for administration mutations: one modal
 * alert instead of an escaped rejection, mirroring the webhook administration
 * screen.
 */
async function alertSourceOperationFailed(): Promise<void> {
    await Modal.alertAsync(t('common.error'), t('settingsPlugins.sourceAdministration.operationFailed'));
}

async function presentSourceMutationSettlement(
    settlement: Readonly<{ status: 'success' | 'unavailable' | 'outcomeUnknown' | 'superseded' }>,
): Promise<void> {
    if (settlement.status === 'outcomeUnknown') {
        await Modal.alertAsync(
            t('settingsPlugins.sourceAdministration.operationOutcomeUnknownTitle'),
            t('settingsPlugins.sourceAdministration.operationOutcomeUnknownBody'),
        );
    } else if (settlement.status === 'unavailable') {
        await alertSourceOperationFailed();
    }
}

async function readSourceDraft(): Promise<Readonly<{
    sourceUrl: string;
}> | null> {
    const sourceUrl = (await Modal.prompt(
        t('settingsPlugins.sourceAdministration.sourceUrl'),
        t('settingsPlugins.sourceAdministration.subtitle'),
        {
            placeholder: 'https://plugins.example.com/index.json',
            confirmText: t('common.save'),
            cancelText: t('common.cancel'),
        },
    ))?.trim();
    if (!sourceUrl) return null;
    return { sourceUrl };
}

export const PluginMarketplaceSourcesScreen = React.memo(function PluginMarketplaceSourcesScreen() {
    const isFocused = useIsFocused();
    const state = usePluginSettingsScreenState({ focused: isFocused });
    const [busySourceId, setBusySourceId] = React.useState<string | null>(null);
    const configuredSources = state.marketplaceSourceRegistry?.sources ?? [];
    const mutationsDisabled = !state.daemonAdministrationAvailable
        || busySourceId !== null
        || state.marketplaceSourceRegistryMutationInFlight;

    const add = React.useCallback(async () => {
        const draft = await readSourceDraft();
        if (!draft) return;
        setBusySourceId('new');
        try {
            await presentSourceMutationSettlement(await state.upsertMarketplaceSource({ ...draft, origin: 'user', enabled: true }));
        } catch {
            await alertSourceOperationFailed();
        } finally {
            setBusySourceId(null);
        }
    }, [state]);

    const edit = React.useCallback((source: MarketplaceSourceV1) => {
        if (source.origin !== 'user') return;
        // One incumbent form keeps all safe fields editable together and
        // retains them after rejection. Registry validation and writes remain
        // with the exact-target administration owner.
        const form = createActionInputForm({
            presentation: {
                title: t('settingsPlugins.sourceAdministration.edit'),
                description: t('settingsPlugins.sourceAdministration.subtitle'),
                inputHints: {
                    submitLabel: t('common.save'),
                    fields: [
                        { path: 'sourceUrl', title: t('settingsPlugins.sourceAdministration.sourceUrl'), widget: 'url', required: true },
                        { path: 'title', title: t('settingsPlugins.sourceAdministration.displayName'), widget: 'text', required: true },
                        { path: 'description', title: t('settingsPlugins.sourceAdministration.description'), widget: 'textarea' },
                    ],
                },
            },
            submit: async (candidate) => {
                const sourceUrl = typeof candidate.sourceUrl === 'string' ? candidate.sourceUrl.trim() : '';
                const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
                if (!sourceUrl || !title) return { ok: false };
                const description = typeof candidate.description === 'string' ? candidate.description.trim() || null : null;
                setBusySourceId(source.id);
                try {
                    const settlement = await state.upsertMarketplaceSource({
                        sourceUrl, title, description,
                        sourceId: source.id,
                        origin: 'user',
                        enabled: source.enabled,
                        registryProfileId: source.registryProfileId,
                    });
                    await presentSourceMutationSettlement(settlement);
                    // Never offer an immediate repeat of an uncertain write.
                    // The registry owner and refresh remain its recovery path.
                    return { ok: settlement.status !== 'unavailable' };
                } catch {
                    await alertSourceOperationFailed();
                    return { ok: false };
                } finally {
                    setBusySourceId(null);
                }
            },
        });
        form.replaceInput({ sourceUrl: source.sourceUrl, title: source.title, description: source.description ?? '' });
        presentActionInputForm({ form });
    }, [state]);

    const remove = React.useCallback(async (source: MarketplaceSourceV1) => {
        const confirmed = await Modal.confirm(
            t('settingsPlugins.sourceAdministration.removeTitle'),
            t('settingsPlugins.sourceAdministration.removeBody', { name: source.title }),
            { confirmText: t('settingsPlugins.sourceAdministration.remove'), cancelText: t('common.cancel'), destructive: true },
        );
        if (!confirmed) return;
        setBusySourceId(source.id);
        try {
            await presentSourceMutationSettlement(await state.removeMarketplaceSource(source.id));
        } catch {
            await alertSourceOperationFailed();
        } finally {
            setBusySourceId(null);
        }
    }, [state]);

    return (
        <ItemList presentation="page">
            <SettingsPageHeader
                description={t('settingsPlugins.sourceAdministration.subtitle')}
                actions={(
                    <MachineAdministrationTargetSelector
                        selection={state.administrationTargetSelection}
                        testIDPrefix="settings.plugins.sources.target"
                        presentation="chip"
                    />
                )}
            />

            <ItemGroup
                title={t('settingsPlugins.sourceAdministration.configuredTitle')}
                action={(
                    <SectionActionButton
                        testID="settings.plugins.sources.add"
                        title={t('settingsPlugins.sourceAdministration.add')}
                        icon="plus"
                        onPress={() => { void add(); }}
                        disabled={mutationsDisabled || state.marketplaceSourceRegistry === null}
                        loading={busySourceId === 'new'}
                    />
                )}
            >
                <Item
                    testID="settings.plugins.sources.communityNpm"
                    title={t('settingsPlugins.sourceAdministration.communityTitle')}
                    subtitle={t('settingsPlugins.sourceAdministration.communitySubtitle')}
                    mode="info"
                    showChevron={false}
                    accessibilityLabel={`${t('settingsPlugins.sourceAdministration.communityTitle')}. ${t('settingsPlugins.sourceAdministration.communitySubtitle')}`}
                />
                {state.marketplaceSourceRegistryLoadError ? (
                    <Item
                        testID="settings.plugins.sources.retry"
                        title={t('settingsPlugins.sourceAdministration.loadError')}
                        subtitle={t('settingsPlugins.sourceAdministration.retry')}
                        onPress={state.refreshMarketplaceSourceRegistry}
                        showChevron={false}
                    />
                ) : null}
                {state.marketplaceSourceRegistryMutationOutcomeUnknown ? (
                    <Item
                        testID="settings.plugins.sources.outcomeUnknown"
                        title={t('settingsPlugins.sourceAdministration.operationOutcomeUnknownTitle')}
                        subtitle={t('settingsPlugins.sourceAdministration.operationOutcomeUnknownBody')}
                        onPress={state.refreshMarketplaceSourceRegistry}
                        showChevron={false}
                    />
                ) : null}
                {/* Rows render only from the authoritative registry. While the
                    one registry owner is loading, its loading truth is shown
                    beside any retained last-known rows instead of presenting a
                    false "no sources" answer; a failed read with no retained
                    registry is answered by the retry row above, never by the
                    empty state. */}
                {state.marketplaceSourceRegistryLoading ? (
                    <Item
                        testID="settings.plugins.sources.loading"
                        title={t('common.loading')}
                        mode="info"
                        showChevron={false}
                    />
                ) : null}
                {state.marketplaceSourceRegistry === null && !state.marketplaceSourceRegistryLoading && !state.marketplaceSourceRegistryLoadError ? (
                    <Item
                        testID="settings.plugins.sources.unavailable"
                        title={t('common.unavailable')}
                        subtitle={state.administrationTargetLabel
                            ? `${state.administrationTargetLabel.machine} · ${state.administrationTargetLabel.server}`
                            : t('newSession.noMachineSelected')}
                        subtitleLines={0}
                        detail={state.daemonAdministrationAvailable ? t('common.retry') : undefined}
                        onPress={state.daemonAdministrationAvailable ? state.refreshMarketplaceSourceRegistry : undefined}
                        mode={state.daemonAdministrationAvailable ? 'interactive' : 'info'}
                        showChevron={false}
                    />
                ) : null}
                {state.marketplaceSourceRegistry !== null && configuredSources.length === 0 && !state.marketplaceSourceRegistryLoading && !state.marketplaceSourceRegistryLoadError ? (
                    <Item
                        testID="settings.plugins.sources.empty"
                        title={t('settingsPlugins.sourceAdministration.configuredEmpty')}
                        mode="info"
                        showChevron={false}
                    />
                ) : configuredSources.map((source) => {
                    const userOwned = source.origin === 'user';
                    return (
                        <React.Fragment key={source.id}>
                            {/* Enable/disable is a registry mutation every persisted
                                source supports, curated and user alike, through the
                                same setEnabled owner; editing and removal stay
                                user-only. */}
                            <Item
                                testID={`settings.plugins.sources.source.${source.id}`}
                                title={source.title}
                                subtitle={`${source.sourceUrl}\n${t(source.enabled ? 'settingsPlugins.sourceAdministration.enabled' : 'settingsPlugins.sourceAdministration.disabled')} · ${t(userOwned ? 'settingsPlugins.sourceAdministration.user' : 'settingsPlugins.sourceAdministration.curated')}`}
                                onPress={userOwned ? () => { void edit(source); } : undefined}
                                mode={userOwned ? 'interactive' : 'info'}
                                disabled={userOwned && mutationsDisabled}
                                loading={busySourceId === source.id}
                                showChevron={userOwned}
                                rightElement={(
                                    <Switch
                                        testID={`settings.plugins.sources.enabled.${source.id}`}
                                        accessibilityLabel={`${source.title}: ${t(source.enabled ? 'settingsPlugins.sourceAdministration.enabled' : 'settingsPlugins.sourceAdministration.disabled')}`}
                                        accessibilityState={{ checked: source.enabled, disabled: mutationsDisabled }}
                                        value={source.enabled}
                                        disabled={mutationsDisabled}
                                        onValueChange={(enabled) => {
                                            setBusySourceId(source.id);
                                            void state.setMarketplaceSourceEnabled(source.id, enabled)
                                                .then(presentSourceMutationSettlement)
                                                .catch(() => alertSourceOperationFailed())
                                                .finally(() => setBusySourceId(null));
                                        }}
                                    />
                                )}
                                rightElementOutsidePressable={userOwned}
                            />
                            {userOwned ? (
                                <Item
                                    testID={`settings.plugins.sources.remove.${source.id}`}
                                    title={t('settingsPlugins.sourceAdministration.remove')}
                                    accessibilityLabel={buildActionRowAccessibilityLabel([
                                        t('settingsPlugins.sourceAdministration.remove'),
                                        source.title,
                                    ])}
                                    onPress={() => { void remove(source); }}
                                    disabled={mutationsDisabled}
                                    destructive
                                    showChevron={false}
                                />
                            ) : null}
                        </React.Fragment>
                    );
                })}
            </ItemGroup>

            <NpmRegistryProfilesSection
                daemonOperationsAvailable={state.daemonAdministrationAvailable}
                targetSelection={state.administrationTargetSelection}
                marketplaceSources={configuredSources}
                onSetMarketplaceSourceProfile={state.setMarketplaceSourceProfile}
                marketplaceSourceMutationInFlight={state.marketplaceSourceRegistryMutationInFlight}
            />
        </ItemList>
    );
});
