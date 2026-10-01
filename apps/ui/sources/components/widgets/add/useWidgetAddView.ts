import * as React from 'react';

import { useLocalSettingMutable } from '@/sync/store/hooks';

import { widgetAddViewFromSetting, widgetAddViewToSetting, type WidgetAddView } from './widgetAddModel';

/**
 * The Add popover's Gallery | List view, remembered on this device for every placement (the
 * Collection's view-switch persistence: one local setting, `widgetGalleryViewV1`).
 */
export function useWidgetAddView(): readonly [WidgetAddView, (view: WidgetAddView) => void] {
    const [value, setValue] = useLocalSettingMutable('widgetGalleryViewV1');
    const setView = React.useCallback((view: WidgetAddView) => {
        setValue(widgetAddViewToSetting(view));
    }, [setValue]);
    return [widgetAddViewFromSetting(value), setView] as const;
}
