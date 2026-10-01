import * as React from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { HomeSettingEntryV1 } from '@happier-dev/protocol/home/governance';

import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { Switch } from '@/components/ui/forms/Switch';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Item } from '@/components/ui/lists/Item';
import { ITEM_SUBTITLE_TEXT_METRICS } from '@/components/ui/lists/itemDensityMetrics';
import { SegmentedTabBar } from '@/components/ui/navigation/SegmentedTabBar';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';

import { HomeDeploymentFixedNote } from './HomeDeploymentFixedNote';
import { homeSettingText } from './homeEmailSettingsForm';
import { isHomeSettingWritable } from './homeSettingDeclaration';
import type { HomeSettingDraftValue } from './homeSettingDraft';
import { homeSettingChoiceLabel } from './homeServerSettingLabels';

/** Enums with at most this many values are a segmented control; longer ones are a menu (§3.14). */
const SEGMENTED_ENUM_LIMIT = 4;

export type HomeSettingStage = (key: string, value: HomeSettingDraftValue | null) => void;

type EditableKind = 'switch' | 'segmented' | 'menu' | 'number' | 'text';

function editableKind(entry: HomeSettingEntryV1): EditableKind | null {
    const declaration = entry.declaration;
    const values = declaration?.bounds?.values ?? [];
    switch (declaration?.type) {
        case 'boolean':
            return 'switch';
        case 'enum':
            if (values.length === 0) return null;
            return values.length <= SEGMENTED_ENUM_LIMIT ? 'segmented' : 'menu';
        case 'int':
        case 'float':
            return 'number';
        case 'string':
        case 'url':
        case 'email':
        case 'list':
            return 'text';
        default:
            return null;
    }
}

/** A value as the row shows it when it cannot be edited: its text, else the declared default. */
export function homeSettingDisplayValue(entry: HomeSettingEntryV1): string | undefined {
    const value = entry.value;
    if (Array.isArray(value)) return value.join(', ');
    const text = homeSettingText(entry);
    if (text) return text;
    const fallback = entry.declaration?.default;
    if (fallback === undefined || fallback === null) return undefined;
    return Array.isArray(fallback) ? fallback.join(', ') : String(fallback);
}

/** A list value is edited as comma-separated text, which the registry codec parses back. */
function fieldText(entry: HomeSettingEntryV1): string {
    return Array.isArray(entry.value) ? entry.value.join(', ') : homeSettingText(entry);
}

/**
 * One registry-declared Home setting rendered from its declaration (plan §3.14 "Console
 * rendering"): boolean → switch; enum of up to four → segmented; longer enum → menu; int/float →
 * number field; string/url/email/list → text field (a list as comma-separated text); anything
 * else, a fixed key, or a read-only viewer → the value in words; a fixed key also carries the shared
 * `HomeDeploymentFixedNote`. Every change is staged through
 * `onStage`; a page that saves field by field commits on `onCommit` (focus leaves or submit).
 * The caller owns the words around the control (`title`, `subtitle`, `titleAccessory`).
 */
