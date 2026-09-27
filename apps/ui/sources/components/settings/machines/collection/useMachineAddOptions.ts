import * as React from 'react';
import { Platform } from 'react-native';

import type { IconName } from '@/components/ui/icons/Icon';
import { useMachinePoolProjections } from '@/sync/engine/machines/useMachinePoolProjections';
import { resolveWizardCapabilities } from '@/components/onboarding/capabilities/resolveWizardCapabilities';
import { resolveSetupSurfacePolicy } from '@/sync/domains/server/setup/setupSurfacePolicy';
import { t } from '@/text';
import { isDesktopHost } from '@/utils/platform/desktopHost';
import { buildMachineSetupWizardHref } from '@/utils/routes/setupWizardHref';

import type { ActiveSelectionMachineGroup } from '../hooks/useActiveSelectionMachineGroups';

export type MachineAddOptionId = 'thisComputer' | 'ssh' | 'pool';

export type MachineAddOption = Readonly<{
    id: MachineAddOptionId;
    title: string;
    subtitle: string;
    icon: IconName;
    /** Opens outside the collection (the setup wizard) or inside it (a pool draft). */
    href: string;
    /** Whether the destination is a page of the Machines collection. */
    inCollection: boolean;
}>;

/**
 * The ways this device can add to the Machines collection: set up this computer (the browser opens the
 * setup wizard; the desktop app lists this computer in the collection instead), connect a machine over
 * SSH (where the setup wizard can: browser, desktop app, native builds with the SSH transport), and
 * create a machine pool on a Home that supports pools. Build policy removes paths a build does not ship.
 */
export function useMachineAddOptions(groups: readonly ActiveSelectionMachineGroup[]): readonly MachineAddOption[] {
    const isDesktop = isDesktopHost();
    const isBrowserWeb = Platform.OS === 'web' && !isDesktop;
    const policy = React.useMemo(() => resolveSetupSurfacePolicy(), []);
    // The setup wizard owns whether this device can set a machine up over SSH (native builds need the
    // native SSH transport); the add options only reflect its answer.
    const sshAvailable = React.useMemo(() => {
        if (!policy.machine.allowRemoteSshMachineSetup) return false;
        if (isBrowserWeb || isDesktop) return true;
        return resolveWizardCapabilities({ platform: 'native', isDesktopShell: false }).allowNativeSshMachineSetup;
    }, [isBrowserWeb, isDesktop, policy]);
    const projections = useMachinePoolProjections(groups);
    const poolServerIds = projections
        .filter((projection) => projection?.featureStatus === 'enabled')
        .map((projection) => projection!.serverId);
    const poolServerIdsKey = poolServerIds.join('\u0000');

    return React.useMemo(() => {
        const options: MachineAddOption[] = [];
        if (isBrowserWeb && policy.machine.allowLocalMachineSetup) {
            options.push({
                id: 'thisComputer',
                title: t('setupOnboarding.setupThisComputerTitle'),
                subtitle: t('settings.machineSetupCurrentMachineSubtitle'),
                icon: 'laptop',
                href: buildMachineSetupWizardHref({ action: 'local', step: 'setup_this_computer' }),
                inCollection: false,
            });
        }
        if (sshAvailable) {
            options.push({
                id: 'ssh',
                title: t('setupOnboarding.setupNewMachineAction'),
                subtitle: t('settings.machineSetupSshMachineSubtitle'),
                icon: 'terminal',
                href: buildMachineSetupWizardHref({ action: 'remote', step: 'remote_ssh_setup' }),
                inCollection: false,
            });
        }
        const serverIds = poolServerIdsKey ? poolServerIdsKey.split('\u0000') : [];
        if (serverIds.length > 0) {
            options.push({
                id: 'pool',
                title: t('machinePools.add'),
                subtitle: t('machinePools.benefit'),
                icon: 'stack',
                // With one Home the pool is created there; otherwise the editor asks which Home.
                href: serverIds.length === 1
                    ? `/settings/machines/pools/new?serverId=${encodeURIComponent(serverIds[0]!)}`
                    : '/settings/machines/pools/new',
                inCollection: true,
            });
        }
        return options;
    }, [isBrowserWeb, policy, poolServerIdsKey, sshAvailable]);
}
