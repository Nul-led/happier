import * as React from 'react';
import { Platform, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { CenteredInfoTile } from '@/components/ui/lists/CenteredInfoTile';
import { PluginSurfaceFocusEligibilityProvider } from '@/components/ui/presentation/PluginSurfaceFocusEligibility';
import { Text } from '@/components/ui/text/Text';
import { useWebScrollLockBypass } from '@/components/ui/scroll/useWebScrollLockBypass';
import { t } from '@/text';
import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';
import type { DetailsTabState, DetailsWorkspaceGroupView } from './detailsWorkspaceTypes';
import {
    DetailsTabStrip,
    detailsTabNativeId,
    detailsTabPanelNativeId,
    type DetailsTabPresentation,
    type DetailsTabStripTestIds,
} from './DetailsTabStrip';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon } from '@/components/ui/icons/Icon';

type ScrollPropagationEvent = Readonly<{ stopPropagation?: () => void }>;

const ViewWithWheel = View as unknown as React.ComponentType<
    React.ComponentPropsWithRef<typeof View> & { onWheel?: (event: unknown) => void; onTouchMove?: (event: unknown) => void }
>;
const AccessibleTabPanelView = View as unknown as React.ComponentType<
    React.ComponentPropsWithRef<typeof View> & Pick<React.HTMLAttributes<HTMLElement>, 'inert'>
>;

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
        minHeight: 0,
        minWidth: 0,
    },
    header: {
        paddingHorizontal: 10,
        paddingTop: 10,
        paddingBottom: 8,
        borderBottomWidth: Platform.select({ ios: 0.33, default: 1 }),
        borderBottomColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        gap: 10,
    },
    loadingText: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        textAlign: 'center',
    },
}));

const DetailsTabSurface = React.memo((props: Readonly<{
    groupId: string;
    tabKey: string;
    isActive: boolean;
    children: React.ReactNode;
}>) => {
    const a11yHiddenProps =
        Platform.OS === 'web'
            ? null
            : {
                accessibilityElementsHidden: !props.isActive,
                importantForAccessibility: props.isActive ? ('auto' as const) : ('no-hide-descendants' as const),
            };

    return (
        <AccessibleTabPanelView
            nativeID={detailsTabPanelNativeId(props.groupId, props.tabKey)}
            accessibilityRole="tabpanel"
            accessibilityLabelledBy={detailsTabNativeId(props.groupId, props.tabKey)}
            aria-labelledby={detailsTabNativeId(props.groupId, props.tabKey)}
            {...(Platform.OS === 'web' && !props.isActive ? { inert: true } : {})}
            pointerEvents={props.isActive ? 'auto' : 'none'}
            style={{
                flex: 1,
                minHeight: 0,
                minWidth: 0,
                opacity: props.isActive ? 1 : 0,
                display: 'flex',
                ...(Platform.OS === 'web' ? { visibility: props.isActive ? 'visible' : 'hidden' } : null),
            } as any}
            {...a11yHiddenProps}
        >
            <PluginSurfaceFocusEligibilityProvider active={props.isActive}>
                {props.children}
            </PluginSurfaceFocusEligibilityProvider>
        </AccessibleTabPanelView>
    );
});

export type DetailsTabGroupPanelProps = Readonly<{
    pane: AppPaneScopeApi;
    group: DetailsWorkspaceGroupView;
    paddingTop?: number;
    headerPaddingTop?: number;
    forceEmptyState?: boolean;
    testIds?: Readonly<{
        root?: string;
    }> & DetailsTabStripTestIds;
    resolveTabIconName?: ((tab: DetailsTabState) => string | null | undefined) | null;
    resolveTabPresentation?: ((tab: DetailsTabState) => DetailsTabPresentation | null | undefined) | null;
    renderTabContent: (tab: DetailsTabState) => React.ReactNode;
    renderHeaderLeadingActions?: (() => React.ReactNode) | null;
    renderHeaderActions?: (() => React.ReactNode) | null;
    renderEmptyState?: (() => React.ReactNode) | null;
}>;

export const DetailsTabGroupPanel = React.memo((props: DetailsTabGroupPanelProps) => {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const rootRef = React.useRef<View | null>(null);
    useWebScrollLockBypass({ rootRef, enabled: true });

    const stopScrollEventPropagationOnWeb = React.useCallback((event: unknown) => {
        if (Platform.OS !== 'web') return;
        if (event && typeof (event as ScrollPropagationEvent).stopPropagation === 'function') {
            (event as ScrollPropagationEvent).stopPropagation?.();
        }
    }, []);

    const activeTab = React.useMemo(() => {
        return props.group.tabs.find((tab) => tab.key === props.group.activeTabKey) ?? props.group.tabs.at(-1) ?? null;
    }, [props.group.activeTabKey, props.group.tabs]);
    const effectiveActiveKey = props.group.activeTabKey ?? activeTab?.key ?? null;
    const forceEmptyState = props.forceEmptyState === true;

    const renderLoadingFallback = React.useCallback(() => (
        <View style={styles.loading}>
            <ActivitySpinner size="small" color={theme.colors.text.secondary} />
            <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
    ), [styles.loading, styles.loadingText, theme.colors.text.secondary]);

    const headerPaddingTop = props.headerPaddingTop ?? 10;

    return (
        <ViewWithWheel
            ref={rootRef}
            testID={props.testIds?.root}
            style={[styles.container, props.paddingTop ? { paddingTop: props.paddingTop } : null]}
            {...(Platform.OS === 'web'
                ? { onWheel: stopScrollEventPropagationOnWeb, onTouchMove: stopScrollEventPropagationOnWeb }
                : {})}
        >
            <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
                {props.renderHeaderLeadingActions ? props.renderHeaderLeadingActions() : null}
                {!forceEmptyState ? (
                    <DetailsTabStrip
                        pane={props.pane}
                        group={props.group}
                        resolveTabIconName={props.resolveTabIconName}
                        resolveTabPresentation={props.resolveTabPresentation}
                        testIds={props.testIds}
                    />
                ) : (
                    <View style={{ flex: 1, minHeight: 0, minWidth: 0 }} />
                )}
                {props.renderHeaderActions ? props.renderHeaderActions() : null}
            </View>
            {forceEmptyState || props.group.tabs.length === 0 ? (
                props.renderEmptyState ? props.renderEmptyState() : (
                    <View style={{ flex: 1, minHeight: 0, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 }}>
                        <CenteredInfoTile
                            titleTestID="pane-details-empty-state-title"
                            descriptionTestID="pane-details-empty-state-description"
                            icon={(
                                <Icon
                                    name="plus-circle"
                                    size={44}
                                    color={theme.colors.text.secondary}
                                    style={{ marginBottom: 12 }}
                                />
                            )}
                            title={t('session.detailsPanel.emptyTitle')}
                            description={t('session.detailsPanel.emptyHint')}
                            paddingHorizontal={0}
                        />
                    </View>
                )
            ) : (
                <View style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}>
                    {props.group.tabs.map((tab) => {
                        const isActive = effectiveActiveKey ? tab.key === effectiveActiveKey : false;
                        return (
                            <DetailsTabSurface
                                key={tab.key}
                                groupId={props.group.id}
                                tabKey={tab.key}
                                isActive={isActive}
                            >
                                <React.Suspense fallback={renderLoadingFallback()}>
                                    {props.renderTabContent(tab)}
                                </React.Suspense>
                            </DetailsTabSurface>
                        );
                    })}
                </View>
            )}
        </ViewWithWheel>
    );
});
