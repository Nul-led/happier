import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { SessionInPane } from '@/components/sessions/panes/SessionInPane';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/**
 * The peek of a Session the lead leads (lab `session-D`): the Session itself — its real transcript and
 * composer — beside the lead. Replies go to the peeked Session, and the line under the composer says
 * so, because the pane sits next to the lead's own composer.
 */

const stylesheet = StyleSheet.create((theme) => ({
    banner: {
        ...Typography.default(),
        color: theme.colors.text.tertiary,
        fontSize: 12,
        lineHeight: 16,
        paddingHorizontal: 16,
        paddingTop: 4,
        paddingBottom: 10,
    },
}));

export const SessionPeekDetailsView = React.memo((props: Readonly<{
    sessionId: string;
    serverId?: string | null;
    active: boolean;
}>) => {
    const styles = stylesheet;
    const banner = React.useMemo(() => (
        <Text testID="session-peek-replies-banner" numberOfLines={1} style={styles.banner}>
            {t('sessionWork.peek.repliesGoHere')}
        </Text>
    ), [styles.banner]);
    return (
        <SessionInPane
            sessionId={props.sessionId}
            serverId={props.serverId ?? null}
            active={props.active}
            composer
            repliesBanner={banner}
        />
    );
});
