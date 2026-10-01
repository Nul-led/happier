import * as React from 'react';
import { StyleSheet } from 'react-native-unistyles';

import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { Text } from '@/components/ui/text/Text';
import { workStatusWordStyle } from '@/components/work/status/workStatusTreatment';
import { t } from '@/text';

/**
 * One trigger, as every trigger list shows it (07 S16 owner-approved presentation, item 4; I4-W
 * §Handoff): named by what it runs, then one quiet line with its qualifier and last outcome, then
 * its switch. "Failed" takes the trouble tone; a turned-off row is dimmed and reads "Off", while its
 * switch keeps its full hit target.
 *
 * The row draws no divider, card or inset of its own: the enclosing sheet group owns them.
 */
export type TriggerRowOutcome = Readonly<{ text: string; tone: 'neutral' | 'danger' }>;

export type TriggerRowProps = Readonly<{
    testID: string;
    /** What it runs: a workflow's name or the inline Then ("Notify me → Discord"). */
    title: string;
    /** The qualifier ("Files changed", "When it needs you"), when there is one. */
    qualifier?: string | null;
    /** Retained legacy content is not a one-line editable summary. */
    multiline?: boolean;
    outcome?: TriggerRowOutcome | null;
    enabled: boolean;
    /** Why the switch cannot change right now (a pending write, an unavailable writer). */
    toggleDisabled?: boolean;
    onToggle: (next: boolean) => void;
    /** Opens the trigger's popover; without it the row is information only. */
    onPress?: () => void;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    off: { color: theme.colors.text.tertiary },
}));

export const TriggerRow = React.memo(function TriggerRow(props: TriggerRowProps) {
    const styles = stylesheet;
    const lead = props.enabled
        ? props.qualifier ?? null
        : [t('workflows.triggers.row.off'), props.qualifier].filter(Boolean).join(' · ');
    const outcome = props.enabled ? props.outcome ?? null : null;
    const subtitle = outcome === null
        ? lead
        : (
            <Text>
                {lead ? `${lead} · ` : ''}
                <Text testID={`${props.testID}-outcome`} style={workStatusWordStyle(outcome.tone)}>{outcome.text}</Text>
            </Text>
        );
    return (
        <Item
            testID={props.testID}
            title={props.title}
            {...(props.multiline ? { titleLines: 0, subtitleLines: 0 } : {})}
            {...(subtitle ? { subtitle } : {})}
            {...(props.enabled ? {} : { titleStyle: styles.off, subtitleStyle: styles.off })}
            {...(props.onPress ? { onPress: props.onPress } : { mode: 'info' as const })}
            showChevron={false}
            rightElementOutsidePressable
            rightElement={(
                <Switch
                    testID={`${props.testID}-switch`}
                    value={props.enabled}
                    disabled={props.toggleDisabled}
                    accessibilityLabel={t(props.enabled ? 'workflows.triggers.row.turnOff' : 'workflows.triggers.row.turnOn', { name: props.title })}
                    onValueChange={props.onToggle}
                />
            )}
        />
    );
});
