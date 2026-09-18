import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

import type { ExecutionRunLauncherProfileChoice } from './resolveExecutionRunLauncherProfileChoices';

export const ExecutionRunProfilePicker = React.memo((props: Readonly<{
    choices: readonly ExecutionRunLauncherProfileChoice[];
    selectedId: string;
    selectedGenerationId: string;
    editable?: boolean;
    sectionLabel: string;
    resolveAccessibilityLabel: (title: string) => string;
    onSelect: (choice: ExecutionRunLauncherProfileChoice) => void;
}>) => {
    const { theme } = useUnistyles();
    const interactiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    if (props.choices.length === 0) return null;

    return (
        <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                {props.sectionLabel}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {props.choices.map((choice) => {
                    const selected = choice.id === props.selectedId
                        && choice.generationId === props.selectedGenerationId;
                    return (
                        <Pressable
                            key={`${choice.id}:${choice.generationId}`}
                            testID={`execution-run-launcher-profile:${choice.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={props.resolveAccessibilityLabel(choice.title)}
                            accessibilityState={{ selected, disabled: choice.disabled || props.editable === false }}
                            disabled={choice.disabled || props.editable === false}
                            onPress={() => props.onSelect(choice)}
                            style={({ pressed }) => ({
                                minWidth: interactiveTargetSize,
                                minHeight: interactiveTargetSize,
                                alignItems: 'center',
                                justifyContent: 'center',
                                paddingVertical: 8,
                                paddingHorizontal: 10,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: theme.colors.border.default,
                                backgroundColor: theme.colors.surface.inset,
                                opacity: choice.disabled || props.editable === false ? 0.45 : pressed ? 0.7 : 1,
                            })}
                        >
                            <Text style={{
                                color: selected ? theme.colors.text.primary : theme.colors.text.secondary,
                                fontSize: 12,
                                fontWeight: '600',
                            }}>
                                {choice.title}
                            </Text>
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
});
