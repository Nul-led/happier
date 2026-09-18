import * as React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dictationControlIds: Array<string | undefined> = [];
const toggle = vi.hoisted(() => vi.fn(async () => ({ kind: 'completed', text: ' dictated' } as const)));

vi.mock('@/voice/dictation/useVoiceDictation', () => ({
    useVoiceDictation: (controlId: string | undefined) => {
        dictationControlIds.push(controlId);
        return {
            status: 'idle' as const,
            failure: null,
            dismissFailure: vi.fn(),
            toggle,
        };
    },
}));

vi.mock('@/components/ui/forms/MultiTextInput', async () => {
    const ReactModule = await import('react');
    return { MultiTextInput: ReactModule.forwardRef((props: Readonly<{
        value: string;
        onChangeText: (text: string) => void;
        onStateChange?: (state: { text: string; selection: { start: number; end: number } }) => void;
    }>, ref) => {
        ReactModule.useImperativeHandle(ref, () => ({
            setTextAndSelection: (text: string, selection: { start: number; end: number }) => {
                props.onChangeText(text);
                props.onStateChange?.({ text, selection });
            },
            focus: vi.fn(),
        }));
        return ReactModule.createElement('MultiTextInput', props);
    }),
    };
});

vi.mock('@/modal', () => ({ Modal: { alert: vi.fn() } }));
vi.mock('@/text', () => ({ t: (key: string) => key }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SessionAuthoringComposer', () => {
    beforeEach(() => {
        dictationControlIds.length = 0;
        toggle.mockReset();
        toggle.mockResolvedValue({ kind: 'completed', text: ' dictated' });
    });

    it('keys dictation to the exact workflow draft/block/instance and inserts at the live selection', async () => {
        const onChangeText = vi.fn();
        const { SessionAuthoringComposer } = await import('./SessionAuthoringComposer');
        let tree: ReturnType<typeof create>;
        await act(async () => {
            tree = create(
                <SessionAuthoringComposer
                    composerRef={{
                        kind: 'workflowAuthoring',
                        draftId: 'draft-1',
                        blockId: 'step-1',
                        instanceId: 'mounted-1',
                    }}
                    value="Review"
                    onChangeText={onChangeText}
                    dictationEnabled
                    renderDictationAccessory={(dictation) => React.createElement(
                        'DictationButton',
                        { onPress: dictation.onPress },
                    )}
                />,
            );
        });

        expect(dictationControlIds.at(-1)).toBe(
            '["workflowAuthoring","draft-1","step-1","mounted-1"]',
        );
        await act(async () => {
            tree!.root.findByType('MultiTextInput').props.onStateChange({
                text: 'Review',
                selection: { start: 2, end: 2 },
            });
        });
        await act(async () => {
            await tree!.root.findByType('DictationButton').props.onPress();
        });
        expect(onChangeText).toHaveBeenCalledWith('Re dictatedview');
        await act(async () => tree!.unmount());
    });

    it('does not deliver a completed transcription after the composer identity changes', async () => {
        let completeToggle: ((result: { kind: 'completed'; text: string }) => void) | undefined;
        toggle.mockImplementationOnce(() => new Promise((resolve) => {
            completeToggle = resolve;
        }));
        const onChangeText = vi.fn();
        const { SessionAuthoringComposer } = await import('./SessionAuthoringComposer');
        const renderComposer = (blockId: string) => (
            <SessionAuthoringComposer
                composerRef={{
                    kind: 'workflowAuthoring',
                    draftId: 'draft-1',
                    blockId,
                    instanceId: 'mounted-1',
                }}
                value="Review"
                onChangeText={onChangeText}
                dictationEnabled
                renderDictationAccessory={(dictation) => React.createElement(
                    'DictationButton',
                    { onPress: dictation.onPress },
                )}
            />
        );
        let tree: ReturnType<typeof create>;
        await act(async () => {
            tree = create(renderComposer('step-1'));
        });

        let pending!: Promise<void>;
        await act(async () => {
            pending = tree!.root.findByType('DictationButton').props.onPress();
        });
        await act(async () => {
            tree!.update(renderComposer('step-2'));
        });
        await act(async () => {
            completeToggle?.({ kind: 'completed', text: ' dictated' });
            await pending!;
        });

        expect(onChangeText).not.toHaveBeenCalled();
        await act(async () => tree!.unmount());
    });
});
