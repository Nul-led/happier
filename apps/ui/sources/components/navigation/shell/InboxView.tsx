import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { InboxContent } from '@/components/inbox/InboxContent';
import { Header } from '@/components/navigation/Header';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import {
    InboxModelBoundary,
    useInboxModel,
} from '@/hooks/inbox/useInboxModel';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    headerTitle: {
        fontSize: 17,
        color: theme.colors.chrome.header.foreground,
        ...Typography.default('semiBold'),
    },
    scrollContent: {
        alignSelf: 'center',
        width: '100%',
        flexGrow: 1,
        paddingBottom: 24,
    },
}));

function InboxHeaderTitle() {
    return <Text style={styles.headerTitle}>{t('tabs.inbox')}</Text>;
}

const InboxViewContent = React.memo(function InboxViewContent() {
    const model = useInboxModel();
    const contentMaxWidth = useLayoutMaxWidth();
    const scrollContentStyle = React.useMemo(
        () => [styles.scrollContent, { maxWidth: contentMaxWidth }],
        [contentMaxWidth],
    );

    return (
        <View style={styles.container}>
            <Header
                title={<InboxHeaderTitle />}
                headerLeft={() => null}
                headerRight={() => null}
                headerShadowVisible={false}
                headerTransparent
            />
            <ScrollView contentContainerStyle={scrollContentStyle}>
                <InboxContent model={model} presentation="screen" />
            </ScrollView>
        </View>
    );
});

/**
 * The app shell owns the model in production. The boundary keeps isolated
 * stories/tests functional without mounting a second owner beneath the shell.
 */
export const InboxView = React.memo(function InboxView() {
    return (
        <InboxModelBoundary>
            <InboxViewContent />
        </InboxModelBoundary>
    );
});
