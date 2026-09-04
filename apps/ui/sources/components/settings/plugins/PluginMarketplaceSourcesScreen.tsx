import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { useUnistyles } from 'react-native-unistyles';
import type { MarketplaceSourceV1 } from '@happier-dev/protocol/marketplace';

import { MachineAdministrationTargetSelector } from '@/components/settings/machines/MachineAdministrationTargetSelector';
import { Switch } from '@/components/ui/forms/Switch';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { buildActionRowAccessibilityLabel } from '@/components/ui/lists/actionRowAccessibility';
import { Modal } from '@/modal';
import { t } from '@/text';

import { NpmRegistryProfilesSection } from './NpmRegistryProfilesSection';
import { usePluginSettingsScreenState } from './model/usePluginSettingsScreenState';

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

async function readSourceDraft(existing: MarketplaceSourceV1 | null): Promise<Readonly<{
    sourceUrl: string;
    title?: string;
    description?: string | null;
}> | null> {
    const sourceUrl = (await Modal.prompt(
        t('settingsPlugins.sourceAdministration.sourceUrl'),
        t('settingsPlugins.sourceAdministration.subtitle'),
        {
            defaultValue: existing?.sourceUrl,
            placeholder: 'https://plugins.example.com/index.json',
            confirmText: t(existing ? 'common.next' : 'common.save'),
            cancelText: t('common.cancel'),
        },
    ))?.trim();
    if (!sourceUrl) return null;
    // Adding a source needs only the address. The Protocol owner derives a
    // useful hostname title, while Edit remains available for optional
    // presentation metadata. Requiring three prompts before the source exists
    // adds ceremony without establishing another trust fact.
    if (!existing) return { sourceUrl };
    const title = (await Modal.prompt(
        t('settingsPlugins.sourceAdministration.displayName'),
        sourceUrl,
        { defaultValue: existing?.title, confirmText: t('common.next'), cancelText: t('common.cancel') },
    ))?.trim();
    if (!title) return null;
    // The description is optional, so an empty submitted string is a real
    // answer meaning "no description". Cancelling is not: it abandons the whole
    // draft rather than silently saving the source without one.
    const description = await Modal.prompt(
        t('settingsPlugins.sourceAdministration.description'),
        title,
        { defaultValue: existing?.description ?? '', confirmText: t('common.save'), cancelText: t('common.cancel') },
    );
    if (description === null) return null;
    return { sourceUrl, title, description: description.trim() || null };
}

export const PluginMarketplaceSourcesScreen = React.memo(function PluginMarketplaceSourcesScreen() {
    const isFocused = useIsFocused();
    const { theme } = useUnistyles();
    const state = usePluginSettingsScreenState({ focused: isFocused });
    const [busySourceId, setBusySourceId] = React.useState<string | null>(null);
    const configuredSources = state.marketplaceSourceRegistry?.sources ?? [];
    const mutationsDisabled = !state.daemonAdministrationAvailable
        || busySourceId !== null
        || state.marketplaceSourceRegistryMutationInFlight;

    const add = React.useCallback(async () => {
        const draft = await readSourceDraft(null);
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

    const edit = React.useCallback(async (source: MarketplaceSourceV1) => {
        if (source.origin !== 'user') return;
        const draft = await readSourceDraft(source);
        if (!draft) return;
        setBusySourceId(source.id);
        try {
            await presentSourceMutationSettlement(await state.upsertMarketplaceSource({
                ...draft,
                // Target the edited source by its existing identity so changing
                // sourceUrl replaces it in place instead of adding a second source.
                sourceId: source.id,
                origin: 'user',
                enabled: source.enabled,
                registryProfileId: source.registryProfileId,
            }));
        } catch {
            await alertSourceOperationFailed();
        } finally {
            setBusySourceId(null);
        }
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
        <ItemList>
            <MachineAdministrationTargetSelector
                selection={state.administrationTargetSelection}
                testIDPrefix="settings.plugins.sources.target"
            />

            <ItemGroup
                title={t('settingsPlugins.sourceAdministration.title')}
                footer={t('settingsPlugins.sourceAdministration.subtitle')}
            >
                <Item
                    testID="settings.plugins.sources.communityNpm"
                    title={t('settingsPlugins.sourceAdministration.communityTitle')}
                    subtitle={t('settingsPlugins.sourceAdministration.communitySubtitle')}
                    icon={<Icon name="globe" size={29} color={theme.colors.accent.indigo} />}
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
                <Item
                    testID="settings.plugins.sources.add"
                    title={t('settingsPlugins.sourceAdministration.add')}
                    icon={<Icon name="plus" size={29} color={theme.colors.accent.green} />}
                    onPress={() => { void add(); }}
                    disabled={mutationsDisabled || state.marketplaceSourceRegistry === null}
                    loading={busySourceId === 'new'}
                    showChevron={false}
                />
            </ItemGroup>

            <ItemGroup title={t('settingsPlugins.sourceAdministration.configuredTitle')}>
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
                {configuredSources.length === 0 && !state.marketplaceSourceRegistryLoading && !state.marketplaceSourceRegistryLoadError ? (
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
                                        accessibilityLabel={`${source.title}: ${t('settingsPlugins.sourceAdministration.enabled')}`}
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
