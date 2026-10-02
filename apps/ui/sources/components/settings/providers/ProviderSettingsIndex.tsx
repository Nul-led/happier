import * as React from 'react';
import { View } from 'react-native';
import { Redirect, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useIsFocused } from '@/components/appShell/workspace/destinationRoute';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { MachineAdministrationContextBar } from '@/components/settings/machines/MachineAdministrationContextBar';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { EmptyState } from '@/components/ui/empty/EmptyState';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { ProviderIcon } from '@/providers/connection/ProviderIcon';
import { useProviderSettingsTarget } from '@/providers/hooks/targetMachine';
import { useProviderConnections } from '@/providers/hooks/useProviderConnections';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { ProviderConnectionsSettingsScreen } from './ProviderConnectionsSettingsScreen';
import { ProviderErrorItems } from './ProviderErrorItems';
import { ProviderFeatureAvailabilityNotice, useProviderFeatureAvailability } from './ProviderFeatureAvailability';
import { AddProviderMenu, newProviderRoute } from './collection/AddProviderMenu';
import {
    buildProviderCollection,
    readLastVisitedProviderConnectionId,
    resolveProviderCollectionLandingId,
} from './collection/providerCollectionModel';
import { useHappierCollectionIndexView } from '@happier-dev/plugin-ui/presentation';

/** How many catalog marks the invitation shows. */
const INVITATION_MARK_COUNT = 5;

/**
 * `/settings/providers`. Beside the rail a provider is always selected, so the index lands on one;
 * with nothing to select it is a warm invitation to add the first. Where no rail shows, the index is
 * the provider list and each row pushes its detail.
 */
export const ProviderSettingsIndex = React.memo(function ProviderSettingsIndex() {
    const view = useHappierCollectionIndexView();
    if (view === 'pending') return null;
    if (view === 'land') return <ProviderCollectionLanding />;
    return <ProviderConnectionsSettingsScreen variant="page" />;
});

const ProviderCollectionLanding = React.memo(function ProviderCollectionLanding() {
    const router = useRouter();
    const focused = useIsFocused();
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const { enabled, presentation: availabilityPresentation } = useProviderFeatureAvailability();
    const localDiscoveryEnabled = useFeatureEnabled('providers.localDiscovery');
    const providerTarget = useProviderSettingsTarget();
    const { machineId, serverId } = providerTarget;
    const { data, error, loading, refresh } = useProviderConnections({ enabled, active: focused, machineId, serverId });
    const collection = React.useMemo(() => buildProviderCollection({
        data, query: '', localDiscoveryEnabled,
    }), [data, localDiscoveryEnabled]);
    const navigate = React.useCallback((href: string) => {
        const result = runGuardedNavigation(() => router.replace(href as never));
        if (result !== true) fireAndForget(result, { tag: 'ProviderCollectionLanding.navigate' });
    }, [router]);

    const landingId = resolveProviderCollectionLandingId(collection.connections, readLastVisitedProviderConnectionId());
    if (landingId) return <Redirect href={`/(app)/settings/providers/${landingId}` as never} />;

    const contextBar = (
        <MachineAdministrationContextBar
            label={t('settingsProvidersCollection.machineScopeLabel')}
            selection={providerTarget.selection}
            testIDPrefix="settings.providers.administration.target"
        />
    );
    if (availabilityPresentation) {
        return (
            <ItemList>
                {contextBar}
                <ItemGroup><ProviderFeatureAvailabilityNotice presentation={availabilityPresentation} /></ItemGroup>
            </ItemList>
        );
    }
    // The machine could not answer: say what failed with its recovery, never a blank pane.
    if (machineId && !data && error && !loading) {
        return (
            <ItemList>
                {contextBar}
                <ItemGroup>
                    <ProviderErrorItems error={error} retry={async () => { await refresh(); }} />
                </ItemGroup>
            </ItemList>
        );
    }
    // Wait for the machine's answer so the invitation never flashes over an existing collection.
    if (machineId && (loading || !data)) return <ItemList>{contextBar}</ItemList>;

    const available = data?.available ?? [];
    const marks = available.filter((provider) => provider.icon).slice(0, INVITATION_MARK_COUNT);
    return (
        <ItemList>
            {contextBar}
            <>
                <EmptyState
                    testID="settings-providers-invitation"
                    layout="page"
                    // Adding is the next step only when there is a machine to add a provider on.
                    variant={machineId ? 'add' : 'default'}
                    icon={marks.length > 0 ? (
                        <View style={styles.marks}>
                            {marks.map((provider) => (
                                <ProviderIcon key={provider.contributionKey} icon={provider.icon} size={24} color={theme.colors.text.secondary} />
                            ))}
                        </View>
                    ) : (
                        <ProviderIcon icon={null} size={29} color={theme.colors.text.secondary} />
                    )}
                    title={t('settingsProvidersCollection.invitationTitle')}
                    subtitle={machineId
                        ? t('settingsProvidersCollection.invitationDescription')
                        : t('settingsProvidersCollection.invitationNeedsMachine')}
                    action={machineId ? (
                        <View style={styles.actions}>
                            <AddProviderMenu
                                available={available}
                                include="catalog"
                                onAdd={navigate}
                                renderTrigger={(toggle) => (
                                    <RoundButton
                                        testID="settings-providers-invitation-add"
                                        size="normal"
                                        title={t('settingsProvidersCollection.addProvider')}
                                        disabled={available.length === 0}
                                        onPress={toggle}
                                    />
                                )}
                            />
                            <RoundButton
                                testID="settings-providers-invitation-custom"
                                size="normal"
                                display="secondary"
                                title={t('settingsProvidersCollection.customEndpoint')}
                                onPress={() => navigate(newProviderRoute(null))}
                            />
                        </View>
                    ) : (
                        <RoundButton
                            testID="settings-providers-invitation-machines"
                            size="normal"
                            display="secondary"
                            title={t('settingsProvidersCollection.setUpMachine')}
                            onPress={() => {
                                const result = runGuardedNavigation(() => router.push('/(app)/settings/machines' as never));
                                if (result !== true) fireAndForget(result, { tag: 'ProviderCollectionLanding.machines' });
                            }}
                        />
                    )}
                />
            </>
        </ItemList>
    );
});

const stylesheet = StyleSheet.create(() => ({
    marks: {
        flexDirection: 'row',
        gap: 14,
    },
    actions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: 8,
    },
}));
