import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { FileBinaryState } from './FileScreenState';
import { Platform } from 'react-native';

const media = vi.hoisted(() => ({
    download: vi.fn(), cleanup: vi.fn(),
    focused: true,
    player: { pause: vi.fn(), status: 'loading', addListener: vi.fn(), staysActiveInBackground: true },
    statusListener: null as null | ((event: { status: string; error?: { message: string } }) => void),
}));
const appState = vi.hoisted(async () => {
    const { createReactNativeAppStateEmitter } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeAppStateEmitter('active');
});
vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ AppState: (await appState).appState });
});
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => media.focused }));
vi.mock('@/sync/domains/transfers/runtime/bulkTransferPipeline', () => ({ downloadDaemonSessionFileToDestination: media.download }));
vi.mock('expo-video', () => ({
    VideoView: 'VideoView',
    useVideoPlayer: (_source: unknown, setup?: (player: typeof media.player) => void) => {
        setup?.(media.player);
        return media.player;
    },
}));
vi.mock('expo-file-system', () => ({
    Paths: { cache: 'file:///cache' },
    Directory: class {
        readonly uri: string;
        constructor(...paths: Array<string | { uri: string }>) { this.uri = paths.map(path => typeof path === 'string' ? path : path.uri).join('/'); }
        create() {}
    },
    File: class {
        readonly uri: string;
        constructor(directory: { uri: string }, name: string) { this.uri = `${directory.uri}/${name}`; }
        create() {}
        open() { return { writeBytes: () => {}, close: () => {} }; }
        delete() { media.cleanup(this.uri); }
    },
}));

const theme = { colors: { surface: { base: 'base', inset: 'inset' }, border: { default: 'border' }, text: { secondary: 'secondary' } } };
const videoProps = { sessionId: 's1', videoMimeType: 'video/mp4', isActive: true };

type DownloadInput = {
    destination: { writeBytes: (bytes: Uint8Array) => Promise<void>; close: () => Promise<void> };
    onInit?: (init: { name: string; sizeBytes: number }) => Promise<unknown>;
    signal: AbortSignal;
};

describe('session video file preview', () => {
    beforeEach(async () => {
        Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
        // Resolve the lazy platform module before React's render/flush window.
        await import('@/components/sessions/files/content/FileVideoPreview');
        media.focused = true;
        media.statusListener = null;
        media.player.status = 'loading';
        media.player.addListener.mockImplementation((_event: string, listener: typeof media.statusListener) => {
            media.statusListener = listener;
            return { remove: vi.fn() };
        });
        media.download.mockImplementation(async (input: DownloadInput) => {
            await input.onInit?.({ name: 'demo.mp4', sizeBytes: 12_000_000 });
            await input.destination.writeBytes(new Uint8Array([1, 2, 3]));
            await input.destination.close();
            return { ok: true, name: 'demo.mp4', sizeBytes: 12_000_000 };
        });
        vi.stubGlobal('URL', { createObjectURL: () => 'blob:video-preview', revokeObjectURL: media.cleanup });
        (await appState).emit('active');
    });
    afterEach(() => { standardCleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

    it('loads a video over the text and image limits using chunk transfer and exposes playback loading, native controls and codec errors', async () => {
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        expect(screen.findAllByType('VideoView')[0].props.nativeControls).toBe(true);
        expect(screen.findAllHostsByTestId('file-video-loading')).toHaveLength(1);
        await act(async () => media.statusListener?.({ status: 'readyToPlay' }));
        expect(screen.findAllHostsByTestId('file-video-loading')).toHaveLength(0);
        await act(async () => media.statusListener?.({ status: 'error', error: { message: 'Unsupported codec' } }));
        expect(screen.findAllHostsByTestId('file-video-error')).toHaveLength(1);
    });

    it('pauses and releases the preview URL when its tab becomes inactive or the app backgrounds', async () => {
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        await act(async () => screen.tree.update(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} isActive={false} />));
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.player.pause).toHaveBeenCalled();
        expect(media.cleanup).toHaveBeenCalledWith('blob:video-preview');
        await act(async () => screen.tree.update(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />));
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        media.cleanup.mockClear();
        await act(async () => (await appState).emit('background'));
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.cleanup).toHaveBeenCalledWith('blob:video-preview');
    });

    it('aborts a pending transfer on navigation blur and cleans up a source delivered after cancellation', async () => {
        let finish: (() => void) | undefined;
        let signal: AbortSignal | undefined;
        media.download.mockImplementation(async (input: DownloadInput) => {
            signal = input.signal;
            await new Promise<void>((resolve) => { finish = resolve; });
            return { ok: true, name: 'demo.mp4', sizeBytes: 12_000_000 };
        });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(signal).toBeDefined());
        media.focused = false;
        await act(async () => screen.tree.update(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />));
        expect(signal?.aborted).toBe(true);
        await act(async () => { finish?.(); });
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.cleanup).toHaveBeenCalledWith('blob:video-preview');
    });

    it('shows a transfer failure and lets the user retry', async () => {
        media.download.mockResolvedValueOnce({ ok: false, error: 'Machine disconnected' });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllHostsByTestId('file-video-error')).toHaveLength(1));
        await act(async () => screen.findByTestId('file-video-retry')!.props.onPress());
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
    });

    it('keeps the Android fullscreen player and cache alive through the main activity pause, then cleans up a normal background transition', async () => {
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        const view = screen.findAllByType('VideoView')[0];
        await act(async () => view.props.onFullscreenEnter?.());
        await act(async () => (await appState).emit('background'));
        expect(screen.findAllByType('VideoView')).toHaveLength(1);
        expect(screen.findAllByType('VideoView')[0]).toBe(view);
        expect(media.cleanup).not.toHaveBeenCalled();
        expect(media.player.pause).not.toHaveBeenCalled();
        expect(media.player.staysActiveInBackground).toBe(false);
        await act(async () => (await appState).emit('active'));
        await act(async () => view.props.onFullscreenExit?.());
        expect(screen.findAllByType('VideoView')[0]).toBe(view);
        expect(media.download).toHaveBeenCalledTimes(1);
        await act(async () => (await appState).emit('background'));
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.player.pause).toHaveBeenCalled();
        expect(media.cleanup).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/cache\/happier-previews\/.*\.mp4$/));
    });

    it.each(['tab', 'navigation'])('still releases an Android fullscreen preview when its %s becomes inactive', async (reason) => {
        Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        await act(async () => screen.findAllByType('VideoView')[0].props.onFullscreenEnter?.());
        await act(async () => (await appState).emit('background'));
        expect(screen.findAllByType('VideoView')).toHaveLength(1);
        media.focused = reason !== 'navigation';
        await screen.update(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} isActive={reason !== 'tab'} />);
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.player.pause).toHaveBeenCalled();
        expect(media.cleanup).toHaveBeenCalled();
    });

    it.each(['web', 'ios'])('retains normal background cleanup during fullscreen on %s', async (platform) => {
        Object.defineProperty(Platform, 'OS', { value: platform, configurable: true });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(screen.findAllByType('VideoView')).toHaveLength(1));
        await act(async () => screen.findAllByType('VideoView')[0].props.onFullscreenEnter());
        await act(async () => (await appState).emit('background'));
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
        expect(media.player.pause).toHaveBeenCalled();
        expect(media.cleanup).toHaveBeenCalled();
    });
});
