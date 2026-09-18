import { afterEach, describe, expect, it, vi } from 'vitest';

const shareMock = vi.hoisted(() => vi.fn());
const dismissedActionMock = vi.hoisted(() => ({ current: 'dismissedAction' as string | undefined }));
const shareExportMock = vi.hoisted(() => ({ current: true }));
const platformOsMock = vi.hoisted(() => ({ current: 'ios' as 'ios' | 'android' | 'web' }));

vi.mock('react-native', () => ({
    get Platform() {
        return { OS: platformOsMock.current };
    },
    get Share() {
        return shareExportMock.current
            ? { share: shareMock, dismissedAction: dismissedActionMock.current }
            : undefined;
    },
}));

const { isTextSharingAvailable, shareTextSafe } = await import('./shareText');

function setWebShare(implementation: ((data: { text?: string }) => Promise<void>) | null): void {
    const navigator = (globalThis as { navigator?: Record<string, unknown> }).navigator;
    if (!navigator) {
        (globalThis as { navigator?: unknown }).navigator = implementation ? { share: implementation } : {};
        return;
    }
    if (implementation) navigator.share = implementation;
    else delete navigator.share;
}

afterEach(() => {
    shareMock.mockReset();
    shareExportMock.current = true;
    dismissedActionMock.current = 'dismissedAction';
    platformOsMock.current = 'ios';
    setWebShare(null);
    vi.clearAllMocks();
});

describe('shareTextSafe', () => {
    it('hands the exact text to the Web Share API when the platform has one', async () => {
        const webShare = vi.fn(async () => {});
        setWebShare(webShare);

        expect(isTextSharingAvailable()).toBe(true);
        await expect(shareTextSafe('https://home.example/join/token')).resolves.toBe('shared');
        // The link is shared as text, never written to a file: a file-based
        // share would persist a bearer outside the process.
        expect(webShare).toHaveBeenCalledWith({ text: 'https://home.example/join/token' });
        expect(shareMock).not.toHaveBeenCalled();
    });

    it('reports a cancelled Web Share as dismissed rather than a failure', async () => {
        setWebShare(vi.fn(async () => { throw new Error('AbortError'); }));

        await expect(shareTextSafe('https://home.example/join/token')).resolves.toBe('dismissed');
    });

    it('falls back to the native sheet and distinguishes dismissal from sharing', async () => {
        shareMock.mockResolvedValueOnce({ action: 'sharedAction' });
        await expect(shareTextSafe('link')).resolves.toBe('shared');
        expect(shareMock).toHaveBeenCalledWith({ message: 'link' });

        shareMock.mockResolvedValueOnce({ action: 'dismissedAction' });
        await expect(shareTextSafe('link')).resolves.toBe('dismissed');
    });

    it('says sharing is unavailable instead of offering a control that does nothing', async () => {
        shareExportMock.current = false;

        expect(isTextSharingAvailable()).toBe(false);
        await expect(shareTextSafe('link')).resolves.toBe('unavailable');
    });

    it('does not trust the web Share export a browser cannot honour', async () => {
        // React Native for Web exports `Share.share` on every browser and simply
        // rejects where there is no Web Share API. Trusting it would put a Share
        // control on desktop web that silently does nothing.
        platformOsMock.current = 'web';
        shareExportMock.current = true;

        expect(isTextSharingAvailable()).toBe(false);
        await expect(shareTextSafe('link')).resolves.toBe('unavailable');
        expect(shareMock).not.toHaveBeenCalled();
    });
});
