import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Icon } from '@/components/ui/icons/Icon';
import { Popover } from '@/components/ui/popover';
import { Text } from '@/components/ui/text/Text';
import { useIsTablet } from '@/utils/platform/responsive';
import { Modal } from '@/modal';
import type { CustomModalInjectedProps } from '@/modal/types';

import {
    SessionListFilterEditor,
    type SessionListFilterEditorProps,
} from './SessionListFilterEditor';

type EditorProps = Omit<SessionListFilterEditorProps, 'onDone' | 'maxHeight'>;

export type SessionListFilterEditorControlProps = Readonly<{
    label: string;
    active: boolean;
    editor: EditorProps;
}>;

const stylesheet = StyleSheet.create((theme) => ({
    trigger: {
        minHeight: 44,
        minWidth: 44,
        maxWidth: 190,
        paddingHorizontal: 10,
        borderRadius: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    triggerActive: {
        backgroundColor: theme.colors.surface.selected,
    },
    triggerPressed: {
        backgroundColor: theme.colors.surface.pressed,
    },
    triggerLabel: {
        minWidth: 0,
        flexShrink: 1,
        color: theme.colors.text.secondary,
    },
    modalBody: {
        minHeight: 320,
        alignItems: 'stretch',
    },
}));

function SessionListFilterEditorModal(
    props: EditorProps & CustomModalInjectedProps,
) {
    const styles = stylesheet;
    return (
        <View style={styles.modalBody}>
            <SessionListFilterEditor
                {...props}
                onDone={props.onClose}
                maxHeight={520}
            />
        </View>
    );
}

export const SessionListFilterEditorControl = React.memo(function SessionListFilterEditorControl(
    props: SessionListFilterEditorControlProps,
) {
    const styles = stylesheet;
    const { theme } = useUnistyles();
    const isTablet = useIsTablet();
    const usePopoverHost = Platform.OS === 'web' || isTablet;
    const [popoverOpen, setPopoverOpen] = React.useState(false);
    const anchorRef = React.useRef<View>(null);
    const modalIdRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const modalId = modalIdRef.current;
        if (!modalId) return;
        Modal.update(modalId, props.editor);
    }, [props.editor]);

    const open = React.useCallback(() => {
        if (usePopoverHost) {
            setPopoverOpen(true);
            return;
        }
        if (modalIdRef.current) return;
        let modalId = '';
        modalId = Modal.show({
            component: SessionListFilterEditorModal,
            props: props.editor,
            chrome: {
                kind: 'card',
                title: props.editor.labels.title,
                bodyScroll: 'none',
                scrollHost: 'body',
                testID: 'session-list-filter-modal',
                dimensions: { size: 'md', width: 440, maxHeightRatio: 0.9 },
            },
            onRequestClose: () => {
                if (modalIdRef.current === modalId) modalIdRef.current = null;
            },
        });
        modalIdRef.current = modalId;
    }, [props.editor, usePopoverHost]);

    const trigger = (
        <Pressable
            ref={anchorRef}
            testID="session-list-filter-trigger"
            accessibilityRole="button"
            accessibilityLabel={props.label}
            accessibilityState={{ expanded: usePopoverHost ? popoverOpen : undefined, selected: props.active }}
            onPress={open}
            style={({ pressed }) => [
                styles.trigger,
                props.active ? styles.triggerActive : null,
                pressed ? styles.triggerPressed : null,
            ]}
        >
            <Icon
                name="funnel-simple"
                size={16}
                color={props.active ? theme.colors.accent.blue : theme.colors.text.secondary}
            />
            {usePopoverHost ? (
                <Text numberOfLines={1} style={styles.triggerLabel}>{props.label}</Text>
            ) : null}
            {usePopoverHost ? (
                <Icon name="caret-down" size={12} color={theme.colors.text.secondary} />
            ) : null}
        </Pressable>
    );

    if (!usePopoverHost) return trigger;
    return (
        <>
            {trigger}
            <Popover
                open={popoverOpen}
                anchorRef={anchorRef}
                placement="bottom"
                gap={6}
                maxWidthCap={420}
                maxHeightCap={560}
                autoFocusOnOpen
                onRequestClose={() => setPopoverOpen(false)}
                closeOnAnchorPress
                backdrop={false}
                containerStyle={{ paddingHorizontal: 0 }}
            >
                {({ maxHeight }) => (
                    <SessionListFilterEditor
                        {...props.editor}
                        maxHeight={maxHeight}
                    />
                )}
            </Popover>
        </>
    );
});
