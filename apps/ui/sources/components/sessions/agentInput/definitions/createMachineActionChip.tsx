import * as React from 'react';
import { Pressable, StyleSheet, type View } from 'react-native';

import { Text } from '@/components/ui/text/Text';
import { normalizeNodeForView } from '@/components/ui/rendering/normalizeNodeForView';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';
import { AGENT_INPUT_CHIP_ICON_SIZE_PX, AGENT_INPUT_CHIP_ICON_STYLE } from './agentInputChipIconMetrics';

const styles = StyleSheet.create({
    chip: { maxWidth: '100%', flexShrink: 1 },
    label: { minWidth: 0, flexShrink: 1 },
});

export function createMachineActionChip(params: Readonly<{
    anchorRef: React.RefObject<View | null>;
    machineName?: string | null;
    tint: string;
    showLabel: boolean;
    chipStyle: (pressed: boolean) => any;
    textStyle: any;
    onPress: () => void;
}>): React.ReactNode {
    const label = params.machineName === null
        ? t('agentInput.noMachinesAvailable')
        : (typeof params.machineName === 'string'
            ? params.machineName
            : t('newSession.selectMachineTitle'));
    return (
        <Pressable
            ref={params.anchorRef}
            key="machine"
            testID="agent-input-machine-chip"
            onPress={params.onPress}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={{ top: 5, bottom: 10, left: 0, right: 0 }}
            style={(state) => [params.chipStyle(state.pressed), styles.chip]}
        >
            {normalizeNodeForView(<Icon name="desktop" size={AGENT_INPUT_CHIP_ICON_SIZE_PX} color={params.tint} style={AGENT_INPUT_CHIP_ICON_STYLE} />)}
            {/* Optional origin/Home context precedes the exact Machine, so width pressure
                removes that context before truncating the execution destination. */}
            {params.showLabel ? (
                <Text numberOfLines={1} ellipsizeMode="head" style={[params.textStyle, styles.label]}>
                    {label}
                </Text>
            ) : null}
        </Pressable>
    );
}
