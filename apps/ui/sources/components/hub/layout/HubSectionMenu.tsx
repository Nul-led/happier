import * as React from 'react';
import { Platform, View } from 'react-native';

import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import { readCoarsePrimaryPointer } from '@/components/sessions/transcript/messageActions/rowActionRevealHost';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';
import { t } from '@/text';

import { useWidgetFrameSurfaceDefault } from '@/components/widgets/frame/useWidgetFrameStyle';
import { buildWidgetFrameStyleActions } from '@/components/widgets/frame/widgetFrameMenu';

import { homeHubSectionTitle, isHomeHubCardSection } from '../homeHubSections';
import type { HomeHubSection } from './homeHubLayout';
import type { HomeHubLayout } from './useHomeHubLayout';

/** Every action sits in the overflow menu: the header shows one quiet "⋯". */
const ALWAYS_OVERFLOW = Number.POSITIVE_INFINITY;

/**
 * A home section's "⋯": open a widget's page, hide or remove the section, move it, or customize
 * the whole home. With a fine pointer it appears while the section is hovered or the menu has
 * keyboard focus; touch always shows it.
 */
export function HubSectionMenu(props: Readonly<{
    section: HomeHubSection<WidgetCandidate>;
    index: number;
    layout: HomeHubLayout;
    hovered: boolean;
    onCustomize: () => void;
    /** A widget whose plugin has one page opens it from here. */
    onOpen?: () => void;
}>) {
    const [focused, setFocused] = React.useState(false);
    const alwaysVisible = Platform.OS !== 'web' || readCoarsePrimaryPointer();
    const visible = alwaysVisible || props.hovered || focused;
    const { section, layout } = props;
    const title = homeHubSectionTitle(section);
    const surfaceDefault = useWidgetFrameSurfaceDefault('home');
    // Only sections drawn in the widget frame have a frame to show or hide.
    const frameActions = isHomeHubCardSection(section)
        ? buildWidgetFrameStyleActions({
            placement: 'home',
            surfaceDefault,
            override: section.frameStyle,
            onSet: (style) => layout.setFrameStyle(section.id, style),
        })
        : [];

    return (
        <View
            testID={`home-hub.${section.id}.menu`}
            style={{ opacity: visible ? 1 : 0 }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
        >
            <ItemRowActions
                title={title}
                compactThreshold={ALWAYS_OVERFLOW}
                compactActionIds={[]}
                overflowTriggerTestID={`home-hub.${section.id}.menuTrigger`}
                overflowTriggerAccessibilityLabel={`${t('settingsOverview.homeSectionOptions')}: ${title}`}
                actions={[
                    ...(props.onOpen ? [{
                        id: 'open',
                        title: t('common.open'),
                        icon: 'arrow-square-out' as const,
                        onPress: props.onOpen,
                    }] : []),
                    ...(section.hideable ? [{
                        id: 'hide',
                        title: section.kind === 'widget'
                            ? t('settingsOverview.homeRemoveWidget')
                            : t('settingsOverview.homeHideSection'),
                        icon: 'eye-slash' as const,
                        onPress: () => layout.setHidden(section.id, true),
                    }] : []),
                    {
                        id: 'moveUp',
                        title: t('common.moveUp'),
                        icon: 'caret-up',
                        disabled: props.index === 0,
                        onPress: () => layout.move(section.id, -1),
                    },
                    {
                        id: 'moveDown',
                        title: t('common.moveDown'),
                        icon: 'caret-down',
                        disabled: props.index === layout.sections.length - 1,
                        onPress: () => layout.move(section.id, 1),
                    },
                    ...frameActions,
                    {
                        id: 'customize',
                        title: t('settingsOverview.homeCustomize'),
                        icon: 'sliders-horizontal',
                        onPress: props.onCustomize,
                    },
                ]}
            />
        </View>
    );
}
