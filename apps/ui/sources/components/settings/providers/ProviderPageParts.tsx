import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';

/**
 * A provider API key is never shown: a "Saved" pill and Replace, or Add when none is chosen. Either
 * opens the Saved Secret picker; the key itself stays in Saved Secrets.
 */
export function ProviderSavedSecretControl(props: Readonly<{
    testID: string;
    saved: boolean;
    disabled: boolean;
    onChoose: () => void;
}>) {
    return (
        <View style={stylesheet.secretControl}>
            {props.saved ? (
                <StatusPill testID={`${props.testID}.saved`} variant="success" label={t('settingsProvidersCollection.saved')} />
            ) : null}
            <RoundButton
                testID={`${props.testID}.choose`}
                size="small"
                display="secondary"
                title={props.saved ? t('settingsProvidersCollection.replace') : t('settingsProvidersCollection.addKey')}
                disabled={props.disabled}
                onPress={props.onChoose}
            />
        </View>
    );
}

/** The outcome of the header's Test, on the header's details line; a failure reads as one. */
export function ProviderProbeResult(props: Readonly<{ testID: string; text: string; failed: boolean }>) {
    return (
        <Text
            testID={props.testID}
            accessibilityLiveRegion="polite"
            style={[stylesheet.probeResult, props.failed ? stylesheet.probeFailed : null]}
        >
            {props.text}
        </Text>
    );
}

/** The row of a provider page header's actions: Test, the state control or Save, then `⋯`. */
export function ProviderHeaderActions(props: Readonly<{ children: React.ReactNode }>) {
    return <View style={stylesheet.headerActions}>{props.children}</View>;
}

const stylesheet = StyleSheet.create((theme) => ({
    secretControl: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    probeResult: {
        ...Typography.default(),
        fontSize: 13,
        lineHeight: 18,
        color: theme.colors.text.secondary,
    },
    probeFailed: {
        color: theme.colors.state.danger.foreground,
    },
}));
