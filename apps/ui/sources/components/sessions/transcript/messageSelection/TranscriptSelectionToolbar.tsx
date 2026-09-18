import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';
import { useKeyboardShortcutHandlers } from '@/keyboard/KeyboardShortcutProvider';
import type { KeyboardShortcutHandlers } from '@/keyboard/runtime';
import { Modal } from '@/modal';
import { t } from '@/text';
import { setClipboardStringSafe } from '@/utils/ui/clipboard';

import type { TranscriptBulkCopyFormat, TranscriptSelectableMessageText } from './_types';
import { formatSelectedMessagesForClipboard } from './formatSelectedMessagesForClipboard';
import { useTranscriptSelectionActions, useTranscriptSelectionState } from './TranscriptMessageSelectionContext';

export type TranscriptSelectionToolbarMessage = TranscriptSelectableMessageText & Readonly<{ id: string }>;

const TRANSCRIPT_SELECTION_COPY_FEEDBACK_MS = 1200;
const MINIMUM_INTERACTIVE_TARGET_SIZE = resolveMinimumInteractiveTargetSize(Platform.OS);

export function TranscriptSelectionToolbar(props: Readonly<{
    selectableMessagesInOrder: ReadonlyArray<TranscriptSelectionToolbarMessage>;
    bulkCopyFormat: TranscriptBulkCopyFormat;
    roleLabels: Readonly<{ user: string; assistant: string }>;
    sendToSessionEnabled: boolean;
    maxWidth?: number;
    /** Allows another canonical message owner to supply the same neutral selection text. */
    formatSelection?: (messages: ReadonlyArray<TranscriptSelectionToolbarMessage>) => string | null;
    selectionUnavailableText?: string;
    additionalAction?: Readonly<{
        testID: string;
        label: string;
        accessibilityLabel?: string;
        onPress: (messages: ReadonlyArray<TranscriptSelectionToolbarMessage>) => void | Promise<void>;
    }>;
    onSendToSession?: (messages: ReadonlyArray<TranscriptSelectionToolbarMessage>) => void | Promise<void>;
}>): React.ReactElement | null {
    const { theme } = useUnistyles();
    const state = useTranscriptSelectionState();
    const actions = useTranscriptSelectionActions();
    const [busyAction, setBusyAction] = React.useState<'copy' | 'send' | 'additional' | null>(null);
    const [copySucceeded, setCopySucceeded] = React.useState(false);
    const copyFeedbackTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => () => {
        if (copyFeedbackTimerRef.current) {
            clearTimeout(copyFeedbackTimerRef.current);
        }
    }, []);

    const selectedMessages = React.useMemo(
        () => props.selectableMessagesInOrder.filter((message) => state.selectedIds.has(message.id)),
        [props.selectableMessagesInOrder, state.selectedIds],
    );
    const formattedSelection = React.useMemo(() => {
        if (selectedMessages.length === 0) return null;
        return props.formatSelection
            ? props.formatSelection(selectedMessages)
            : formatSelectedMessagesForClipboard(selectedMessages, {
                format: props.bulkCopyFormat,
                roleLabels: props.roleLabels,
            });
    }, [props.bulkCopyFormat, props.formatSelection, props.roleLabels, selectedMessages]);
    const selectionUnavailable = selectedMessages.length > 0 && formattedSelection === null;

    const handleCopy = React.useCallback(async () => {
        if (formattedSelection === null || busyAction) return;
        setBusyAction('copy');
        try {
            const ok = await setClipboardStringSafe(formattedSelection);
            if (!ok) {
                Modal.alert(t('common.error'), t('transcript.selection.copyFailed'));
                return;
            }
            setCopySucceeded(true);
            if (copyFeedbackTimerRef.current) {
                clearTimeout(copyFeedbackTimerRef.current);
            }
            copyFeedbackTimerRef.current = setTimeout(() => {
                setCopySucceeded(false);
                copyFeedbackTimerRef.current = null;
            }, TRANSCRIPT_SELECTION_COPY_FEEDBACK_MS);
        } catch {
            Modal.alert(t('common.error'), t('transcript.selection.copyFailed'));
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, formattedSelection]);

    const handleAdditionalAction = React.useCallback(async () => {
        if (!props.additionalAction || selectedMessages.length === 0 || selectionUnavailable || busyAction) return;
        setBusyAction('additional');
        try {
            await props.additionalAction.onPress(selectedMessages);
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, props.additionalAction, selectedMessages, selectionUnavailable]);

    const handleSend = React.useCallback(async () => {
        if (!props.onSendToSession || selectedMessages.length === 0 || selectionUnavailable || busyAction) return;
        setBusyAction('send');
        try {
            await props.onSendToSession(selectedMessages);
        } finally {
            setBusyAction(null);
        }
    }, [busyAction, props.onSendToSession, selectedMessages, selectionUnavailable]);

    const shortcutHandlers = React.useMemo<KeyboardShortcutHandlers>(() => {
        if (!state.isSelectionMode) return {};
        const handlers: KeyboardShortcutHandlers = {
            'transcript.selection.cancel': actions.exit,
            'transcript.selection.copy': () => { void handleCopy(); },
            'transcript.selection.selectAll': () => actions.selectAll(props.selectableMessagesInOrder.map((message) => message.id)),
        };
        if (props.sendToSessionEnabled && props.onSendToSession) {
            handlers['transcript.selection.sendToSession'] = () => { void handleSend(); };
        }
        return handlers;
    }, [actions, handleCopy, handleSend, props.onSendToSession, props.selectableMessagesInOrder, props.sendToSessionEnabled, state.isSelectionMode]);
    useKeyboardShortcutHandlers(shortcutHandlers);

    if (!state.isSelectionMode) return null;

    return (
        <View
            testID="transcript-selection-toolbar"
            accessibilityLiveRegion="polite"
            style={[
                styles.container,
                typeof props.maxWidth === 'number' && Number.isFinite(props.maxWidth) ? { width: '100%' as const, maxWidth: props.maxWidth, alignSelf: 'center' as const } : null,
                { borderColor: theme.colors.border.default },
            ]}
        >
            <View style={styles.statusTextGroup}>
                <Text testID="transcript-selection-toolbar-count" style={styles.countText}>
                    {t('transcript.selection.selectedCount', { count: state.count })}
                </Text>
                {copySucceeded ? (
                    <Text testID="transcript-selection-copy-feedback" style={styles.feedbackText}>
                        {t('transcript.selection.copySuccess')}
                    </Text>
                ) : null}
                {selectionUnavailable && props.selectionUnavailableText ? (
                    <Text testID="transcript-selection-unavailable" style={styles.feedbackText}>
                        {props.selectionUnavailableText}
                    </Text>
                ) : null}
            </View>
            <View testID="transcript-selection-toolbar-actions" style={styles.actions}>
                <ToolbarButton
                    testID="transcript-selection-copy"
                    label={t('transcript.selection.copy')}
                    accessibilityLabel={t('transcript.selection.copyA11y', { count: state.count })}
                    disabled={selectedMessages.length === 0 || selectionUnavailable || busyAction != null}
                    onPress={handleCopy}
                />
                {props.sendToSessionEnabled && props.onSendToSession ? (
                    <ToolbarButton
                        testID="transcript-selection-send"
                        label={t('transcript.selection.send')}
                        accessibilityLabel={t('transcript.selection.sendA11y', { count: state.count })}
                        disabled={selectedMessages.length === 0 || selectionUnavailable || busyAction != null}
                        onPress={handleSend}
                    />
                ) : null}
                {props.additionalAction ? (
                    <ToolbarButton
                        testID={props.additionalAction.testID}
                        label={props.additionalAction.label}
                        accessibilityLabel={props.additionalAction.accessibilityLabel}
                        disabled={selectedMessages.length === 0 || selectionUnavailable || busyAction != null}
                        onPress={handleAdditionalAction}
                    />
                ) : null}
                <ToolbarButton
                    testID="transcript-selection-select-all"
                    label={t('transcript.selection.selectAll')}
                    onPress={() => actions.selectAll(props.selectableMessagesInOrder.map((message) => message.id))}
                />
                <ToolbarButton
                    testID="transcript-selection-cancel"
                    label={t('transcript.selection.cancel')}
                    accessibilityLabel={t('transcript.selection.exitA11y')}
                    onPress={actions.exit}
                />
            </View>
        </View>
    );
}

function ToolbarButton(props: Readonly<{
    testID: string;
    label: string;
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress: () => void | Promise<void>;
}>): React.ReactElement {
    return (
        <Pressable
            testID={props.testID}
            accessibilityRole="button"
            accessibilityLabel={props.accessibilityLabel ?? props.label}
            accessibilityState={props.disabled ? { disabled: true } : undefined}
            disabled={props.disabled}
            onPress={props.onPress}
            style={({ pressed }) => [styles.actionButton, pressed ? styles.actionButtonPressed : null, props.disabled ? styles.actionButtonDisabled : null]}
        >
            <Text style={styles.actionButtonText}>{props.label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: theme.colors.surface.elevated,
    },
    statusTextGroup: {
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
        gap: 2,
    },
    countText: {
        color: theme.colors.text.secondary,
    },
    feedbackText: {
        color: theme.colors.state.success.foreground,
    },
    actions: {
        flexGrow: 1,
        flexShrink: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
    },
    actionButton: {
        flexShrink: 1,
        maxWidth: '100%',
        minHeight: MINIMUM_INTERACTIVE_TARGET_SIZE,
        minWidth: MINIMUM_INTERACTIVE_TARGET_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: theme.colors.button.secondary.background,
    },
    actionButtonPressed: {
        backgroundColor: theme.colors.state.neutral.background,
    },
    actionButtonDisabled: {
        opacity: 0.5,
    },
    actionButtonText: {
        flexShrink: 1,
        textAlign: 'center',
        color: theme.colors.button.secondary.tint,
    },
}));
