import * as React from 'react';
import { desktopUpdater } from './desktopUpdater';

/** Every surface subscribes to the same desktop updater and native pending update. */
export function useDesktopUpdater() {
    const snapshot = React.useSyncExternalStore(desktopUpdater.subscribe, desktopUpdater.getSnapshot, desktopUpdater.getSnapshot);
    React.useEffect(desktopUpdater.ensureChecked, []);
    return React.useMemo(() => ({
        ...snapshot,
        checksEnabled: desktopUpdater.isEnabled(),
        dismiss: desktopUpdater.dismiss,
        refresh: desktopUpdater.refresh,
        startInstall: desktopUpdater.startInstall,
    }), [snapshot]);
}
