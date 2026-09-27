import * as React from 'react';
import { router, usePathname } from 'expo-router';

import { getDeviceType } from '@/utils/platform/responsive';

type DeviceType = 'phone' | 'tablet';

/**
 * The settings page to reopen after a presentation switch. Settings is a screen on phones and a modal
 * elsewhere (`resolveSettingsRoutePresentation`), so crossing that width remounts its navigator at the
 * index; the instance that is unmounted by the switch leaves its page here for the next one.
 */
let pageToReopen: string | null = null;

function isSettingsPage(pathname: string | null): pathname is string {
    return typeof pathname === 'string' && pathname.startsWith('/settings/');
}

/**
 * Keeps the settings route across the phone/desktop presentation switch. Mounted inside the settings
 * navigator's layout; renders nothing, and only this leaf follows the pathname.
 */
export function SettingsPresentationRouteKeeper(props: Readonly<{
    deviceType: DeviceType;
    /** The device type now (the window may already have changed); injectable for tests. */
    readLiveDeviceType?: () => DeviceType;
}>): null {
    const pathname = usePathname();
    const lastRef = React.useRef({ pathname, deviceType: props.deviceType });
    lastRef.current = { pathname, deviceType: props.deviceType };
    const readLiveDeviceTypeRef = React.useRef(props.readLiveDeviceType ?? getDeviceType);
    readLiveDeviceTypeRef.current = props.readLiveDeviceType ?? getDeviceType;

    React.useEffect(() => {
        const reopen = pageToReopen;
        pageToReopen = null;
        // A remounted navigator starts at the settings index whatever the pathname still says.
        if (reopen) {
            router.replace(reopen as never);
        }
        return () => {
            // Closing Settings keeps the device type; only the presentation switch changes it under us.
            const last = lastRef.current;
            if (readLiveDeviceTypeRef.current() !== last.deviceType && isSettingsPage(last.pathname)) {
                pageToReopen = last.pathname;
            }
        };
    }, []);

    return null;
}