export const HomeSettingFieldRow = React.memo(function HomeSettingFieldRow(props: Readonly<{
    entry: HomeSettingEntryV1;
    title: string;
    subtitle?: string;
    titleAccessory?: React.ReactNode;
    staged: HomeSettingDraftValue | undefined;
    readOnly: boolean;
    disabled: boolean;
    /** The field's refusal in words, when the last write or parse refused it. */
    error: string | null;
    onStage: HomeSettingStage;
    onCommit?: (key: string) => void;
    showDivider?: boolean;
    testID: string;
    /** The facts under the label; replaces the default (the deployment-fixed note when fixed). */
    subtitleAccessory?: React.ReactNode;
    /** The unit a number is typed in ("ms", "MB"), shown beside its compact field. */
    unit?: string;
    /** Labels an enum value; defaults to its translated choice label. */
    choiceLabel?: (value: string) => string;
}>) {
    const { entry, staged, onStage, onCommit, testID } = props;
    const declaration = entry.declaration;
    const choiceLabel = props.choiceLabel ?? homeSettingChoiceLabel;
    const [menuOpen, setMenuOpen] = React.useState(false);
    const value = fieldText(entry);
    const stageValue = React.useCallback((next: unknown) => {
        onStage(entry.key, next === entry.value ? null : { kind: 'value', value: next });
    }, [entry.key, entry.value, onStage]);
    const stageText = React.useCallback((text: string) => {
        onStage(entry.key, text.trim() === value ? null : { kind: 'text', text });
    }, [entry.key, onStage, value]);
    const commit = React.useCallback(() => onCommit?.(entry.key), [entry.key, onCommit]);

    const kind = !props.readOnly && isHomeSettingWritable(entry) ? editableKind(entry) : null;
    // A key the deployment fixed says so through the one shared note, the key as a chip.
    const fixedNote = props.subtitleAccessory
        ?? (entry.fixed ? <HomeDeploymentFixedNote keys={[entry.key]} testID={testID} /> : undefined);
    const common = {
        testID,
        title: props.title,
        subtitle: props.subtitle,
        subtitleLines: 0,
        subtitleAccessory: fixedNote,
        titleAccessory: props.titleAccessory,
        showChevron: false,
        showDivider: props.showDivider,
    } as const;

    if (kind === null) {
        return <Item {...common} detail={homeSettingDisplayValue(entry)} mode="info" />;
    }
    const stagedValue = staged?.kind === 'value' ? staged.value : undefined;
    const values = declaration?.bounds?.values ?? [];
    switch (kind) {
        case 'switch':
            return (
                <Item
                    {...common}
                    mode="info"
                    rightElement={(
                        <Switch
                            testID={`${testID}.switch`}
                            accessibilityLabel={props.title}
                            value={(stagedValue ?? entry.value) === true}
                            disabled={props.disabled}
                            onValueChange={stageValue}
                        />
                    )}
                />
            );
        case 'segmented':
        case 'menu': {
            const active = typeof stagedValue === 'string'
                ? stagedValue
                : typeof entry.value === 'string' ? entry.value : String(declaration?.default ?? values[0]);
            if (kind === 'menu') {
                return (
                    <DropdownMenu
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        selectedId={active}
                        items={values.map((id) => ({ id, title: choiceLabel(id) }))}
                        onSelect={(id) => {
                            stageValue(id);
                            setMenuOpen(false);
                        }}
                        itemTrigger={{
                            title: props.title,
                            subtitle: props.subtitle,
                            showSelectedSubtitle: false,
                            itemProps: {
                                testID,
                                titleAccessory: props.titleAccessory,
                                subtitleLines: 0,
                                showDivider: props.showDivider,
                                disabled: props.disabled,
                            },
                        }}
                    />
                );
            }
            return (
                <Item
                    {...common}
                    mode="info"
                    accessoryLayout="adaptive"
                    rightElement={(
                        <SegmentedTabBar<string>
                            role="radiogroup"
                            tabs={values.map((id) => ({ id, label: choiceLabel(id) }))}
                            activeTabId={active}
                            onSelectTab={stageValue}
                            slidingThumb
                            segmentSizing="content"
                            disabled={props.disabled}
                            accessibilityLabel={props.title}
                            testIDPrefix={testID}
                        />
                    )}
                />
            );
        }
        case 'number':
        case 'text': {
            const numeric = kind === 'number';
            const fallback = declaration?.default;
            return (
                <Item
                    {...common}
                    mode="info"
                    accessoryLayout="adaptive"
                    rightElement={(
                        <View style={numeric ? styles.numberSlot : styles.textSlot}>
                        <FieldTextInput
                            testID={`${testID}.input`}
                            accessibilityLabel={props.title}
                            value={staged?.kind === 'text' ? staged.text : value}
                            placeholder={fallback === undefined || fallback === null
                                ? undefined
                                : Array.isArray(fallback) ? fallback.join(', ') : String(fallback)}
                            editable={!props.disabled}
                            autoCapitalize="none"
                            keyboardType={numeric ? 'number-pad' : undefined}
                            error={props.error}
                            onChangeText={stageText}
                            {...(onCommit ? { onBlur: commit, onSubmitEditing: commit } : {})}
                            style={styles.field}
                        />
                        {numeric && props.unit ? <Text style={styles.unit}>{props.unit}</Text> : null}
                        </View>
                    )}
                />
            );
        }
    }
});

// A number is a compact box with its unit beside it; free text and addresses take the width.
const styles = StyleSheet.create((theme) => ({
    numberSlot: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        width: 128,
        justifyContent: 'flex-end',
    },
    textSlot: {
        flexDirection: 'row',
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 200,
        maxWidth: 360,
    },
    field: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
    },
    unit: {
        ...Typography.default('regular'),
        ...ITEM_SUBTITLE_TEXT_METRICS.comfortable,
        color: theme.colors.text.secondary,
    },
}));
