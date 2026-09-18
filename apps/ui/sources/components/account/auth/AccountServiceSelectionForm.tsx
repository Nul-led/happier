import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import type { AccountServiceEndpointV1 } from '@/sync/domains/server/serverProfiles';
import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { Text, TextInput } from '@/components/ui/text/Text';
import { WizardChoiceRow } from '@/components/onboarding/ui/WizardChoiceRow';
import { Typography } from '@/constants/Typography';
import { t } from '@/text';
import type { SelectAccountServiceEndpointResult } from '@/sync/ops/accountDirectory/selectAccountServiceEndpoint';
import { toServerUrlDisplay } from '@/sync/domains/server/url/serverUrlDisplay';

export type AccountServiceSelectionResult = SelectAccountServiceEndpointResult;

export type AccountServiceSelectionFormProps = Readonly<{
    currentEndpoint: AccountServiceEndpointV1 | null;
    onBack: () => void;
    onSelect: (url: string, options: Readonly<{ signal: AbortSignal }>) => Promise<AccountServiceSelectionResult>;
}>;

type ActiveSelectionAttempt = Readonly<{
    url: string;
    controller: AbortController;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    root: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
    choices: { gap: 10 },
    field: { gap: 8 },
    label: { color: theme.colors.text.primary, fontSize: 14, lineHeight: 20, ...Typography.default('semiBold') },
    input: {
        minHeight: 54,
        borderWidth: 1,
        borderColor: theme.colors.border.default,
        borderRadius: 14,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        fontSize: 16,
        lineHeight: 22,
        ...Typography.default(),
    },
    error: { color: theme.colors.state.danger.foreground, fontSize: 14, lineHeight: 20, ...Typography.default() },
    actions: { gap: 12 },
}));

function resultMessage(result: Exclude<AccountServiceSelectionResult['kind'], 'selected'>): string {
    if (result === 'invalid') return t('welcome.signInServiceInvalidAddress');
    if (result === 'unsupported') return t('welcome.signInServiceUnsupportedBody');
    return t('welcome.signInServiceUnavailableTitle');
}

function endpointLabel(endpoint: AccountServiceEndpointV1): string {
    if (endpoint.displayName) return endpoint.displayName;
    return toServerUrlDisplay(endpoint.url) || endpoint.url;
}

export const AccountServiceSelectionForm = React.memo(function AccountServiceSelectionForm(props: AccountServiceSelectionFormProps) {
    const { theme } = useUnistyles();
    const styles = stylesheet;
    const inputRef = React.useRef<React.ElementRef<typeof TextInput>>(null);
    const activeAttemptRef = React.useRef<ActiveSelectionAttempt | null>(null);
    const [showUrlInput, setShowUrlInput] = React.useState(props.currentEndpoint == null);
    const [url, setUrl] = React.useState('');
    const [error, setError] = React.useState<string | null>(null);

    const cancelActiveAttempt = React.useCallback(() => {
        activeAttemptRef.current?.controller.abort();
        activeAttemptRef.current = null;
    }, []);

    React.useEffect(() => cancelActiveAttempt, [cancelActiveAttempt]);

    const select = React.useCallback(async (rawUrl: string) => {
        const trimmed = rawUrl.trim();
        if (!trimmed) {
            setError(t('welcome.signInServiceInvalidAddress'));
            inputRef.current?.focus();
            return;
        }
        const activeAttempt = activeAttemptRef.current;
        if (activeAttempt?.url === trimmed) return;
        activeAttempt?.controller.abort();
        const controller = new AbortController();
        const nextAttempt: ActiveSelectionAttempt = { url: trimmed, controller };
        activeAttemptRef.current = nextAttempt;
        setError(null);
        try {
            const result = await props.onSelect(trimmed, { signal: controller.signal });
            if (activeAttemptRef.current !== nextAttempt || controller.signal.aborted || result.kind === 'selected') return;
            setError(resultMessage(result.kind));
            setShowUrlInput(true);
            inputRef.current?.focus();
        } finally {
            if (activeAttemptRef.current === nextAttempt) activeAttemptRef.current = null;
        }
    }, [props.onSelect]);

    const goBack = React.useCallback(() => {
        cancelActiveAttempt();
        props.onBack();
    }, [cancelActiveAttempt, props.onBack]);

    return (
        <View testID="account-service-selection-form" style={styles.root}>
            <View style={styles.choices}>
                {props.currentEndpoint ? (
                    <WizardChoiceRow
                        testID="account-service-current-choice"
                        selected={false}
                        icon="globe"
                        title={endpointLabel(props.currentEndpoint)}
                        subtitle={props.currentEndpoint.url}
                        onPress={() => select(props.currentEndpoint!.url)}
                    />
                ) : null}
                <WizardChoiceRow
                    testID="account-service-another-choice"
                    selected={showUrlInput}
                    icon="plus-circle"
                    title={t('welcome.chooseSignInService')}
                    subtitle={t('welcome.signInServiceUrlPrompt')}
                    onPress={() => {
                        setShowUrlInput(true);
                    }}
                />
            </View>
            {showUrlInput ? (
                <View style={styles.field}>
                    <Text style={styles.label}>{t('welcome.signInServiceUrlPrompt')}</Text>
                    <TextInput
                        ref={inputRef}
                        testID="account-service-url-input"
                        accessibilityLabel={t('welcome.signInServiceUrlPrompt')}
                        style={styles.input}
                        placeholder={t('common.urlPlaceholder')}
                        placeholderTextColor={theme.colors.input.placeholder}
                        value={url}
                        onChangeText={(value) => {
                            setUrl(value);
                            if (error) setError(null);
                        }}
                        onSubmitEditing={() => {
                            void select(url);
                        }}
                        autoFocus={props.currentEndpoint == null}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                        returnKeyType="go"
                    />
                    {error ? <Text testID="account-service-url-error" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                </View>
            ) : null}
            <View style={styles.actions}>
                {showUrlInput ? (
                    <RoundButton testID="account-service-url-submit" title={t('common.continue')} action={() => select(url)} />
                ) : null}
                <RoundButton testID="account-service-selection-back" title={t('common.back')} display="inverted" onPress={goBack} />
            </View>
        </View>
    );
});
