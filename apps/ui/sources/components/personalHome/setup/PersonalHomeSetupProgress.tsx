import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { Icon, ICON_SIZE } from '@/components/ui/icons/Icon';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

import type { SetupRowState } from '../bootstrap/personalHomeBootstrapTypes';

const styles = StyleSheet.create((theme) => ({
    row: {
        minHeight: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.background.canvas,
    },
    icon: { width: 28, alignItems: 'center' },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.primary, fontSize: 15 },
    detail: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 13, flexShrink: 1 },
}));

function rowCopy(id: SetupRowState['id']): { title: string; detail: string } {
    switch (id) {
        case 'home': return {
            title: t('personalHome.bootstrap.preparingHomeTitle'),
            detail: t('personalHome.bootstrap.preparingHomeDetail'),
        };
        case 'app': return {
            title: t('personalHome.bootstrap.connectingAppTitle'),
            detail: t('personalHome.bootstrap.connectingAppDetail'),
        };
        case 'computer': return {
            title: t('personalHome.bootstrap.preparingComputerTitle'),
            detail: t('personalHome.bootstrap.preparingComputerDetail'),
        };
    }
}

function rowStatus(status: SetupRowState['status']): string {
    switch (status) {
        case 'pending': return t('personalHome.bootstrap.pending');
        case 'active': return t('personalHome.bootstrap.active');
        case 'complete': return t('personalHome.bootstrap.complete');
        case 'blocked': return t('personalHome.bootstrap.blocked');
    }
}

export const PersonalHomeSetupProgress = React.memo(function PersonalHomeSetupProgress(props: Readonly<{
    rows: readonly SetupRowState[];
}>) {
    const { theme } = useUnistyles();
    return (
        <View
            testID="personal-home-bootstrap-progress"
            accessibilityRole="list"
            accessibilityLabel={t('personalHome.bootstrap.progressLabel')}
        >
            {props.rows.map((item) => {
                const copy = rowCopy(item.id);
                const isActive = item.status === 'active';
                const isBlocked = item.status === 'blocked';
                return (
                    <View
                        key={item.id}
                        testID={`personal-home-bootstrap-row-${item.id}`}
                        accessible
                        accessibilityLabel={t('personalHome.bootstrap.rowAccessibilityLabel', {
                            title: copy.title,
                            status: rowStatus(item.status),
                            detail: copy.detail,
                        })}
                        accessibilityState={{ busy: isActive }}
                        style={styles.row}
                    >
                        <View style={styles.icon} accessible={false} accessibilityElementsHidden>
                            {isActive ? (
                                <ActivitySpinner
                                    accessible={false}
                                    size="small"
                                    color={theme.colors.button.primary.background}
                                />
                            ) : (
                                <Icon
                                    name={isBlocked ? 'warning-circle' : item.status === 'complete' ? 'check-circle' : 'circle'}
                                    size={ICON_SIZE.md}
                                    color={isBlocked ? theme.colors.text.secondary : item.status === 'complete' ? theme.colors.button.primary.background : theme.colors.text.tertiary}
                                />
                            )}
                        </View>
                        <View style={styles.copy}>
                            <Text style={styles.title}>{copy.title}</Text>
                            <Text style={styles.detail}>{copy.detail}</Text>
                        </View>
                    </View>
                );
            })}
        </View>
    );
});
