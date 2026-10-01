import * as React from 'react';
import { Platform, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { formatExactCount } from '@/components/ui/navigation/tabBadge/tabBadgeModel';
import type { GitPaneLayout as GitPaneLayoutSetting } from '@/components/sessions/panes/git/display/GitDisplayMenu';
import type { GitTimelineSectionProps } from '@/components/sessions/panes/git/GitTimelineSection';
import { WorkspaceScmSubTabsBar, type GitSubTabId } from './WorkspaceScmSubTabsBar';
import { t } from '@/text';

export function resolveGitPaneActiveSubTab(layout: GitPaneLayoutSetting, tab: GitSubTabId): 'commit' | 'history' {
    return layout === 'tabs' && tab === 'history' ? 'history' : 'commit';
}

/** One composition for session and machine Git: history joins the changes scroll in Unified;
 * Tabs retains the changes surface (and its draft/selection) while history is showing. */
export const GitPaneLayout = React.memo(function GitPaneLayout(props: Readonly<{
    layout: GitPaneLayoutSetting;
    activeSubTabId: GitSubTabId;
    onSelectSubTab: (tab: GitSubTabId) => void;
    changedCount: number;
    testIDPrefix: string;
    historyIdentity: string;
    timeline: React.ReactElement<GitTimelineSectionProps> | null;
    renderChanges: (state: Readonly<{ active: boolean; listFooter: React.ReactElement | null }>) => React.ReactNode;
}>) {
    const active = resolveGitPaneActiveSubTab(props.layout, props.activeSubTabId);
    return (
        <>
            {props.layout === 'tabs' ? (
                <WorkspaceScmSubTabsBar
                    tabs={[
                        { id: 'commit', label: t('sessionGitPane.subTabs.changes'), ...(props.changedCount > 0 ? { count: formatExactCount(props.changedCount) } : {}) },
                        { id: 'history', label: t('sessionGitPane.subTabs.history') },
                    ]}
                    activeSubTabId={active}
                    onSelectSubTab={props.onSelectSubTab}
                    testIDPrefix={`${props.testIDPrefix}-subtab:`}
                />
            ) : null}
            <View style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <GitSubTabSurface testID={`${props.testIDPrefix}-surface:commit`} isActive={active === 'commit'}>
                    {props.renderChanges({ active: active === 'commit', listFooter: props.layout === 'unified' ? props.timeline : null })}
                </GitSubTabSurface>
                {props.layout === 'tabs' ? (
                    <GitSubTabSurface testID={`${props.testIDPrefix}-surface:history`} isActive={active === 'history'}>
                        <GitHistoryScroll identity={props.historyIdentity} timeline={props.timeline} />
                    </GitSubTabSurface>
                ) : null}
            </View>
        </>
    );
});

/** Row measurements preserve the viewed commit when a refreshed history prepends a head. */
const GitHistoryScroll = React.memo(function GitHistoryScroll(props: Readonly<{
    identity: string;
    timeline: React.ReactElement<GitTimelineSectionProps> | null;
}>) {
    const scrollRef = React.useRef<ScrollView>(null);
    const rowsRef = React.useRef(new Map<string, { y: number; height: number }>());
    const anchorRef = React.useRef<{ sha: string; y: number } | null>(null);
    const offsetRef = React.useRef(0);
    React.useLayoutEffect(() => {
        rowsRef.current.clear();
        anchorRef.current = null;
        offsetRef.current = 0;
        scrollRef.current?.scrollTo({ y: 0, animated: false });
    }, [props.identity]);
    const onScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const offset = event.nativeEvent.contentOffset.y;
        offsetRef.current = offset;
        anchorRef.current = null;
        if (offset <= 0) return;
        for (const [sha, row] of rowsRef.current) {
            if (row.y <= offset && row.y + row.height > offset) {
                anchorRef.current = { sha, y: row.y };
                break;
            }
        }
    }, []);
    const onCommitLayout = React.useCallback((sha: string, y: number, height: number) => {
        rowsRef.current.set(sha, { y, height });
        const anchor = anchorRef.current;
        if (anchor?.sha !== sha || anchor.y === y) return;
        offsetRef.current = Math.max(0, offsetRef.current + y - anchor.y);
        anchorRef.current = { sha, y };
        scrollRef.current?.scrollTo({ y: offsetRef.current, animated: false });
    }, []);
    React.useEffect(() => {
        if (!props.timeline) return;
        const shas = new Set([
            ...props.timeline.props.entries,
            ...(props.timeline.props.incoming ?? []),
        ].map((entry) => entry.sha));
        for (const sha of rowsRef.current.keys()) {
            if (!shas.has(sha)) rowsRef.current.delete(sha);
        }
        if (anchorRef.current && !shas.has(anchorRef.current.sha)) anchorRef.current = null;
    }, [props.timeline?.props.entries, props.timeline?.props.incoming]);
    return (
        <ScrollView
            ref={scrollRef}
            testID="scm-history-scroll"
            // Browser CSS anchoring must not repeat the measured row adjustment.
            style={{ flex: 1, ...(Platform.OS === 'web' ? { overflowAnchor: 'none' as const } : {}) }}
            contentContainerStyle={{ paddingBottom: 16 }}
            onScroll={onScroll}
            scrollEventThrottle={16}
        >
            {props.timeline ? React.cloneElement(props.timeline, { onCommitLayout }) : null}
        </ScrollView>
    );
});

const GitSubTabSurface = React.memo((props: Readonly<{ testID: string; isActive: boolean; children: React.ReactNode }>) => {
    const [hasMounted, setHasMounted] = React.useState(props.isActive);
    React.useEffect(() => {
        if (props.isActive) setHasMounted(true);
    }, [props.isActive]);
    if (!props.isActive && !hasMounted) return null;
    return (
        <View
            style={[
                StyleSheet.absoluteFillObject,
                {
                    opacity: props.isActive ? 1 : 0,
                    pointerEvents: props.isActive ? 'auto' : 'none',
                    display: Platform.OS === 'web' ? (props.isActive ? 'flex' : 'none') : 'flex',
                },
            ]}
            testID={props.testID}
            {...(Platform.OS === 'web' ? {} : {
                accessibilityElementsHidden: !props.isActive,
                importantForAccessibility: props.isActive ? ('auto' as const) : ('no-hide-descendants' as const),
            })}
        >
            {props.children}
        </View>
    );
});
