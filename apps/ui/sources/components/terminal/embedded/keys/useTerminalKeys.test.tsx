import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';

import { TERMINAL_RAIL_KEYS } from './terminalKeyInput';
import { useTerminalKeys } from './useTerminalKeys';

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock();
});

const key = (id: string) => TERMINAL_RAIL_KEYS.find((item) => item.id === id)!;

describe('terminal keys', () => {
    afterEach(standardCleanup);

    it('latches Ctrl for exactly the next key, from the soft keyboard or the rail', async () => {
        const sent: string[] = [];
        const hook = await renderHook(() => useTerminalKeys({ onInput: (data) => sent.push(data), focusRenderer: () => undefined }));

        await act(async () => hook.getCurrent().pressRailKey(key('ctrl')));
        expect(hook.getCurrent().modifiers.ctrl).toBe(true);
        await act(async () => hook.getCurrent().onInput('c'));
        await act(async () => hook.getCurrent().onInput('c'));
        expect(sent).toEqual(['\u0003', 'c']);
        expect(hook.getCurrent().modifiers.ctrl).toBe(false);

        await act(async () => hook.getCurrent().pressRailKey(key('alt')));
        await act(async () => hook.getCurrent().pressArrow('left'));
        await act(async () => hook.getCurrent().pressRailKey(key('esc')));
        expect(sent.slice(2)).toEqual(['\u001b[1;3D', '\u001b']);
    });

    it('a second press on a latched modifier releases it without sending anything', async () => {
        const sent: string[] = [];
        const hook = await renderHook(() => useTerminalKeys({ onInput: (data) => sent.push(data), focusRenderer: () => undefined }));
        await act(async () => hook.getCurrent().pressRailKey(key('ctrl')));
        await act(async () => hook.getCurrent().pressRailKey(key('ctrl')));
        await act(async () => hook.getCurrent().pressRailKey(key('tab')));
        expect(sent).toEqual(['\t']);
    });
});
