import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import type { SystemTaskRunner } from '@/components/systemTasks/types';
import { useActiveServerSnapshot } from '@/hooks/server/useActiveServerSnapshot';
import { t } from '@/text';

import { presentThisComputerServiceRow } from './thisComputerConnectionPresentation';
import { useThisComputerServiceRows } from './useThisComputerServiceRows';

/**
 * Settings › This computer: every Home this computer serves (one daemon per server, R15 d), each
 * with its state, from the status this page already read (no second read, R13C-F4).
 */
export const ThisComputerServersGroup = React.memo(function ThisComputerServersGroup(props: Readonly<{
    runner?: SystemTaskRunner;
}>) {
    const services = useThisComputerServiceRows(props.runner ? { runner: props.runner } : {});
    const activeServer = useActiveServerSnapshot();
    if (services.status === 'pending') return null;
    if (services.status === 'failed') {
        return (
            <ItemGroup title={t('machine.thisComputer.servers.title')}>
                <Item
                    testID="settings.localDaemonControl.servers.failed"
                    title={t('settingsDesktop.tray.readFailed')}
                    showChevron={false}
                    mode="info"
                />
            </ItemGroup>
        );
    }
    if (services.rows.length === 0 && services.complete) return null;
    return (
        <ItemGroup title={t('machine.thisComputer.servers.title')}>
            {services.rows.map((row, index) => {
                const { title, stateLabel } = presentThisComputerServiceRow(row, activeServer);
                return (
                    <Item
                        key={row.relayUrl}
                        testID={`settings.localDaemonControl.servers.${index}`}
                        title={title}
                        subtitle={stateLabel}
                        showChevron={false}
                        mode="info"
                    />
                );
            })}
            {/* Some services could not be read: the list is not the whole truth, and says so. */}
            {services.complete ? null : (
                <Item
                    testID="settings.localDaemonControl.servers.incomplete"
                    title={t('settingsDesktop.tray.incomplete')}
                    showChevron={false}
                    mode="info"
                />
            )}
        </ItemGroup>
    );
});
