import * as React from 'react';
import { View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import { StyleSheet } from 'react-native-unistyles';

/**
 * A deleted or unreachable saved workflow resolves to a clear missing state.
 * Admitted Runs and copied Automation recipes are unaffected, so this says what
 * is missing without implying anything else disappeared.
 */

const styles = StyleSheet.create((theme) => ({
    root: {
        padding: theme.margins.xxl,
        gap: theme.margins.sm,
        alignItems: 'flex-start',
    },
    title: {
        ...Typography.default('semiBold'),
        color: theme.colors.text.primary,
    },
    body: {
        ...Typography.default('regular'),
        color: theme.colors.text.secondary,
    },
}));

export function WorkflowMissingDefinitionState(props: Readonly<{
    testID?: string;
}>): React.ReactElement {
    return (
        <View testID={props.testID ?? 'workflow-missing-definition'} style={styles.root}>
            <Text style={styles.title}>{t('workflows.empty.savedTitle')}</Text>
            <Text style={styles.body}>{t('workflows.save.deleteBody')}</Text>
        </View>
    );
}
