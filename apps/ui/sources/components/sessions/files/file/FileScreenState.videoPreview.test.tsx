import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSessionFixture, createMachineFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { FileBinaryState } from './FileScreenState';
import { Platform } from 'react-native';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { createEncryptedTransferChunkEnvelope } from '@/sync/domains/transfers/runtime/bulkTransferPipeline/transferChunkEncryption';

const media = vi.hoisted(() => ({
    rpc: vi.fn(), readChunk: vi.fn(), cleanup: vi.fn(),
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
// Network transport boundaries; transfer routing, decryption and destination cleanup stay real.
vi.mock('@/sync/api/session/apiSocket', () => ({ apiSocket: { sessionRPC: media.rpc, machineRPC: media.rpc } }));
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

describe('session video file preview', () => {
    beforeEach(async () => {
        Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
        // Resolve the lazy platform module before React's render/flush window.
        await import('@/components/sessions/files/content/FileVideoPreview');
        const { storage } = await import('@/sync/domains/state/storage');
        storage.setState({
            sessions: { s1: createSessionFixture({ id: 's1', active: true, metadata: { machineId: 'm1', path: '/workspace', host: 'test-machine' } }) },
            machines: { m1: createMachineFixture({ id: 'm1', active: true }) },
        });
        vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ features: { machines: { enabled: true, transfer: { enabled: true, serverRouted: { enabled: true } } } }, capabilities: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        media.focused = true;
        media.statusListener = null;
        media.player.status = 'loading';
        media.player.addListener.mockImplementation((_event: string, listener: typeof media.statusListener) => {
            media.statusListener = listener;
            return { remove: vi.fn() };
        });
        let recipientPublicKeyBase64 = '';
        media.readChunk.mockImplementation(async (request: { downloadId: string; index: number }) => ({
            success: true,
            ...await createEncryptedTransferChunkEnvelope({
                transferId: request.downloadId, sequence: request.index, payload: new Uint8Array([1, 2, 3]),
                recipientPublicKeyBase64, randomBytes: length => new Uint8Array(length).fill(19),
            }),
            isLast: true,
        }));
        media.rpc.mockImplementation(async (_sessionId: string, method: string, payload: { recipientPublicKeyBase64?: string }) => {
            if (method === RPC_METHODS.STAT_FILE) return { success: true, exists: true, kind: 'file', sizeBytes: 3 };
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT) {
                recipientPublicKeyBase64 = payload.recipientPublicKeyBase64 ?? '';
                return { success: true, downloadId: 'video-download', name: 'demo.mp4', sizeBytes: 3, chunkSizeBytes: 3 };
            }
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_CHUNK) return media.readChunk(payload);
            if (method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_FINALIZE || method === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_ABORT) return { success: true };
            throw new Error(`Unexpected RPC: ${method}`);
        });
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:video-preview');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(media.cleanup);
        (await appState).emit('active');
    });
    afterEach(() => { standardCleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

    it('loads a video using encrypted chunk RPCs and exposes playback loading, native controls and codec errors', async () => {
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

    it('cleans up a source delivered after navigation blur during a pending chunk RPC', async () => {
        let finish: (() => void) | undefined;
        const readChunk = media.readChunk.getMockImplementation()!;
        media.readChunk.mockImplementation(async (request: { downloadId: string; index: number }) => {
            await new Promise<void>(resolve => { finish = resolve; });
            return readChunk(request);
        });
        const screen = await renderScreen(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />);
        await vi.waitFor(() => expect(finish).toBeDefined());
        media.focused = false;
        await act(async () => screen.tree.update(<FileBinaryState theme={theme} filePath="demo.mp4" {...videoProps} />));
        await act(async () => { finish?.(); });
        await vi.waitFor(() => expect(media.cleanup).toHaveBeenCalledWith('blob:video-preview'));
        expect(screen.findAllByType('VideoView')).toHaveLength(0);
    });

    it('shows a transfer failure and lets the user retry', async () => {
        media.rpc.mockResolvedValueOnce({ success: false, error: 'Machine disconnected' });
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
        expect(media.rpc.mock.calls.filter(call => call[1] === RPC_METHODS.DAEMON_BULK_TRANSFER_DOWNLOAD_INIT)).toHaveLength(1);
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
