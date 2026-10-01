import * as React from 'react';
import { useWindowDimensions, View, type ScrollView } from 'react-native';

import { HomeWhereLine } from '@/components/homes/journeys/label/HomeWhereLine';
import { useReturningGreeting } from '@/components/onboarding/preAuth/useReturningGreeting';
import { useRowActionHoverHost } from '@/components/sessions/transcript/messageActions/rowActionRevealHost';
import { HomeReachabilityGate } from '@/components/navigation/connectionStatus/HomeReachabilityGate';
import { SessionGettingStartedGuidance } from '@/components/sessions/guidance/SessionGettingStartedGuidance';
import { useSessionGettingStartedGuidanceBaseModel } from '@/components/sessions/guidance/useSessionGettingStartedGuidanceBaseModel';
import { PageHeader } from '@/components/ui/layout/PageHeader';
import { ItemList } from '@/components/ui/lists/ItemList';
import { PAGE_ROW_TOUCH_MIN_HEIGHT_PX } from '@/components/ui/lists/pageRowMetrics';
import { useWidgetFrameStyle } from '@/components/widgets/frame/useWidgetFrameStyle';
import { createNearViewportTracker, type NearViewportTracker } from '@/components/widgets/nearViewport';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';

import { HubCustomizeButton } from './header/HubCustomizeButton';
import { HubStatusLine } from './header/HubStatusLine';
import { useHomeGreeting } from './header/homeGreeting';
import { findHomeHubBuiltinSection } from './homeHubSections';
import { HomeHubSectionList } from './HomeHubSectionList';
import { HubWidgetSection } from './HubWidgetSection';
import type { HomeHubSection } from './layout/homeHubLayout';
import { HubSectionMenu } from './layout/HubSectionMenu';
import { useHomeHubLayout, type HomeHubLayout } from './layout/useHomeHubLayout';

// The Home on the status line: its name, and where it lives while nothing is running (J1).
const renderHomeLine = (detail: 'full' | 'name') => <HomeWhereLine detail={detail} separated />;


type SlotProps = Readonly<{
    index: number;
    layout: HomeHubLayout;
    onCustomize: () => void;
    placeholder: string;
    tracker: NearViewportTracker;
}>;

/**
 * One home section with its hover-revealed "⋯" menu. Memoized on stable props, so a hub render
 * (the layout arriving, Customize opening) leaves every other section, and each widget, untouched.
 */
const HubSectionSlot = React.memo(function HubSectionSlot(props: SlotProps & Readonly<{
    section: HomeHubSection<WidgetCandidate>;
}>) {
    const section = props.section;
    if (section.kind === 'widget') return <HubWidgetSlot {...props} section={section} />;
    return <HubBuiltinSlot {...props} section={section} />;
});

function HubBuiltinSlot(props: SlotProps & Readonly<{
    section: Extract<HomeHubSection<WidgetCandidate>, { kind: 'builtin' }>;
}>) {
    const hover = useRowActionHoverHost();
    const definition = findHomeHubBuiltinSection(props.section.id);
    const frameStyle = useWidgetFrameStyle('home', props.section.frameStyle);
    if (!definition) return null;
    const menu = (
        <HubSectionMenu
            section={props.section}
            index={props.index}
            layout={props.layout}
            hovered={hover.isHovered}
            onCustomize={props.onCustomize}
        />
    );
    return (
        <View testID={`home-hub.section.${props.section.id}`} style={definition.card ? styles.card : undefined} {...hover.hoverProps}>
            {definition.render({ menu, placeholder: props.placeholder, frameStyle })}
        </View>
    );
}

function HubWidgetSlot(props: SlotProps & Readonly<{
    section: Extract<HomeHubSection<WidgetCandidate>, { kind: 'widget' }>;
}>) {
    const hover = useRowActionHoverHost();
    const frameStyle = useWidgetFrameStyle('home', props.section.frameStyle);
    // "Open <plugin>" is the card's footer; the menu keeps hide, move and Customize.
    const menu = (
        <HubSectionMenu
            section={props.section}
            index={props.index}
            layout={props.layout}
            hovered={hover.isHovered}
            onCustomize={props.onCustomize}
        />
    );
    return (
        <HubWidgetSection
            testID={`home-hub.section.${props.section.id}`}
            widget={props.section.widget}
            menu={menu}
            frameStyle={frameStyle}
            tracker={props.tracker}
            hoverProps={hover.hoverProps}
        />
    );
}

/**
 * The app home (the main pane when no session is open, and the page the phone's logo opens): a
 * greeting with one line about the present and Customize, then the Account's sections in its
 * chosen order. It composes the hub section owners the Settings Overview also uses. Before a machine
 * can run a session (none yet, or none running), and while that is not known yet, the
 * getting-started guidance is the home instead.
 */
export const HomeHub = React.memo(function HomeHub() {
    const guidance = useSessionGettingStartedGuidanceBaseModel();
    const greeting = useReturningGreeting();
    const title = useHomeGreeting();
    const layout = useHomeHubLayout();
    const [customizeOpen, setCustomizeOpen] = React.useState(false);
    const listRef = React.useRef<ScrollView>(null);
    // A section's "⋯ → Customize" opens the header's popover; bring the header into view first so
    // the popover opens beside its button, not off-screen.
    const openCustomize = React.useCallback(() => {
        listRef.current?.scrollTo({ y: 0, animated: false });
        setCustomizeOpen(true);
    }, []);
    // Where the page is scrolled, for the widgets' near-viewport rule. It is a store the widgets
    // subscribe to one by one; scrolling never re-renders the hub.
    const initialViewportHeight = useWindowDimensions().height;
    const [tracker] = React.useState(() => createNearViewportTracker({
        quantum: PAGE_ROW_TOUCH_MIN_HEIGHT_PX,
        initialViewportHeight,
    }));

    // Until the model knows, the pane holds a quiet page: neither the hub (which could swap to the
    // guidance) nor the guidance's mark draws before the answer, so nothing moves on arrival.
    if (guidance.kind === 'loading') {
        // A Home that does not answer turns this into "Can't reach {Home}" with Retry, not an endless wait.
        return (
            <HomeReachabilityGate variant="pane">
                <ItemList presentation="page" testID="home-hub.loading">{null}</ItemList>
            </HomeReachabilityGate>
        );
    }
    if (guidance.kind === 'connect_machine' || guidance.kind === 'start_daemon') {
        return <SessionGettingStartedGuidance variant="primaryPane" />;
    }

    const slotProps = { layout, onCustomize: openCustomize, placeholder: greeting.subtitle, tracker };

    return (
        <ItemList
            ref={listRef}
            presentation="page"
            testID="home-hub"
            onScroll={tracker.onScroll}
            onLayout={tracker.onLayout}
            scrollEventThrottle={16}
        >
            <PageHeader
                title={title}
                alwaysShowTitle
                details={<HubStatusLine home={renderHomeLine} />}
                actions={<HubCustomizeButton open={customizeOpen} onOpenChange={setCustomizeOpen} />}
            />
            <HomeHubSectionList
                sections={layout.sections}
                renderSection={(section, index) => (
                    <HubSectionSlot key={section.id} section={section} index={index} {...slotProps} />
                )}
            />
        </ItemList>
    );
});

const styles = {
    card: { flexGrow: 1 },
} as const;
