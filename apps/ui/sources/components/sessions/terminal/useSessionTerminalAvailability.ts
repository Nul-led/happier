import * as React from 'react';

import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useLocalSetting } from '@/sync/domains/state/storage';
import { useDeviceType } from '@/utils/platform/responsive';

import type { EmbeddedTerminalDockLocation } from './embeddedTerminalDocking';

export function useSessionTerminalAvailability(serverId?: string | null): Readonly<{
    deviceType: string | null | undefined;
    terminalEnabled: boolean;
    dockLocation: EmbeddedTerminalDockLocation;
    sidebarTabAvailable: boolean;
}> {
    const deviceType = useDeviceType();
    const terminalEnabled = useFeatureEnabled('terminal.embeddedPty', serverId ? { scopeKind: 'spawn', serverId } : undefined);
    const dockLocationRaw = useLocalSetting('embeddedTerminalDockLocation');

    return React.useMemo(() => {
        const dockLocation =
            deviceType === 'phone'
                ? 'sidebar'
                : normalizeEmbeddedTerminalDockLocation(dockLocationRaw);

        return {
            deviceType,
            terminalEnabled,
            dockLocation,
            sidebarTabAvailable: terminalEnabled && dockLocation === 'sidebar',
        };
    }, [deviceType, dockLocationRaw, terminalEnabled]);
}

function normalizeEmbeddedTerminalDockLocation(
    value: string | null | undefined,
): EmbeddedTerminalDockLocation {
    return value === 'bottom' || value === 'details' ? value : 'sidebar';
}
