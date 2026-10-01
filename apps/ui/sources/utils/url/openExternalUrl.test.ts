import { describe, expect, it, vi } from 'vitest';

const openUrlSpy = vi.fn(async (_url: string) => {});
const tauriInvokeSpy = vi.fn(async (_command: string, _args?: Record<string, unknown>) => {});
const tauriState = vi.hoisted(() => ({ host: null as 'tauri' | 'electron' | null }));

vi.mock('@/utils/platform/desktopHost', () => ({
  desktopHostKind: () => tauriState.host,
  invokeDesktopHost: (...args: [string, Record<string, unknown>?]) => tauriInvokeSpy(...args),
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock(
        {
                    Platform: {
                        OS: 'ios',
                    },
                    Linking: {
                        openURL: openUrlSpy,
                    },
                }
    );
});

describe('openExternalUrl', () => {
  it('opens web links with the system browser on Tauri desktop', async () => {
    tauriState.host = 'tauri';
    tauriInvokeSpy.mockClear();
    const { openExternalUrl } = await import('./openExternalUrl');
    try {
      await expect(openExternalUrl('https://example.com', { platformOS: 'web' })).resolves.toBe(true);
      expect(tauriInvokeSpy).toHaveBeenCalledWith('plugin:opener|open_url', { url: 'https://example.com' });
    } finally {
      tauriState.host = null;
    }
  });
  it('reports a desktop opener failure instead of falling back to the webview', async () => {
    tauriState.host = 'tauri';
    tauriInvokeSpy.mockImplementationOnce(async () => { throw new Error('opener unavailable'); });
    const report = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { openExternalUrl } = await import('./openExternalUrl');
    try {
      await expect(openExternalUrl('https://example.com', { platformOS: 'web' })).resolves.toBe(false);
      expect(report).toHaveBeenCalledOnce();
    } finally {
      report.mockRestore();
      tauriState.host = null;
    }
  });
  it('uses Linking.openURL on native', async () => {
    openUrlSpy.mockClear();
    const { openExternalUrl } = await import('./openExternalUrl');
    await openExternalUrl('https://example.com');
    expect(openUrlSpy).toHaveBeenCalledWith('https://example.com');
  });

  it('uses window.open on web when available', async () => {
    openUrlSpy.mockClear();
    const { openExternalUrl } = await import('./openExternalUrl');
    const prev = (globalThis as any).open;
    const openSpy = vi.fn();
    (globalThis as any).open = openSpy;
    try {
      await openExternalUrl('https://example.com', { platformOS: 'web' });
      expect(openSpy).toHaveBeenCalled();
      expect(openUrlSpy).not.toHaveBeenCalled();
    } finally {
      (globalThis as any).open = prev;
    }
  });

  it('keeps Electron on its existing window.open path', async () => {
    tauriState.host = 'electron';
    tauriInvokeSpy.mockClear();
    const { openExternalUrl } = await import('./openExternalUrl');
    const previousOpen = (globalThis as { open?: unknown }).open;
    const openSpy = vi.fn();
    (globalThis as { open?: unknown }).open = openSpy;
    try {
      await expect(openExternalUrl('https://example.com', { platformOS: 'web' })).resolves.toBe(true);
      expect(openSpy).toHaveBeenCalledOnce();
      expect(tauriInvokeSpy).not.toHaveBeenCalled();
    } finally {
      tauriState.host = null;
      (globalThis as { open?: unknown }).open = previousOpen;
    }
  });
});
