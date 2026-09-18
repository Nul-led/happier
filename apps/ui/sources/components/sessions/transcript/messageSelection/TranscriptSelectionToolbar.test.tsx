import * as React from 'react';
import { Platform } from 'react-native';
import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { resolveMinimumInteractiveTargetSize } from '@/components/ui/interactiveTargetSize';

import { TranscriptMessageSelectionProvider, useTranscriptSelectionActions } from './TranscriptMessageSelectionContext';
import { TranscriptSelectionToolbar } from './TranscriptSelectionToolbar';

const keyboardShortcutHandlersMock = vi.hoisted(() => vi.fn());
const setClipboardStringSafeMock = vi.fn(async (_value: string) => true);

vi.mock('@/keyboard/KeyboardShortcutProvider', () => ({
    useKeyboardShortcutHandlers: (handlers: Record<string, () => void>) => {
        keyboardShortcutHandlersMock(handlers);
        return true;
    },
}));

vi.mock('@/utils/ui/clipboard', () => ({
    setClipboardStringSafe: (value: string) => setClipboardStringSafeMock(value),
}));

vi.mock('@/modal', () => ({
    Modal: { alert: vi.fn() },
}));

function ToolbarHarness(props: {
    sendEnabled?: boolean;
    onSend?: () => void;
    maxWidth?: number;
    formatSelection?: (messages: ReadonlyArray<{ id: string }>) => string | null;
    selectionUnavailableText?: string;
    additionalAction?: React.ComponentProps<typeof TranscriptSelectionToolbar>['additionalAction'];
}) {
    const actions = useTranscriptSelectionActions();
    return (
        <>
            <ProbeButton testID="enter-a" onPress={() => actions.enter('a')} />
            <ProbeButton testID="toggle-b" onPress={() => actions.toggle('b')} />
            <TranscriptSelectionToolbar
                selectableMessagesInOrder={[
                    { id: 'a', role: 'user', text: 'Hello' },
                    { id: 'b', role: 'assistant', text: 'Hi there' },
                ]}
                bulkCopyFormat="markdown_labeled"
                roleLabels={{ user: 'You', assistant: 'Assistant' }}
                sendToSessionEnabled={props.sendEnabled === true}
                onSendToSession={props.onSend}
                formatSelection={props.formatSelection}
                selectionUnavailableText={props.selectionUnavailableText}
                additionalAction={props.additionalAction}
                maxWidth={props.maxWidth}
            />
        </>
    );
}

function ProbeButton(props: { testID: string; onPress: () => void }) {
    return React.createElement('ProbeButton', props);
}

function findPressableByTestId(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string) {
    return screen.find((node) => (node.type as unknown) === 'Pressable' && node.props?.testID === testID && typeof node.props?.onPress === 'function');
}

function findAllPressablesByTestId(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string) {
    return screen.findAll((node) => (node.type as unknown) === 'Pressable' && node.props?.testID === testID && typeof node.props?.onPress === 'function');
}

async function pressByTestId(screen: Awaited<ReturnType<typeof renderScreen>>, testID: string): Promise<void> {
    const target = screen.find((node) => node.props?.testID === testID && typeof node.props?.onPress === 'function');
    await act(async () => {
        await target.props.onPress();
    });
}

async function renderToolbar(props: React.ComponentProps<typeof ToolbarHarness> = {}) {
    keyboardShortcutHandlersMock.mockClear();
    setClipboardStringSafeMock.mockClear();
    return renderScreen(
        <TranscriptMessageSelectionProvider sessionId="s1" eligibleMessageIdsInOrder={['a', 'b']}>
            <ToolbarHarness {...props} />
        </TranscriptMessageSelectionProvider>,
    );
}

