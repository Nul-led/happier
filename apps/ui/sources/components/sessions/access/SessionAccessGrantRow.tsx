import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { Text } from '@/components/ui/text/Text';
import { Switch } from '@/components/ui/forms/Switch';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { SafeIonicons } from '@/components/ui/icons/SafeIonicons';
import { ITEM_ICON_GLYPH_SIZE } from '@/components/ui/lists/itemDensityMetrics';
import { useResolvedItemDensity } from '@/components/ui/lists/useResolvedItemDensity';
import { t } from '@/text';
import type { SessionAccessEditorActions, SessionAccessGrantRowModel, SessionAccessLevel } from './sessionAccessEditorTypes';
import { projectSessionAccessLevelLabel } from './projectSessionAccessLevelLabel';

const styles = StyleSheet.create((theme) => ({
    controls: { paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
    choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    action: { minHeight: resolveMinimumInteractiveTargetSize(Platform.OS), justifyContent: 'center', paddingHorizontal: 8 },
    text: { color: theme.colors.text.primary },
    secondary: { color: theme.colors.text.secondary },
    selected: { color: theme.colors.text.link },
    delegation: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
}));

export function sessionAccessLevelLabel(level: SessionAccessLevel): string {
    return projectSessionAccessLevelLabel(level);
}

export function SessionAccessRowAction(props: Readonly<{
    label: string; testID: string; onPress(): void; disabled?: boolean; selected?: boolean; accessibilityLabel?: string;
}>): React.ReactElement {
    return <Pressable testID={props.testID} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? props.label}
        accessibilityState={{ disabled: props.disabled === true, ...(props.selected === undefined ? {} : { selected: props.selected }) }}
        disabled={props.disabled} onPress={props.onPress} style={styles.action}>
        <Text style={props.selected ? styles.selected : styles.text}>{props.label}</Text>
    </Pressable>;
}

export function SessionAccessLevelControl(props: Readonly<{
    row: SessionAccessGrantRowModel; actions: SessionAccessEditorActions; onExpand(): void; testID: string;
}>): React.ReactElement {
    const { row, actions } = props;
    const { theme } = useUnistyles();
    // This accessory renders beside the row's own text, so the lock glyph follows
    // the user's list density like every other glyph in that row.
    const glyphSize = ITEM_ICON_GLYPH_SIZE[useResolvedItemDensity()];
    const label = sessionAccessLevelLabel(row.level.value);
    return <View style={styles.delegation}>
        {row.requiredByTeamPolicy ? <SafeIonicons name="lock-closed-outline" size={glyphSize} color={theme.colors.text.secondary} /> : null}
        <SessionAccessRowAction label={label} testID={props.testID}
        accessibilityLabel={t('session.access.accessibleControl', { name: row.principal.accessibilityLabel, control: t('session.sharing.accessLevel'), value: label })}
        disabled={row.operation.kind === 'saving' || row.operation.kind === 'removing'}
        onPress={() => row.level.kind === 'locked' ? actions.explain(row.level.reason) : props.onExpand()} />
    </View>;
}

export function SessionAccessGrantRow(props: Readonly<{
    row: SessionAccessGrantRowModel; actions: SessionAccessEditorActions; editable: boolean; idPrefix: string;
}>): React.ReactElement {
    const { row, actions, editable, idPrefix } = props;
    const busy = row.operation.kind === 'saving' || row.operation.kind === 'removing';
    const id = (kind: string) => `${idPrefix}session-access-${kind}:${row.principal.key}`;
    return <View style={styles.controls}>
        {row.level.kind === 'locked' ? <Text style={styles.secondary}>{row.level.reason.message}</Text> : null}
        {editable && row.level.kind === 'editable' ? <View style={styles.choices}>
            {row.level.options.map((option) => <SessionAccessRowAction key={option.value} label={option.label}
                testID={`${id('level')}:${option.value}`} disabled={busy} selected={row.level.value === option.value}
                accessibilityLabel={`${row.principal.accessibilityLabel}, ${option.label}`}
                onPress={() => actions.setAccessLevel(row.grant, option.value)} />)}
        </View> : null}
        {row.permissionDelegation.kind !== 'hidden' ? <View style={styles.delegation}>
            <Text style={styles.text}>{t('session.access.delegation')}</Text>
            {editable && row.permissionDelegation.kind === 'editable' ? <Switch testID={id('delegation')}
                value={row.permissionDelegation.value} disabled={busy}
                accessibilityLabel={`${row.principal.accessibilityLabel}, ${t('session.access.delegation')}`}
                onValueChange={(value) => actions.setPermissionDelegation(row.grant, value)} /> :
                <Text style={styles.secondary}>{row.permissionDelegation.value ? t('common.on') : t('common.off')}</Text>}
            {row.permissionDelegation.kind === 'locked' ? <SessionAccessRowAction label={row.permissionDelegation.reason.message}
                testID={id('delegation-reason')} onPress={() => {
                    if (row.permissionDelegation.kind === 'locked') actions.explain(row.permissionDelegation.reason);
                }} /> : null}
        </View> : null}
        {row.operation.kind === 'error' ? <Text accessibilityLiveRegion="polite" style={styles.secondary}>{row.operation.error.message}</Text> : null}
        {editable && row.removal.kind === 'allowed' ? <SessionAccessRowAction testID={id('remove')} label={t('session.access.remove')}
            disabled={busy} onPress={() => actions.requestRemove(row.grant)} /> : null}
        {editable && row.removal.kind === 'confirming' ? <>
            {row.removal.consequences.map((consequence) => <Text key={consequence}
                testID={id('remove-consequence')} accessibilityLiveRegion="polite" style={styles.secondary}>{consequence}</Text>)}
            <View style={styles.choices}>
                <SessionAccessRowAction testID={id('remove-confirm')} label={t('session.access.confirmRemove')}
                    disabled={busy} onPress={() => actions.confirmRemove(row.grant)} />
                <SessionAccessRowAction testID={id('remove-cancel')} label={t('common.cancel')}
                    disabled={busy} onPress={() => actions.cancelRemove(row.grant)} />
            </View>
        </> : null}
        {row.removal.kind === 'blocked' ? <SessionAccessRowAction testID={id('remove-reason')} label={row.removal.reason.message}
            onPress={() => { if (row.removal.kind === 'blocked') actions.explain(row.removal.reason); }} /> : null}
    </View>;
}
