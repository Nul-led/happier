import * as React from 'react';

import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
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

    return React.useMemo(() => {
        // Terminal lab B1: the session terminal lives in the bottom pane; a phone shows it as the
        // session's Terminal page (the cockpit destination). "Open in Details" is a per-tab move.
        const dockLocation: EmbeddedTerminalDockLocation = deviceType === 'phone' ? 'sidebar' : 'bottom';

        return {
            deviceType,
            terminalEnabled,
            dockLocation,
            sidebarTabAvailable: terminalEnabled && dockLocation === 'sidebar',
        };
    }, [deviceType, terminalEnabled]);
}
