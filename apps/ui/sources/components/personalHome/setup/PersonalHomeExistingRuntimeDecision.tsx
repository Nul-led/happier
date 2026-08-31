import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

const styles = StyleSheet.create((theme) => ({
    root: { gap: 14, marginTop: 20 },
    body: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 14, lineHeight: 21, flexShrink: 1 },
    actions: { gap: 10 },
    button: { minHeight: 52, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border.default },
    title: { ...Typography.default('semiBold'), color: theme.colors.text.primary },
    subtitle: { ...Typography.default(), color: theme.colors.text.secondary, fontSize: 13, marginTop: 3, flexShrink: 1 },
}));

export const PersonalHomeExistingRuntimeDecision = React.memo(function PersonalHomeExistingRuntimeDecision(props: Readonly<{
    primaryActionRef?: React.Ref<React.ElementRef<typeof Pressable>>;
    onUseExisting: () => void;
    onUseAnotherHome: () => void;
}>) {
    const { theme } = useUnistyles();
    return (
        <View testID="personal-home-existing-runtime-decision" style={styles.root}>
            <Text style={styles.body}>{t('personalHome.bootstrap.existingRuntimeBody')}</Text>
            <View style={styles.actions}>
                <Pressable ref={props.primaryActionRef} testID="personal-home-use-existing" accessibilityRole="button" accessibilityLabel={t('personalHome.bootstrap.useExisting')} onPress={props.onUseExisting} style={[styles.button, { backgroundColor: theme.colors.button.primary.background, borderColor: theme.colors.button.primary.background }]}>
                    <Text style={[styles.title, { color: theme.colors.button.primary.tint }]}>{t('personalHome.bootstrap.useExisting')}</Text>
                    <Text style={[styles.subtitle, { color: theme.colors.button.primary.tint }]}>{t('personalHome.bootstrap.useExistingDetail')}</Text>
                </Pressable>
                <Pressable testID="personal-home-use-another" accessibilityRole="button" accessibilityLabel={t('personalHome.bootstrap.useAnother')} onPress={props.onUseAnotherHome} style={styles.button}>
                    <Text style={styles.title}>{t('personalHome.bootstrap.useAnother')}</Text>
                    <Text style={styles.subtitle}>{t('personalHome.bootstrap.useAnotherDetail')}</Text>
                </Pressable>
            </View>
        </View>
    );
});
