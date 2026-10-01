import { useLocalSetting } from '@/sync/domains/state/storage';

import type { WidgetFramePlacement, WidgetFrameStyle } from './WidgetFrame';
import { resolveWidgetFrameStyle } from './widgetFrameStyle';

const SURFACE_SETTING = {
    home: 'widgetFrameStyleHome',
    board: 'widgetFrameStyleBoard',
    companion: 'widgetFrameStyleCompanion',
} as const satisfies Record<WidgetFramePlacement, string>;

/** This device's Appearance default for one surface (subscribes to that one key only). */
export function useWidgetFrameSurfaceDefault(placement: WidgetFramePlacement): WidgetFrameStyle {
    return useLocalSetting(SURFACE_SETTING[placement]);
}

/** The effective frame style of one widget on one surface. */
export function useWidgetFrameStyle(placement: WidgetFramePlacement, override?: WidgetFrameStyle | null): WidgetFrameStyle {
    const surfaceDefault = useWidgetFrameSurfaceDefault(placement);
    return resolveWidgetFrameStyle({ placement, surfaceDefault, override: override ?? null });
}
