import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icons/Icon';
import { Popover } from '@/components/ui/popover/Popover';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import type { WorkflowBlockKind } from '@/sync/domains/workflows/workflowEditorDraft';

import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * One contextual Add control per block-list scope.
 *
 * The active scope supplies the insertion point, so nesting levels do not each
 * grow their own toolbar of equally loud buttons.
 */

const ADD_OPTIONS: ReadonlyArray<Readonly<{ kind: WorkflowBlockKind; labelKey: 'addStep' | 'addParallel' | 'addLoop' | 'addIf' }>> = [
    { kind: 'step', labelKey: 'addStep' },
    { kind: 'parallel', labelKey: 'addParallel' },
    { kind: 'loop', labelKey: 'addLoop' },
    { kind: 'if', labelKey: 'addIf' },
];

export function WorkflowAddBlockMenu(props: Readonly<{
    onAdd: (kind: WorkflowBlockKind) => void;
    /** Names the scope the new block joins, for the accessible label. */
    scopeLabel: string;
    testID?: string;
}>): React.ReactElement {
    const anchorRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);

    return (
        <View style={workflowEditorStyles.addRow}>
            <Pressable
                ref={anchorRef as unknown as React.Ref<View>}
                testID={props.testID}
                accessibilityRole="button"
                accessibilityLabel={t('workflows.editor.addAccessibility')}
                accessibilityHint={props.scopeLabel}
                onPress={() => setOpen((value) => !value)}
                style={[workflowEditorStyles.actionTarget, workflowEditorStyles.addRow]}
            >
                <Icon name="plus" size={16} />
                <Text style={workflowEditorStyles.addLabel}>{t('workflows.editor.add')}</Text>
            </Pressable>
            <Popover
                open={open}
                anchorRef={anchorRef}
                onRequestClose={() => setOpen(false)}
                placement="auto"
                closeOnAnchorPress
            >
                {() => (
                    <View style={workflowEditorStyles.menuSurface} accessibilityRole="menu">
                        {ADD_OPTIONS.map((option) => (
                            <Pressable
                                key={option.kind}
                                testID={props.testID === undefined ? undefined : `${props.testID}-${option.kind}`}
                                accessibilityRole="menuitem"
                                accessibilityLabel={t(`workflows.editor.${option.labelKey}`)}
                                onPress={() => {
                                    setOpen(false);
                                    props.onAdd(option.kind);
                                }}
                                style={({ pressed }) => [
                                    workflowEditorStyles.menuRow,
                                    pressed ? workflowEditorStyles.menuRowPressed : null,
                                ]}
                            >
                                <Text style={workflowEditorStyles.menuRowLabel}>
                                    {t(`workflows.editor.${option.labelKey}`)}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </Popover>
        </View>
    );
}
