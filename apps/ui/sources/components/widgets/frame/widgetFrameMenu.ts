import type { ItemAction } from '@/components/ui/lists/itemActions';
import { t } from '@/text';

import type { WidgetFramePlacement, WidgetFrameStyle } from './WidgetFrame';
import { resolveWidgetFrameStyleToggle } from './widgetFrameStyle';

function styleLabel(style: WidgetFrameStyle): string {
    return style === 'card' ? t('widgetFrame.styleCard') : t('widgetFrame.stylePlain');
}

export function widgetFrameSurfaceLabel(placement: WidgetFramePlacement): string {
    switch (placement) {
        case 'home': return t('widgetFrame.surfaceHome');
        case 'board': return t('widgetFrame.surfaceBoard');
        case 'companion': return t('widgetFrame.surfaceCompanion');
    }
}

/**
 * The widget ⋯ menu's frame entries (lab WK/WKm), the same on Home, the Board and the Companion:
 * "Show frame" / "Hide frame" for this widget only, saying what the surface uses, and — once the
 * widget has an override — "Use the {surface} default". `onSet(null)` removes the override.
 */
export function buildWidgetFrameStyleActions(input: Readonly<{
    placement: WidgetFramePlacement;
    surfaceDefault: WidgetFrameStyle;
    override: WidgetFrameStyle | null | undefined;
    onSet: (style: WidgetFrameStyle | null) => void;
    group?: ItemAction['group'];
}>): ItemAction[] {
    const toggle = resolveWidgetFrameStyleToggle({
        placement: input.placement,
        surfaceDefault: input.surfaceDefault,
        override: input.override ?? null,
    });
    const surface = widgetFrameSurfaceLabel(input.placement);
    const group = input.group ? { group: input.group } : {};
    const actions: ItemAction[] = [{
        id: 'frameStyle',
        title: toggle.toggleTo === 'card' ? t('widgetFrame.showFrame') : t('widgetFrame.hideFrame'),
        subtitle: toggle.canReset
            ? t('widgetFrame.thisWidgetOnly')
            : `${t('widgetFrame.thisWidgetOnly')} · ${t('widgetFrame.surfaceUses', { surface, style: styleLabel(input.surfaceDefault) })}`,
        icon: toggle.toggleTo === 'card' ? 'square' : 'file-dashed',
        onPress: () => input.onSet(toggle.toggleTo),
        ...group,
    }];
    if (toggle.canReset) {
        actions.push({
            id: 'frameStyleReset',
            title: t('widgetFrame.useSurfaceDefault', { surface }),
            subtitle: t('widgetFrame.likeTheOthers', { style: styleLabel(input.surfaceDefault) }),
            icon: 'arrow-arc-left',
            onPress: () => input.onSet(null),
            ...group,
        });
    }
    return actions;
}