describe('TranscriptSelectionToolbar', () => {
    it('is hidden when selection mode is inactive', async () => {
        const screen = await renderToolbar();

        expect(screen.findAllByTestId('transcript-selection-toolbar')).toHaveLength(0);
    });

    it('shows count, copy, select all, and cancel actions in selection mode', async () => {
        const screen = await renderToolbar();

        await pressByTestId(screen, 'enter-a');

        const countNode = screen.findByTestId('transcript-selection-toolbar-count');
        expect(countNode).not.toBeNull();
        expect(countNode!.props.children).toBe('1 message selected');
        expect(findAllPressablesByTestId(screen, 'transcript-selection-copy')).toHaveLength(1);
        expect(findAllPressablesByTestId(screen, 'transcript-selection-select-all')).toHaveLength(1);
        expect(findAllPressablesByTestId(screen, 'transcript-selection-cancel')).toHaveLength(1);
    });

    it('constrains itself to the transcript content width when a max width is provided', async () => {
        const screen = await renderToolbar({ maxWidth: 640 });

        await pressByTestId(screen, 'enter-a');

        const toolbar = screen.findByTestId('transcript-selection-toolbar');
        expect(toolbar?.props.style).toContainEqual({ width: '100%', maxWidth: 640, alignSelf: 'center' });
    });

    it('keeps every selection action reachable at a narrow width with long text and accessible targets', async () => {
        const screen = await renderToolbar({
            maxWidth: 320,
            sendEnabled: true,
            onSend: vi.fn(),
            additionalAction: {
                testID: 'discussion-selection-ask-agent',
                label: 'Ask an Agent about the selected conversation messages',
                onPress: vi.fn(),
            },
        });

        await pressByTestId(screen, 'enter-a');

        const toolbar = screen.findByTestId('transcript-selection-toolbar');
        const actions = screen.findByTestId('transcript-selection-toolbar-actions');
        expect(toolbar?.props.style).toEqual(expect.arrayContaining([
            expect.objectContaining({ flexWrap: 'wrap' }),
            { width: '100%', maxWidth: 320, alignSelf: 'center' },
        ]));
        expect(actions?.props.style).toEqual(expect.objectContaining({ flexWrap: 'wrap' }));

        const minimumTarget = resolveMinimumInteractiveTargetSize(Platform.OS);
        for (const testID of [
            'transcript-selection-copy',
            'transcript-selection-send',
            'discussion-selection-ask-agent',
            'transcript-selection-select-all',
            'transcript-selection-cancel',
        ]) {
            const action = findPressableByTestId(screen, testID);
            const resolvedStyle = action.props.style({ pressed: false });
            expect(resolvedStyle).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    flexShrink: 1,
                    maxWidth: '100%',
                    minHeight: minimumTarget,
                    minWidth: minimumTarget,
                }),
            ]));
        }
    });

    it('hides Send when send-to-session is disabled and shows it when enabled', async () => {
        const disabled = await renderToolbar({ sendEnabled: false });
        await pressByTestId(disabled, 'enter-a');
        expect(findAllPressablesByTestId(disabled, 'transcript-selection-send')).toHaveLength(0);

        const enabled = await renderToolbar({ sendEnabled: true, onSend: vi.fn() });
        await pressByTestId(enabled, 'enter-a');
        expect(findAllPressablesByTestId(enabled, 'transcript-selection-send')).toHaveLength(1);
    });

    it('copies selected messages in canonical order and exits only when canceled', async () => {
        const screen = await renderToolbar();

        await pressByTestId(screen, 'enter-a');
        await pressByTestId(screen, 'toggle-b');
        await pressByTestId(screen, 'transcript-selection-copy');

        expect(setClipboardStringSafeMock).toHaveBeenCalledWith('**You:**\n\nHello\n\n**Assistant:**\n\nHi there');
        const feedbackNode = screen.findByTestId('transcript-selection-copy-feedback');
        expect(feedbackNode).not.toBeNull();
        expect(feedbackNode!.props.children).toBe('Copied');
        const countNode = screen.findByTestId('transcript-selection-toolbar-count');
        expect(countNode).not.toBeNull();
        expect(countNode!.props.children).toBe('2 messages selected');

        await pressByTestId(screen, 'transcript-selection-cancel');
        expect(screen.findAllByTestId('transcript-selection-toolbar')).toHaveLength(0);
    });

    it('registers central keyboard shortcuts for active selection actions', async () => {
        const screen = await renderToolbar();

        await pressByTestId(screen, 'enter-a');
        const handlers = keyboardShortcutHandlersMock.mock.calls.at(-1)?.[0] as Record<string, () => void> | undefined;

        expect(Object.keys(handlers ?? {}).sort()).toEqual([
            'transcript.selection.cancel',
            'transcript.selection.copy',
            'transcript.selection.selectAll',
        ]);

        await act(async () => {
            await handlers?.['transcript.selection.copy']?.();
        });
        expect(setClipboardStringSafeMock).toHaveBeenCalledWith('**You:**\n\nHello');
    });

    it('invokes Send when enabled and selection is non-empty', async () => {
        const onSend = vi.fn();
        const screen = await renderToolbar({ sendEnabled: true, onSend });

        await pressByTestId(screen, 'enter-a');
        await pressByTestId(screen, 'transcript-selection-send');

        expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('uses one caller-supplied canonical selection formatter for Copy', async () => {
        const formatSelection = vi.fn(() => '**Alice:**\n\nSelected discussion row');
        const screen = await renderToolbar({ formatSelection });

        await pressByTestId(screen, 'enter-a');
        await pressByTestId(screen, 'transcript-selection-copy');

        expect(formatSelection).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
        expect(setClipboardStringSafeMock).toHaveBeenCalledWith('**Alice:**\n\nSelected discussion row');
    });

    it('mounts one canonical additional selection action with the selected rows', async () => {
        const onPress = vi.fn();
        const screen = await renderToolbar({
            additionalAction: {
                testID: 'discussion-selection-ask-agent',
                label: 'Ask Agent',
                onPress,
            },
        });

        await pressByTestId(screen, 'enter-a');
        await pressByTestId(screen, 'discussion-selection-ask-agent');

        expect(onPress).toHaveBeenCalledWith([expect.objectContaining({ id: 'a' })]);
    });

    it('keeps selection visible but disables outward actions when canonical formatting is unavailable', async () => {
        const onPress = vi.fn();
        const screen = await renderToolbar({
            formatSelection: () => null,
            selectionUnavailableText: 'Selected message identity unavailable',
            sendEnabled: true,
            onSend: vi.fn(),
            additionalAction: { testID: 'discussion-selection-ask-agent', label: 'Ask Agent', onPress },
        });

        await pressByTestId(screen, 'enter-a');

        expect(screen.findByTestId('transcript-selection-unavailable')?.props.children)
            .toBe('Selected message identity unavailable');
        expect(findPressableByTestId(screen, 'transcript-selection-copy').props.disabled).toBe(true);
        expect(findPressableByTestId(screen, 'transcript-selection-send').props.disabled).toBe(true);
        expect(findPressableByTestId(screen, 'discussion-selection-ask-agent').props.disabled).toBe(true);
    });
});
