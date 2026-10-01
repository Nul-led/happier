import * as React from 'react';

import { DesktopQuitHandoffRuntime } from '@/desktop/quit/DesktopQuitHandoffRuntime';
import { DesktopTrayRuntime } from '@/desktop/tray/DesktopTrayRuntime';

/**
 * The desktop main window's own lifecycle with this computer: the tray's facts and the Quit
 * handoff. They belong to the window, not to any journey inside it, so the root layout mounts them
 * outside the onboarding gate (R13C-F3) — quitting during onboarding must still be answered, and the
 * tray must still list this computer's services. The activity overlay window never mounts them.
 */
export function DesktopMainWindowRuntimes(): React.ReactElement {
    return (
        <>
            <DesktopTrayRuntime />
            <DesktopQuitHandoffRuntime />
        </>
    );
}
