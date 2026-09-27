/** @vitest-environment jsdom */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installFormsCommonModuleMocks } from './formsTestHelpers';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installFormsCommonModuleMocks({ reactNative: async () => await vi.importActual('react-native-web') });

// The app `TextInput` only adds font scaling from local settings (a storage boundary); the host
// react-native-web input underneath is the behaviour under test.
vi.mock('@/components/ui/text/Text', async () => {
    const rnw = await vi.importActual<typeof import('react-native-web')>('react-native-web');
    return { Text: rnw.Text, TextInput: rnw.TextInput };
});

const { FieldTextInput } = await import('./FieldTextInput');

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
    await act(async () => { root?.unmount(); });
    container?.remove();
    root = null;
    container = null;
});

async function renderField(element: React.ReactElement): Promise<HTMLInputElement | HTMLTextAreaElement> {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(element); });
    const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="field"]');
    if (!input) throw new Error('Missing field input');
    return input;
}

async function pressReturn(input: HTMLElement): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => {
        input.dispatchEvent(event);
        // react-native-web blurs on the next task.
        await new Promise((resolve) => setTimeout(resolve, 5));
    });
    return event;
}

describe('FieldTextInput Return key', () => {
    it('inserts a newline in a multiline field and keeps focus', async () => {
        const input = await renderField(
            <FieldTextInput testID="field" value="first line" onChangeText={() => {}} accessibilityLabel="Notes" multiline />,
        );
        expect(input.tagName).toBe('TEXTAREA');
        await act(async () => { input.focus(); });

        const event = await pressReturn(input);

        expect(event.defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(input);
    });

    it('submits and leaves a single-line field', async () => {
        const onSubmitEditing = vi.fn();
        const single = await renderField(
            <FieldTextInput testID="field" value="value" onChangeText={() => {}} accessibilityLabel="Name" />,
        );
        await act(async () => { single.focus(); });
        await pressReturn(single);
        expect(document.activeElement).not.toBe(single);

        await act(async () => { root?.unmount(); });
        container?.remove();
        const submitting = await renderField(
            <FieldTextInput testID="field" value="value" onChangeText={() => {}} accessibilityLabel="Name" onSubmitEditing={onSubmitEditing} />,
        );
        await act(async () => { submitting.focus(); });
        const event = await pressReturn(submitting);
        expect(onSubmitEditing).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });
});
