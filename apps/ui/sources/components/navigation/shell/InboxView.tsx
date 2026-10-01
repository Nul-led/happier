import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { InboxContent, type InboxView as InboxContentView } from '@/components/inbox/InboxContent';
import type { InboxItemFocus } from '@/components/inbox/inboxItemFocus';
import { countInboxNeedsYou, countInboxUpdates } from '@/components/inbox/inboxCounts';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Header } from '@/components/navigation/Header';
import { NavigationTitleChromeProvider, PageHeader } from '@/components/ui/layout/PageHeader';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import {
    InboxModelBoundary,
    useInboxModel,
} from '@/hooks/inbox/useInboxModel';
import { t } from '@/text';
import { useIsTablet } from '@/utils/platform/responsive';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.surface.base,
    },
    phoneTabs: {
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    headerTitle: {
        fontSize: 17,
        color: theme.colors.chrome.header.foreground,
        ...Typography.default('semiBold'),
    },
}));

function InboxHeaderTitle() {
    return <Text style={styles.headerTitle}>{t('tabs.inbox')}</Text>;
}

const InboxViewContent = React.memo(function InboxViewContent(props: Readonly<{ focusedItem?: InboxItemFocus | null }>) {
    const model = useInboxModel();
    // Phones show the title in the navigation header and the page header shows only the purpose;
    // wide layouts have no navigation title, so the page header carries it.
    const phone = !useIsTablet();
    // `/inbox?item=` (a Boards card): open on Needs you with that item's row selected.
    const focusedItem = props.focusedItem ?? null;
    const [view, setView] = React.useState<InboxContentView>('needs_you');
    React.useEffect(() => {
        if (focusedItem) setView('needs_you');
    }, [focusedItem]);
    const needsYouCount = countInboxNeedsYou(model);
    const updatesCount = countInboxUpdates(model);
    // Lab `inbox-I1`/`phone-P4`: what needs you, and what finished, as two views of one Inbox.
    const tabs = (
        <SegmentedTabBar
            testIDPrefix="inbox.view"
            accessibilityLabel={t('inbox.work.tabs.a11y')}
            compact
            segmentSizing={phone ? undefined : 'content'}
            tabs={[
                { id: 'needs_you' as const, label: t('inbox.work.tabs.needsYou'), ...(needsYouCount > 0 ? { count: String(needsYouCount) } : {}) },
                { id: 'updates' as const, label: t('inbox.work.tabs.updates'), ...(updatesCount > 0 ? { count: String(updatesCount) } : {}) },
            ]}
            activeTabId={view}
            onSelectTab={setView}
        />
    );

    return (
        <View style={styles.container}>
            <Header
                title={phone ? <InboxHeaderTitle /> : null}
                headerLeft={() => null}
                headerRight={() => null}
                headerShadowVisible={false}
                headerTransparent
            />
            <NavigationTitleChromeProvider showsTitle={phone}>
                <ItemList presentation="page" testID="inbox.screen">
                    <PageHeader
                        title={t('tabs.inbox')}
                        description={t('inbox.work.pageDescription')}
                        actions={phone ? undefined : tabs}
                    />
                    {phone ? <View style={styles.phoneTabs}>{tabs}</View> : null}
                    <InboxContent model={model} presentation="screen" view={view} focusedItem={focusedItem} />
                </ItemList>
            </NavigationTitleChromeProvider>
        </View>
    );
});

/**
 * The app shell owns the model in production. The boundary keeps isolated
 * stories/tests functional without mounting a second owner beneath the shell.
 */
export const InboxView = React.memo(function InboxView(props: Readonly<{
    /** The item the person came to see, from the route's `item` parameter. */
    focusedItem?: InboxItemFocus | null;
}>) {
    return (
        <InboxModelBoundary>
            <InboxViewContent focusedItem={props.focusedItem ?? null} />
        </InboxModelBoundary>
    );
});
