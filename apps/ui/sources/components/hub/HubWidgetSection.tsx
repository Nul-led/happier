import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { useIsFocused } from '@/components/appShell/workspace/destinationRoute';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

import { useAppShellPluginUiProjection } from '@/components/appShell/plugins/AppShellPluginUiProjection';
import { InstalledWidgetSurface, type InstalledWidgetTarget } from '@/components/widgets/InstalledWidgetSurface';
import type { InstalledWidgetSource } from '@/components/widgets/installedWidgetMount';
import {
    useIsNearViewport,
    type NearViewportSpan,
    type NearViewportTracker,
} from '@/components/widgets/nearViewport';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';
import { t } from '@/text';

import { useHomeWidgetPageRoute } from './layout/useHomeWidgetPageRoute';
import { WidgetFrame, type WidgetFrameFooter, type WidgetFrameStyle } from '@/components/widgets/frame/WidgetFrame';

const APP_TARGET: InstalledWidgetTarget = Object.freeze({ kind: 'app' });

/**
 * One plugin widget on Home, in the host widget frame: the widget's mark, title and plugin, the
 * section menu, the widget's `content` presentation as the body, and "Open <plugin>" when the plugin
 * has one page to open. The plugin's body draws its own rows and states (loading, empty, error,
 * stale); the frame keeps their room.
 *
 * Its body is built only while Home is the focused route and the section is near the viewport;
 * otherwise it keeps its place (the height it last had) and holds no plugin execution, Host API
 * binding or subscription. The widget's data lives inside that body, so a change there re-renders
 * this section alone — never the hub or its sibling sections.
 */
export const HubWidgetSection = React.memo(function HubWidgetSection(props: Readonly<{
    widget: WidgetCandidate;
    menu: React.ReactNode;
    /** Card or plain: this section's override, else Home's Appearance default (resolved by the slot). */
    frameStyle: WidgetFrameStyle;
    tracker: NearViewportTracker;
    testID: string;
    hoverProps?: Readonly<Record<string, unknown>>;
}>) {
    const focused = useIsFocused();
    const [span, setSpan] = React.useState<NearViewportSpan | null>(null);
    const near = useIsNearViewport(props.tracker, span);
    const [bodyHeight, setBodyHeight] = React.useState(0);
    const active = focused && near;
    const source = React.useMemo<InstalledWidgetSource>(
        () => ({ kind: 'installedSurface', surface: props.widget.surface }),
        [props.widget.surface],
    );

    const onLayout = React.useCallback((event: LayoutChangeEvent) => {
        const { y, height } = event.nativeEvent.layout;
        setSpan((current) => (current?.top === y && current.height === height ? current : { top: y, height }));
    }, []);
    const onBodyLayout = React.useCallback((event: LayoutChangeEvent) => {
        const height = event.nativeEvent.layout.height;
        setBodyHeight((current) => (current === height ? current : height));
    }, []);

    const router = useRouter();
    const pageRoute = useHomeWidgetPageRoute(props.widget.surface.pluginId);
    const pluginName = props.widget.pluginName;
    const footer = React.useMemo<WidgetFrameFooter | null>(() => (pageRoute
        ? {
            kind: 'open',
            label: t('homeWidgets.open', { destination: pluginName }),
            onPress: () => { router.push(pageRoute as Parameters<typeof router.push>[0]); },
        }
        : null), [pageRoute, pluginName, router]);
    const body = React.useMemo(() => ({
        kind: 'content' as const,
        children: active ? (
            <View testID={`${props.testID}.body`} onLayout={onBodyLayout}>
                <HubWidgetBody widget={props.widget} source={source} testID={`${props.testID}.widget`} />
            </View>
        ) : (
            // The body's last height, so leaving and returning never moves the page.
            <View testID={`${props.testID}.deferred`} style={{ minHeight: bodyHeight }} />
        ),
    }), [active, bodyHeight, onBodyLayout, props.testID, props.widget, source]);

    return (
        <View testID={props.testID} onLayout={onLayout} style={styles.cell} {...props.hoverProps}>
            <WidgetFrame
                testID={`${props.testID}.frame`}
                frameStyle={props.frameStyle}
                placement="home"
                fill
                mark={props.widget.icon}
                title={props.widget.title}
                source={pluginName}
                menu={props.menu}
                body={body}
                footer={footer}
            />
        </View>
    );
});

/** The mounted body: the one installed-widget arm, against the app shell's plugin projection. */
function HubWidgetBody(props: Readonly<{ widget: WidgetCandidate; source: InstalledWidgetSource; testID: string }>) {
    const runtime = useAppShellPluginUiProjection();
    return (
        <InstalledWidgetSurface
            target={APP_TARGET}
            recordRevision={props.widget.key}
            source={props.source}
            presentation="content"
            runtime={runtime}
            testID={props.testID}
        />
    );
}

const styles = {
    // The frame fills its grid cell, so cards in one row share a height.
    cell: { flexGrow: 1 },
} as const;
