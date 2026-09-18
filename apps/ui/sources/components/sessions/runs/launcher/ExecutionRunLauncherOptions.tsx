import type { EffectiveActionInputField } from '@happier-dev/protocol';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

import { ActionInputFields, type ActionFieldOption } from '@/components/sessions/actions/ActionInputFields';
import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { t } from '@/text';

import { ExecutionRunProfilePicker } from './ExecutionRunProfilePicker';
import type { ExecutionRunLauncherBackendChoice } from './resolveExecutionRunLauncherBackendChoices';
import type { ExecutionRunLauncherProfileChoice } from './resolveExecutionRunLauncherProfileChoices';

const alwaysCustomFieldPaths = new Set([
    'backendTargetKeys',
    'engineIds',
    'instructions',
    'secretReferenceOverlay',
    'teamCredentialModel',
    'teamCredentialSessionBindingConsent',
]);

export function resolveExecutionRunLauncherOptionFields(params: Readonly<{
    fields: readonly EffectiveActionInputField[];
    includeInstructions?: boolean;
    hasSpecializedPermissionOptions: boolean;
}>): readonly EffectiveActionInputField[] {
    return params.fields.filter((field) => {
        if (field.path === 'permissionMode') return !params.hasSpecializedPermissionOptions;
        return params.includeInstructions === true
            ? !alwaysCustomFieldPaths.has(field.path) || field.path === 'instructions'
            : !alwaysCustomFieldPaths.has(field.path);
    });
}

export const ExecutionRunLauncherOptions = React.memo((props: Readonly<{
    backendChoices: readonly ExecutionRunLauncherBackendChoice[];
    selectedBackendTargetKeys: readonly string[];
    profileChoices: readonly ExecutionRunLauncherProfileChoice[];
    selectedProfileId: string;
    selectedProfileGenerationId: string;
    selectedPermissionMode: string;
    permissionModeOptions: readonly ActionFieldOption[];
    fields: readonly EffectiveActionInputField[];
    input: Record<string, unknown>;
    editable: boolean;
    resolveFieldOptions: (field: EffectiveActionInputField) => readonly ActionFieldOption[];
    includeInstructions?: boolean;
    onSelectBackend: (targetKey: string) => void;
    onSelectProfile: (choice: ExecutionRunLauncherProfileChoice) => void;
    onPatch: (patch: Record<string, unknown>) => void;
}>) => {
    const { theme } = useUnistyles();
    // The shared platform policy owns this number; the launcher must not keep its
    // own Run-local 44 next to it.
    const interactiveTargetSize = resolveMinimumInteractiveTargetSize(Platform.OS);
    const optionFields = React.useMemo(() => resolveExecutionRunLauncherOptionFields({
        fields: props.fields,
        includeInstructions: props.includeInstructions,
        hasSpecializedPermissionOptions: props.permissionModeOptions.length > 0,
    }), [props.fields, props.includeInstructions, props.permissionModeOptions.length]);
    return (
        <View style={{ gap: 16 }}>
            <View style={{ gap: 8 }}>
                <Text style={{ color: theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                    {t('executionRuns.newRun.sections.backends')}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                    {props.backendChoices.map((choice) => {
                        const selected = props.selectedBackendTargetKeys.includes(choice.targetKey);
                        return (
                            <Pressable
                                key={choice.targetKey}
                                testID={`execution-run-launcher-target:${choice.targetKey}`}
                                accessibilityRole="button"
                                accessibilityLabel={t('executionRuns.newRun.a11y.toggleBackend', { backendId: choice.title })}
                                accessibilityState={{ selected, disabled: choice.disabled || !props.editable }}
                                disabled={choice.disabled || !props.editable}
                                onPress={() => props.onSelectBackend(choice.targetKey)}
                                style={({ pressed }) => ({
                                    minWidth: interactiveTargetSize,
                                    minHeight: interactiveTargetSize,
                                    justifyContent: 'center',
                                    paddingVertical: 8,
                                    paddingHorizontal: 12,
                                    borderRadius: 10,
                                    borderWidth: 1,
                                    borderColor: selected ? theme.colors.text.secondary : theme.colors.border.default,
                                    backgroundColor: theme.colors.surface.inset,
                                    opacity: choice.disabled || !props.editable ? 0.45 : pressed ? 0.7 : 1,
                                })}
                            >
                                <Text style={{ color: selected ? theme.colors.text.primary : theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                                    {choice.title}
                                </Text>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
            <ExecutionRunProfilePicker
                choices={props.profileChoices}
                selectedId={props.selectedProfileId}
                selectedGenerationId={props.selectedProfileGenerationId}
                editable={props.editable}
                sectionLabel={t('executionRuns.newRun.sections.profiles')}
                resolveAccessibilityLabel={(title) => t('executionRuns.newRun.a11y.selectProfile', { profile: title })}
                onSelect={props.onSelectProfile}
            />
            {props.permissionModeOptions.length > 1 ? (
                <View style={{ gap: 8 }}>
                    <Text style={{ color: theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                        {t('executionRuns.newRun.sections.permissions')}
                    </Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                        {props.permissionModeOptions.map((option) => {
                            const selected = props.selectedPermissionMode === option.value;
                            return (
                                <Pressable
                                    key={String(option.value)}
                                    testID={`execution-run-launcher-permission-mode:${String(option.value)}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={t('executionRuns.newRun.a11y.selectPermissionMode', { mode: option.label })}
                                    accessibilityState={{ selected, disabled: !props.editable }}
                                    disabled={!props.editable}
                                    onPress={() => props.onPatch({ permissionMode: option.value })}
                                    style={({ pressed }) => ({
                                        minWidth: interactiveTargetSize,
                                        minHeight: interactiveTargetSize,
                                        justifyContent: 'center',
                                        paddingVertical: 8,
                                        paddingHorizontal: 12,
                                        borderRadius: 10,
                                        borderWidth: 1,
                                        borderColor: selected ? theme.colors.text.secondary : theme.colors.border.default,
                                        backgroundColor: theme.colors.surface.inset,
                                        opacity: !props.editable ? 0.45 : pressed ? 0.7 : 1,
                                    })}
                                >
                                    <Text style={{ color: selected ? theme.colors.text.primary : theme.colors.text.secondary, fontSize: 12, fontWeight: '600' }}>
                                        {option.label}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>
            ) : null}
            {optionFields.length > 0 ? (
                <ActionInputFields
                    fields={optionFields}
                    input={props.input}
                    editable={props.editable}
                    resolveFieldOptions={props.resolveFieldOptions}
                    resolveFieldTestID={(field) => field.path === 'instructions' ? 'execution-run-new-instructions-input' : undefined}
                    onPatch={props.onPatch}
                />
            ) : null}
        </View>
    );
});
