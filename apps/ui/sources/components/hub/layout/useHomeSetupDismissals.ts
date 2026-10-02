import * as React from 'react';

import { useSettingMutable } from '@/sync/domains/state/storage';

import { listHiddenHomeSetupSteps, setHomeSetupStepHidden } from './homeHubLayout';

export type HomeSetupDismissals = Readonly<{
    /** Step ids completed or dismissed from "Get set up". */
    hidden: ReadonlySet<string>;
    dismiss: (stepId: string) => void;
}>;

/**
 * Completed or dismissed "Get set up" steps, kept in the existing Account home layout and its
 * synchronization scope. Customize → Hidden setup steps brings them back.
 */
export function useHomeSetupDismissals(): HomeSetupDismissals {
    const [layout, setLayout] = useSettingMutable('homeHubLayoutV1');
    const currentLayout = React.useRef(layout);
    currentLayout.current = layout;
    const hiddenKey = listHiddenHomeSetupSteps(layout).join('\u0000');
    const hidden = React.useMemo(() => new Set(hiddenKey ? hiddenKey.split('\u0000') : []), [hiddenKey]);
    const dismiss = React.useCallback((stepId: string) => {
        // Pairing can finish after other layout edits. Keep those edits and the launching
        // setter's existing Account-scope guard, rather than replacing a captured old layout.
        const current = currentLayout.current;
        const next = setHomeSetupStepHidden(current, stepId, true);
        if (next !== current) setLayout({ ...next, order: [...next.order], hidden: [...next.hidden] });
    }, [setLayout]);
    return React.useMemo(() => ({ hidden, dismiss }), [dismiss, hidden]);
}
