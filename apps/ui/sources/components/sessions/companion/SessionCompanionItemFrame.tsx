import * as React from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { ItemRowActions } from '@/components/ui/lists/ItemRowActions';
import type { ItemAction } from '@/components/ui/lists/itemActions';
import { t } from '@/text';

const stylesheet = StyleSheet.create(() => ({
    root: { gap: 4 },
    controls: { flexDirection: 'row', justifyContent: 'flex-end' },
}));

/**
 * The Companion's local frame around one item.
 *
 * It owns ONLY placement-local affordances — reorder, remove-from-Companion and
 * Open on Board. Title, provenance, typed states and renderer selection stay with
 * `SessionWidgetHost` (or, for the built-in card, with the summary itself), so
 * this frame never becomes a second item shell or a second copy of the shared
 * state table.
 */
export const SessionCompanionItemFrame = React.memo(function SessionCompanionItemFrame(props: Readonly<{
    /** The item's own accessible name, from its canonical presentation owner. */
    label: string;
    actions: readonly ItemAction[];
    children: React.ReactNode;
    testID: string;
    onLayout?: (event: LayoutChangeEvent) => void;
}>) {
    const styles = stylesheet;
    const actions = React.useMemo(() => [...props.actions], [props.actions]);

    return (
        <View style={styles.root} testID={props.testID} onLayout={props.onLayout}>
            {actions.length > 0 ? (
                <View style={styles.controls}>
                    <ItemRowActions
                        title={props.label}
                        actions={actions}
                        // One overflow control keeps the card quiet; hover is never
                        // the only way to reach these on touch or with a keyboard.
                        compactThreshold={Number.POSITIVE_INFINITY}
                        overflowTriggerTestID={`${props.testID}-actions`}
                        overflowTriggerAccessibilityLabel={t('sessionBoard.companion.actions.itemMenuA11y', {
                            title: props.label,
                        })}
                        iconSize={16}
                        gap={6}
                    />
                </View>
            ) : null}
            {props.children}
        </View>
    );
});
