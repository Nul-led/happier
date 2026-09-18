import { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';
import { readPresentationNotice, retirePresentationNotice } from '@/components/sessions/presentation/presentationNotices';

import { useSessionBoardHostActionBindings } from './useSessionBoardHostActionBindings';

describe('useSessionBoardHostActionBindings', () => {
    it('binds declared Actions to the exact reachable editable Session and presents typed refusal', async () => {
        retirePresentationNotice();
        const execute = vi.fn(async () => ({ ok: false as const, errorCode: 'action_disabled', error: 'Disabled here' }));
        const hook = await renderHook(() => useSessionBoardHostActionBindings({
            serverId: 'server-a',
            sessionId: 'session-a',
            enabled: true,
            execute,
        }));

        const binding = hook.getCurrent()('item-a');
        expect(binding.enabled).toBe(true);
        await act(async () => {
            binding.invoke({ actionId: 'session.stop', input: { reason: 'done' } });
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(execute).toHaveBeenCalledWith('session.stop', { reason: 'done' }, {
            serverId: 'server-a',
            defaultSessionId: 'session-a',
            surface: 'ui',
        });
        expect(readPresentationNotice()).toMatchObject({ severity: 'error', message: 'Disabled here' });
        await hook.unmount();
    });

    it('keeps Actions disabled offline and maps transport failure to the Board offline notice', async () => {
        retirePresentationNotice();
        const offline = await renderHook(() => useSessionBoardHostActionBindings({
            serverId: 'server-a',
            sessionId: 'session-a',
            enabled: false,
            execute: vi.fn(),
        }));
        expect(offline.getCurrent()('item-a').enabled).toBe(false);
        await offline.unmount();

        const reachable = await renderHook(() => useSessionBoardHostActionBindings({
            serverId: 'server-a',
            sessionId: 'session-a',
            enabled: true,
            execute: vi.fn(async () => { throw new Error('offline'); }),
        }));
        await act(async () => {
            reachable.getCurrent()('item-a').invoke({ actionId: 'session.stop' });
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(readPresentationNotice()).toMatchObject({ severity: 'error' });
        expect(readPresentationNotice()?.message).toBeTruthy();
        await reachable.unmount();
    });

    it('keeps action notice identity distinct for delimiter-colliding Session and item tuples', async () => {
        retirePresentationNotice();
        const execute = vi.fn(async () => ({ ok: false as const, errorCode: 'action_disabled', error: 'Disabled here' }));
        const first = await renderHook(() => useSessionBoardHostActionBindings({
            serverId: 'home:a',
            sessionId: 'session',
            enabled: true,
            execute,
        }));
        const second = await renderHook(() => useSessionBoardHostActionBindings({
            serverId: 'home',
            sessionId: 'a:session',
            enabled: true,
            execute,
        }));

        await act(async () => {
            first.getCurrent()('item:one').invoke({ actionId: 'session.stop' });
            await Promise.resolve();
            await Promise.resolve();
        });
        const firstKey = readPresentationNotice()?.key;

        await act(async () => {
            second.getCurrent()('item:one').invoke({ actionId: 'session.stop' });
            await Promise.resolve();
            await Promise.resolve();
        });
        const secondKey = readPresentationNotice()?.key;

        expect(firstKey).toBe(JSON.stringify(['session-board-action', '["home:a","session"]', 'item:one', 'session.stop']));
        expect(secondKey).toBe(JSON.stringify(['session-board-action', '["home","a:session"]', 'item:one', 'session.stop']));
        expect(secondKey).not.toBe(firstKey);
        await first.unmount();
        await second.unmount();
    });
});
