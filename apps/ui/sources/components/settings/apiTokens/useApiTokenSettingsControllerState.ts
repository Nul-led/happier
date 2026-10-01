import * as React from 'react';

import type { ApiTokenSettingsController } from './apiTokenSettingsController';

export function useApiTokenSettingsControllerState(controller: ApiTokenSettingsController) {
    return React.useSyncExternalStore(
        controller.subscribe,
        controller.getState,
        controller.getState,
    );
}

/** One primitive fact of the controller state, so a caller re-renders only when that fact changes. */
export function useApiTokenSettingsControllerSelector<T extends string | number | boolean | null>(
    controller: ApiTokenSettingsController,
    select: (state: ReturnType<ApiTokenSettingsController['getState']>) => T,
): T {
    const read = React.useCallback(() => select(controller.getState()), [controller, select]);
    return React.useSyncExternalStore(controller.subscribe, read, read);
}
