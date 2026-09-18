import * as React from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icons/Icon';
import { Popover } from '@/components/ui/popover/Popover';
import { Text } from '@/components/ui/text/Text';
import { t } from '@/text';

import { workflowEditorStyles } from './workflowEditorStyles';

/**
 * Per-block overflow actions.
 *
 * Move up/down/in/out always appear here, so reordering never depends on a drag
 * gesture and stays reachable by keyboard and screen reader. Actions that cannot
 * make progress are omitted rather than shown inert.
 */

export type WorkflowBlockAction = Readonly<{
    id: 'moveUp' | 'moveDown' | 'moveIn' | 'moveOut' | 'remove';
    label: string;
    destructive?: boolean;
    onSelect: () => void;
}>;

export function WorkflowBlockActionsMenu(props: Readonly<{
    blockLabel: string;
    actions: readonly WorkflowBlockAction[];
    testID?: string;
}>): React.ReactElement | null {
    const anchorRef = React.useRef<View>(null);
    const [open, setOpen] = React.useState(false);

    if (props.actions.length === 0) return null;

    return (
        <>
            <Pressable
                ref={anchorRef as unknown as React.Ref<View>}
                testID={props.testID}
                accessibilityRole="button"
                // This is the block's overflow menu, not Add. Announcing "Add a
                // block to this workflow" told every screen-reader user the
                // wrong thing about what pressing it does.
                accessibilityLabel={t('common.moreActions')}
                accessibilityHint={props.blockLabel}
                onPress={() => setOpen((value) => !value)}
                style={workflowEditorStyles.actionTarget}
            >
                <Icon name="dots-three" size={18} />
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
                        {props.actions.map((action) => (
                            <Pressable
                                key={action.id}
                                testID={props.testID === undefined ? undefined : `${props.testID}-${action.id}`}
                                accessibilityRole="menuitem"
                                accessibilityLabel={action.label}
                                onPress={() => {
                                    setOpen(false);
                                    action.onSelect();
                                }}
                                style={({ pressed }) => [
                                    workflowEditorStyles.menuRow,
                                    pressed ? workflowEditorStyles.menuRowPressed : null,
                                ]}
                            >
                                <Text style={workflowEditorStyles.menuRowLabel}>{action.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                )}
            </Popover>
        </>
    );
}
