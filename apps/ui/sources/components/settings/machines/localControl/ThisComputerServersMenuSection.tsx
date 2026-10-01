import * as React from 'react';
import { View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';

import { Icon } from '@/components/ui/icons/Icon';
import { ActionListSection, type ActionListItem } from '@/components/ui/lists/ActionListSection';
import { StatusDot } from '@/components/ui/status/StatusDot';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { t } from '@/text';
import { runGuardedNavigation } from '@/utils/navigation/runGuardedNavigation';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';

import { presentThisComputerServiceRow } from './thisComputerConnectionPresentation';
import { useThisComputerServiceRows } from './useThisComputerServiceRows';

/**
 * The connection popover's "Homes this computer serves" (R15 d). A leaf mounted only while the
 * popover's first layer is open on desktop, so its read of this computer's services never runs for
 * closed chrome. It lists the rows of the status every "this computer" surface shares (R13C-F4). Each row names a Home and its state; pressing one opens This computer and closes
 * the popover.
 */
export const ThisComputerServersMenuSection = React.memo(function ThisComputerServersMenuSection(props: Readonly<{
    runner?: SystemTaskRunner;
    onClose: () => void;
}>) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const services = useThisComputerServiceRows(props.runner ? { runner: props.runner } : {});
    const activeServer = useActiveServerSnapshot();
    const onClose = props.onClose;
    const openThisComputer = React.useCallback(() => {
        const result = runGuardedNavigation(() => router.push(SETTINGS_ROUTES.machinesThisComputer));
        if (result !== true) {
            fireAndForget(result, { tag: 'ThisComputerServersMenuSection.nav' });
        }
        onClose();
    }, [onClose, router]);
    if (services.status === 'pending' || (services.status === 'listed' && services.rows.length === 0 && services.complete)) return null;

    const actions: ActionListItem[] = services.status === 'listed' ? services.rows.map((row, index): ActionListItem => {
        const { title, stateLabel } = presentThisComputerServiceRow(row, activeServer);
        const color = row.state === 'connected'
            ? theme.colors.status.connected
            : row.state === 'needs_attention'
                ? theme.colors.status.actionRequired
                : theme.colors.status.default;
        return {
            id: `this-computer-server-${row.relayUrl}`,
            testID: `connection-popover-this-computer-server-${index}`,
            label: title,
            subtitle: stateLabel,
            subtitleLeading: row.state === 'needs_attention'
                ? <Icon name="warning" size={11} color={color} />
                : <StatusDot color={color} size={6} />,
            accessibilityLabel: `${title}, ${stateLabel}`,
            icon: <Icon name="laptop" size={16} color={theme.colors.text.secondary} />,
            onPress: openThisComputer,
        };
    }) : [];

    if (services.status === 'failed' || !services.complete) {
        // An unreadable inventory is not an empty list: lead to where the failure is explained.
        const failed = services.status === 'failed';
        actions.push({
            id: failed ? 'this-computer-servers-failed' : 'this-computer-servers-incomplete',
            testID: failed ? 'connection-popover-this-computer-servers-failed' : 'connection-popover-this-computer-servers-incomplete',
            label: failed ? t('settingsDesktop.tray.readFailed') : t('settingsDesktop.tray.incomplete'),
            icon: <Icon name="warning" size={16} color={theme.colors.status.actionRequired} />,
            onPress: openThisComputer,
        });
    }
    return (
        <View testID="connection-popover-this-computer-servers">
            <ActionListSection separatorAbove title={t('machine.thisComputer.servers.title')} actions={actions} />
        </View>
    );
});
