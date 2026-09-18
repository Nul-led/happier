import { beforeEach, describe, expect, it, vi } from 'vitest';

const { show } = vi.hoisted(() => ({ show: vi.fn() }));

vi.mock('@/modal', () => ({ Modal: { show } }));
vi.mock('./SessionFollowDestinationPickerModal', () => ({
    SessionFollowDestinationPickerModal: function SessionFollowDestinationPickerModalStub() { return null; },
}));

describe('Session Follow picker entry points', () => {
    beforeEach(() => show.mockReset());

    it('preserves the qualified source and focus-return target for the header shortcut', async () => {
        const focusReturnRef = { current: { focus: vi.fn() } };
        const { openSessionFollowDestinationPicker } = await import('./openSessionFollowDestinationPicker');
        openSessionFollowDestinationPicker({ serverId: 'home-a', sessionId: 'source' }, focusReturnRef);

        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            props: { source: { serverId: 'home-a', sessionId: 'source' } },
            focusReturnRef,
        }));
    });

    it('preserves the qualified destination and focus-return target for the editor entry', async () => {
        const focusReturnRef = { current: { focus: vi.fn() } };
        const onChanged = vi.fn();
        const { openSessionFollowSourcePicker } = await import('./openSessionFollowDestinationPicker');
        openSessionFollowSourcePicker({ serverId: 'home-b', sessionId: 'destination' }, focusReturnRef, onChanged);

        expect(show).toHaveBeenCalledWith(expect.objectContaining({
            props: { destination: { serverId: 'home-b', sessionId: 'destination' }, onChanged },
            focusReturnRef,
        }));
    });
});
