import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { HomeSettingEntryV1 } from '@happier-dev/protocol/home/governance';

import { RoundButton } from '@/components/ui/buttons/RoundButton';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Item } from '@/components/ui/lists/Item';
import { StatusPill } from '@/components/ui/status/StatusPill';
import { t } from '@/text';

import { HomeDeploymentFixedNote } from './HomeDeploymentFixedNote';
import { isHomeSettingWritable } from './homeSettingDeclaration';

/** What an owner asked for a write-only setting: keep it, type a replacement, or clear it. */
export type HomeSecretDraft =
    | Readonly<{ mode: 'keep' }>
    | Readonly<{ mode: 'replace'; text: string }>
    | Readonly<{ mode: 'clear' }>;

export const KEEP_HOME_SECRET: HomeSecretDraft = Object.freeze({ mode: 'keep' as const });

/**
 * One write-only Home setting (plan §3.14, invariant I3): the value is never shown. A stored value
 * reads Saved · Replace · Clear; with none stored the row is a masked field; a key the deployment
 * fixed, or a viewer who cannot write, sees only whether it is set. The draft belongs to the page:
 * Email stages it until Save, Server settings commits a replacement when the field is left
 * (`onCommit`) and a Clear at once.
 */
export const HomeSecretSettingRow = React.memo(function HomeSecretSettingRow(props: Readonly<{
    entry: HomeSettingEntryV1;
    title: string;
    subtitle?: string;
    titleAccessory?: React.ReactNode;
    draft: HomeSecretDraft;
    readOnly: boolean;
    disabled: boolean;
    error?: string | null;
    onChange: (draft: HomeSecretDraft) => void;
    /** With nothing stored, offer "Set" rather than an open field (Server settings, lab `hcServer`). */
    setWhenEmpty?: boolean;
    /** The facts under the label, rendered after the subtitle. */
    subtitleAccessory?: React.ReactNode;
    /** Commits a typed replacement (focus leaves the field or submit). */
    onCommit?: () => void;
    showDivider?: boolean;
    testID: string;
}>) {
    const { entry, draft, onChange, onCommit, testID, title } = props;
    const handleText = React.useCallback((text: string) => onChange({ mode: 'replace', text }), [onChange]);
    const saved = entry.secretSet === true;
    const common = {
        title,
        titleAccessory: props.titleAccessory,
        subtitleLines: 0,
        ...(props.subtitleAccessory ? { subtitleAccessory: props.subtitleAccessory } : {}),
        showChevron: false,
        showDivider: props.showDivider,
    } as const;
    if (entry.fixed || props.readOnly || !isHomeSettingWritable(entry)) {
        return (
            <Item
                {...common}
                testID={testID}
                subtitle={props.subtitle}
                subtitleAccessory={props.subtitleAccessory ?? (entry.fixed ? <HomeDeploymentFixedNote keys={[entry.key]} testID={testID} /> : undefined)}
                detail={saved
                    ? (entry.fixed ? t('homeSettings.secret.valueSet') : t('homeSettings.secret.saved'))
                    : t('homeSettings.secret.valueNotSet')}
                mode="info"
            />
        );
    }
    const keep = (
        <RoundButton
            testID={`${testID}-keep`}
            size="small"
            display="inverted"
            title={t('homeSettings.secret.keep')}
            disabled={props.disabled}
            onPress={() => onChange(KEEP_HOME_SECRET)}
        />
    );
    if (!saved && draft.mode === 'keep' && props.setWhenEmpty) {
        return (
            <Item
                {...common}
                testID={testID}
                subtitle={props.subtitle}
                rightElement={(
                    <RoundButton
                        testID={`${testID}-set`}
                        size="small"
                        display="secondary"
                        title={t('homeSettings.secret.setAction')}
                        disabled={props.disabled}
                        onPress={() => onChange({ mode: 'replace', text: '' })}
                    />
                )}
            />
        );
    }
    if (saved && draft.mode === 'clear') {
        return <Item {...common} subtitle={t('homeSettings.secret.clearPending')} rightElement={keep} />;
    }
    if (saved && draft.mode === 'keep') {
        return (
            <Item
                {...common}
                testID={testID}
                subtitle={props.subtitle}
                rightElement={(
                    <View style={styles.inlineControls}>
                        <StatusPill testID={`${testID}-saved`} variant="neutral" label={t('homeSettings.secret.saved')} />
                        <RoundButton
                            testID={`${testID}-replace`}
                            size="small"
                            display="secondary"
                            title={t('homeSettings.secret.replace')}
                            disabled={props.disabled}
                            onPress={() => onChange({ mode: 'replace', text: '' })}
                        />
                        <RoundButton
                            testID={`${testID}-clear`}
                            size="small"
                            display="inverted"
                            title={t('homeSettings.secret.clear')}
                            disabled={props.disabled}
                            onPress={() => onChange({ mode: 'clear' })}
                        />
                    </View>
                )}
            />
        );
    }
    return (
        <Item
            {...common}
            testID={testID}
            subtitle={props.subtitle}
            accessoryLayout="adaptive"
            rightElement={(
                <View style={styles.inlineControls}>
                    <FieldTextInput
                        testID={`${testID}-input`}
                        accessibilityLabel={title}
                        value={draft.mode === 'replace' ? draft.text : ''}
                        editable={!props.disabled}
                        secureTextEntry
                        autoCapitalize="none"
                        autoComplete="off"
                        autoFocus={saved || props.setWhenEmpty === true}
                        error={props.error ?? null}
                        onChangeText={handleText}
                        {...(onCommit ? { onBlur: onCommit, onSubmitEditing: onCommit } : {})}
                        style={styles.grow}
                    />
                    {saved ? keep : null}
                </View>
            )}
        />
    );
});

const styles = StyleSheet.create(() => ({
    inlineControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flexShrink: 1,
    },
    grow: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 160,
    },
}));
