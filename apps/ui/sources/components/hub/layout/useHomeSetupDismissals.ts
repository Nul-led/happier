import * as React from 'react';

import { useSettingMutable } from '@/sync/domains/state/storage';

import { listHiddenHomeSetupSteps, setHomeSetupStepHidden } from './homeHubLayout';

export type HomeSetupDismissals = Readonly<{
    /** Step ids the person dismissed from "Get set up". */
    hidden: ReadonlySet<string>;
    dismiss: (stepId: string) => void;
}>;

/**
 * The "Get set up" steps the person dismissed, kept on the Account's home layout so every device
 * agrees. Customize → Hidden setup steps brings them back. Reads only the layout setting.
 */
export function useHomeSetupDismissals(): HomeSetupDismissals {
    const [layout, setLayout] = useSettingMutable('homeHubLayoutV1');
    const hiddenKey = listHiddenHomeSetupSteps(layout).join('\u0000');
    const hidden = React.useMemo(() => new Set(hiddenKey ? hiddenKey.split('\u0000') : []), [hiddenKey]);
    const dismiss = React.useCallback((stepId: string) => {
        const next = setHomeSetupStepHidden(layout, stepId, true);
        if (next !== layout) setLayout({ order: [...next.order], hidden: [...next.hidden] });
    }, [layout, setLayout]);
    return React.useMemo(() => ({ hidden, dismiss }), [dismiss, hidden]);
}
