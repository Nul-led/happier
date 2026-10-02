import * as React from 'react';
import { Redirect, useRouter } from '@/components/appShell/workspace/destinationRoute';
import { useUnistyles } from 'react-native-unistyles';
import { HappierCollectionListMark, resolveHappierCollectionInitialKey, useHappierCollectionIndexView } from '@happier-dev/plugin-ui/presentation';

import { useRoleCatalog } from '@/components/roles/catalog/useRoleCatalog';
import { useRoleEnginePresentation } from '@/components/roles/catalog/useRoleEnginePresentation';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { Icon } from '@/components/ui/icons/Icon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SurfaceStateCard } from '@/components/ui/surfaces/SurfaceStateCard';
import { t } from '@/text';

import { groupRoleCatalog, openRoleCollectionHref, useDescribeRoleRow } from './RoleCollectionRail';
import { newRoleRoute, readLastVisitedRoleId, roleRoute } from './roleCollectionRoutes';

/**
 * `/settings/roles`. Beside the rail a role is always selected, so the index lands on one. Where no
 * rail shows, the index is the role list and each role pushes its detail.
 */
export const RoleSettingsIndex = React.memo(function RoleSettingsIndex() {
    const view = useHappierCollectionIndexView();
    if (view === 'pending') return null;
    if (view === 'land') return <RoleCollectionLanding />;
    return <RoleCollectionPage />;
});

const RoleCollectionLanding = React.memo(function RoleCollectionLanding() {
    const catalog = useRoleCatalog();
    const landingId = resolveHappierCollectionInitialKey({
        keys: catalog.entries.map((entry) => entry.roleId),
        lastVisited: readLastVisitedRoleId(),
    });
    if (!landingId) {
        return (
            <ItemList>
                <SurfaceStateCard
                    testID="settings.roles.landing"
                    kind={catalog.status === 'failed' ? 'error' : 'loading'}
                    title={catalog.status === 'failed' ? t('roles.settings.loadFailed') : t('roles.settings.emptyDetailTitle')}
                    action={catalog.status === 'failed' ? { label: t('common.retry'), onPress: catalog.refresh } : undefined}
                />
            </ItemList>
        );
    }
    return <Redirect href={roleRoute(landingId) as never} />;
});

const RoleCollectionPage = React.memo(function RoleCollectionPage() {
    const router = useRouter();
    const { theme } = useUnistyles();
    const catalog = useRoleCatalog();
    const presentEngine = useRoleEnginePresentation();
    const describe = useDescribeRoleRow();
    const groups = groupRoleCatalog(catalog.entries, '');
    return (
        <ItemList testID="settings.roles.page">
            <SettingsPageHeader description={t('roles.settings.description')} />
            {groups.map((group) => (
                <ItemGroup key={group.id} title={group.title}>
                    {group.entries.map((entry) => (
                        <Item
                            key={entry.roleId}
                            testID={`settings.roles.page.row.${entry.roleId}`}
                            title={entry.role.name}
                            subtitle={describe(entry)}
                            icon={(
                                <HappierCollectionListMark dimmed={!entry.role.enabled}>
                                    {presentEngine(entry.role.engine).icon ?? <Icon name="person" size={20} color={theme.colors.text.secondary} />}
                                </HappierCollectionListMark>
                            )}
                            onPress={() => openRoleCollectionHref(router, roleRoute(entry.roleId), false, 'RoleCollectionPage.open')}
                        />
                    ))}
                </ItemGroup>
            ))}
            {catalog.status === 'failed' && groups.length === 0 ? (
                <SurfaceStateCard
                    testID="settings.roles.page.failed"
                    kind="error"
                    title={t('roles.settings.loadFailed')}
                    action={{ label: t('common.retry'), onPress: catalog.refresh }}
                />
            ) : null}
            <ItemGroup>
                <Item
                    testID="settings.roles.page.add"
                    title={t('roles.settings.newRole')}
                    icon={<Icon name="plus" size={16} color={theme.colors.text.secondary} />}
                    onPress={() => openRoleCollectionHref(router, newRoleRoute(), false, 'RoleCollectionPage.add')}
                />
            </ItemGroup>
        </ItemList>
    );
});
