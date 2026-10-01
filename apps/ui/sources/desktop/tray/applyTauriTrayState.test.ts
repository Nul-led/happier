import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeDesktopHost = vi.hoisted(() => vi.fn(async (_command: string, _args?: unknown): Promise<unknown> => null));

vi.mock('@/utils/platform/desktopHost', () => ({
    invokeDesktopHost,
}));

describe('applyTauriTrayState', () => {
    beforeEach(() => {
        invokeDesktopHost.mockClear();
    });

    it('passes the tray state under the state key expected by the native command', async () => {
        const { applyTauriTrayState } = await import('./applyTauriTrayState');

        const state = {
            status: 'healthy',
            label: 'Connected',
            detail: '3 machines online',
        } as const;

        await expect(applyTauriTrayState(state as never)).resolves.toBeNull();

        expect(invokeDesktopHost).toHaveBeenCalledWith('desktop_set_tray_state', { state });
    });

    it('returns the screen a tray item asked for while the window was rebuilt, and nothing else', async () => {
        const { applyTauriTrayState } = await import('./applyTauriTrayState');
        invokeDesktopHost.mockResolvedValueOnce('settings');
        await expect(applyTauriTrayState({} as never)).resolves.toBe('settings');
        invokeDesktopHost.mockResolvedValueOnce('somewhere-else');
        await expect(applyTauriTrayState({} as never)).resolves.toBeNull();
    });
});
