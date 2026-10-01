import * as React from 'react';

import { useSettingMutable } from '@/sync/domains/state/storage';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';

import {
    applyHomeHubLayoutIntent,
    listHiddenHomeSetupSteps,
    resolveHomeHubLayout,
    type HomeHubLayoutValue,
    type HomeHubSection,
} from './homeHubLayout';
import { useHomeWidgetCandidates } from './useHomeWidgetCandidates';
import { HOME_HUB_BUILTIN_SECTIONS } from '../homeHubSections';

export type HomeHubLayout = Readonly<{
    sections: readonly HomeHubSection<WidgetCandidate>[];
    /** Installed widgets not on Home (Customize → Add widgets). */
    available: readonly WidgetCandidate[];
    isDefault: boolean;
    /** How many "Get set up" steps the person dismissed (Customize → Hidden setup steps). */
    hiddenSetupStepCount: number;
    move: (id: string, step: -1 | 1) => void;
    /** Customize's drag: the listed sections in their new order. */
    reorder: (orderedIds: readonly string[]) => void;
    setHidden: (id: string, hidden: boolean) => void;
    setFrameStyle: (id: string, style: 'card' | 'plain' | null) => void;
    showHiddenSetupSteps: () => void;
    reset: () => void;
}>;

/** The Account's home layout (synced across devices through Account Settings). */
export function useHomeHubLayout(): HomeHubLayout {
    const [layout, setLayout] = useSettingMutable('homeHubLayoutV1');
    const widgets = useHomeWidgetCandidates();
    const resolved = React.useMemo(() => resolveHomeHubLayout(layout, HOME_HUB_BUILTIN_SECTIONS, widgets), [layout, widgets]);
    return React.useMemo(() => {
        const write = (next: HomeHubLayoutValue) => {
            if (next !== layout) setLayout({ ...next, order: [...next.order], hidden: [...next.hidden] });
        };
        return {
            sections: resolved.sections,
            available: resolved.available,
            isDefault: layout.order.length === 0 && layout.hidden.length === 0 && !layout.sections,
            hiddenSetupStepCount: listHiddenHomeSetupSteps(layout).length,
            move: (id, step) => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'move', sectionId: id, step })),
            reorder: (sectionIds) => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'reorder', sectionIds: [...sectionIds] })),
            showHiddenSetupSteps: () => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'restore_setup' })),
            setHidden: (id, hidden) => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'visibility', sectionId: id, hidden })),
            setFrameStyle: (sectionId, frameStyle) => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'frameStyle', sectionId, frameStyle })),
            reset: () => write(applyHomeHubLayoutIntent(layout, HOME_HUB_BUILTIN_SECTIONS, widgets, { kind: 'reset' })),
        };
    }, [layout, resolved, setLayout, widgets]);
}
