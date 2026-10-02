import { describe, expect, it, vi } from 'vitest';

import { resolveNativeSileroVadBridge } from './NativeSileroVadBridge';
import { createNativeVadController } from './NativeVadController';
import { createNativeVoicePcmCaptureHarness } from '@/dev/testkit/harness/nativeVoicePcmCapture';

describe('resolveNativeSileroVadBridge frame-fed VAD', () => {
    it('returns native work to the bounded capture owner and clears controller health on saturation', async () => {
        const harness = createNativeVoicePcmCaptureHarness();
        let settlePush!: (value: { speechStarted: boolean; speechEnded: boolean }) => void;
        const pushVadAudioFrame = vi.fn(() => new Promise<{ speechStarted: boolean; speechEnded: boolean }>((resolve) => { settlePush = resolve; }));
        const cancelVadDetector = vi.fn(async () => {});
        const bridge = await resolveNativeSileroVadBridge({ createVadDetector: vi.fn(async () => {}), pushVadAudioFrame, cancelVadDetector }, { frameSource: harness.capture });
        const onEndpointSignal = vi.fn();
        const controller = createNativeVadController({ bridge, onEndpointSignal });
        expect(await controller.startSession({ sessionId: 'bounded', minSpeechMs: 0, redemptionMs: 0 })).toBe(true);
        harness.emit();
        await vi.waitFor(() => expect(pushVadAudioFrame).toHaveBeenCalledTimes(1));
        for (let frame = 0; frame < 8; frame += 1) harness.emit();
        await vi.waitFor(() => expect(controller.isActiveSession('bounded')).toBe(false));
        await controller.stopSession();
        expect(cancelVadDetector).toHaveBeenCalledTimes(1);
        expect(harness.capture.getSnapshot().subscriberCount).toBe(0);
        settlePush({ speechStarted: true, speechEnded: true });
        await harness.capture.waitForDrain();
        expect(onEndpointSignal).not.toHaveBeenCalled();
        expect(pushVadAudioFrame).toHaveBeenCalledTimes(1);
    });

    it('degrades the real controller after rejected native frame work, including a startup terminal', async () => {
        const harness = createNativeVoicePcmCaptureHarness();
        const bridge = await resolveNativeSileroVadBridge({
            createVadDetector: vi.fn(async () => {}),
            pushVadAudioFrame: vi.fn(async () => { throw new Error('native_vad_failed'); }),
            cancelVadDetector: vi.fn(async () => {}),
        }, { frameSource: harness.capture });
        const controller = createNativeVadController({ bridge, onEndpointSignal: vi.fn() });
        await controller.startSession({ sessionId: 'failed', minSpeechMs: 0, redemptionMs: 0 });
        harness.emit();
        await vi.waitFor(() => expect(controller.isActiveSession('failed')).toBe(false));
        expect(harness.capture.getSnapshot().subscriberCount).toBe(0);

        const release = vi.fn(async () => {});
        const earlyBridge = await resolveNativeSileroVadBridge({
            createVadDetector: vi.fn(async () => {}),
            pushVadAudioFrame: vi.fn(async () => ({ speechStarted: false, speechEnded: false })),
            cancelVadDetector: vi.fn(async () => {}),
        }, { frameSource: { acquire: async (request) => {
            request.onError?.(new Error('early_capture_terminal'));
            return { release };
        } } });
        const earlyController = createNativeVadController({ bridge: earlyBridge, onEndpointSignal: vi.fn() });
        expect(await earlyController.startSession({ sessionId: 'early', minSpeechMs: 0, redemptionMs: 0 })).toBe(false);
        expect(earlyController.isActiveSession('early')).toBe(false);
        expect(release).toHaveBeenCalledTimes(1);
    });
    it('feeds the shared host capture into Sherpa without starting a second recorder', async () => {
        let onFrame: ((frame: Readonly<{
            pcm16leBase64: string;
            sampleRate: number;
            channels: number;
        }>) => void) | null = null;
        const releaseCapture = vi.fn(async () => {});
        const frameSource = {
            acquire: vi.fn(async (request: Readonly<{
                onFrame: typeof onFrame;
            }>) => {
                onFrame = request.onFrame;
                return { release: releaseCapture };
            }),
        };
        const createVadDetector = vi.fn(async () => {});
        const pushVadAudioFrame = vi
            .fn()
            .mockResolvedValueOnce({ speechStarted: true, speechEnded: false })
            .mockResolvedValueOnce({ speechStarted: false, speechEnded: true });
        const cancelVadDetector = vi.fn(async () => {});
        const onSpeechStart = vi.fn();
        const onSpeechEnd = vi.fn();
        const nativeModule = {
            createVadDetector,
            pushVadAudioFrame,
            cancelVadDetector,
        };

        const bridge = await resolveNativeSileroVadBridge(nativeModule, { frameSource });
        const session = await bridge!.startSession({
            minSpeechMs: 120,
            redemptionMs: 400,
            sessionId: 'session-a',
            onSpeechStart,
            onSpeechEnd,
        });

        expect(createVadDetector).toHaveBeenCalledWith({
            detectorId: expect.any(String),
            minSpeechMs: 120,
            redemptionMs: 400,
            sampleRate: 16_000,
        });
        expect(frameSource.acquire).toHaveBeenCalledWith(expect.objectContaining({
            ownerId: expect.stringContaining('session-a'),
            format: { sampleRate: 16_000, channels: 1, frameMs: 20 },
            audioSession: {
                mode: 'conversation',
                input: true,
                output: true,
                aec: 'required',
            },
        }));

        onFrame!({ pcm16leBase64: 'AAE=', sampleRate: 16_000, channels: 1 });
        await vi.waitFor(() => expect(pushVadAudioFrame).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(onSpeechStart).toHaveBeenCalledTimes(1));

        onFrame!({ pcm16leBase64: 'AgM=', sampleRate: 16_000, channels: 1 });
        await vi.waitFor(() => expect(pushVadAudioFrame).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(onSpeechEnd).toHaveBeenCalledTimes(1));

        await session.stop();
        await session.stop();
        expect(releaseCapture).toHaveBeenCalledTimes(1);
        expect(cancelVadDetector).toHaveBeenCalledTimes(1);
        expect(nativeModule).not.toHaveProperty('startVadSession');
    });

    it('unwinds a created detector when shared capture acquisition fails', async () => {
        const cancelVadDetector = vi.fn(async () => {});
        const nativeModule = {
            createVadDetector: vi.fn(async () => {}),
            pushVadAudioFrame: vi.fn(async () => ({ speechStarted: false, speechEnded: false })),
            cancelVadDetector,
        };
        const bridge = await resolveNativeSileroVadBridge(nativeModule, {
            frameSource: {
                acquire: vi.fn(async () => {
                    throw new Error('capture_failed');
                }),
            },
        });

        await expect(bridge!.startSession({
            minSpeechMs: 0,
            redemptionMs: 0,
            sessionId: 'session-b',
            onSpeechEnd: vi.fn(),
        })).rejects.toThrow('capture_failed');
        expect(cancelVadDetector).toHaveBeenCalledTimes(1);
    });

    it('tears down the detector when shared capture reports a terminal error', async () => {
        type CaptureErrorHandler = (error: unknown) => void;

        let onCaptureError: CaptureErrorHandler | null = null;
        const releaseCapture = vi.fn(async () => {});
        const cancelVadDetector = vi.fn(async () => {});
        const frameSource = {
            acquire: vi.fn(async (request: Readonly<{
                onError?: CaptureErrorHandler;
            }>) => {
                onCaptureError = request.onError ?? null;
                return { release: releaseCapture };
            }),
        };
        const bridge = await resolveNativeSileroVadBridge({
            createVadDetector: vi.fn(async () => {}),
            pushVadAudioFrame: vi.fn(async () => ({ speechStarted: false, speechEnded: false })),
            cancelVadDetector,
        }, { frameSource });

        const session = await bridge!.startSession({
            minSpeechMs: 120,
            redemptionMs: 400,
            sessionId: 'session-terminal',
            onSpeechEnd: vi.fn(),
        });

        expect(onCaptureError).toEqual(expect.any(Function));
        onCaptureError!(new Error('native_pcm_capture_dead_object'));

        await vi.waitFor(() => expect(releaseCapture).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(cancelVadDetector).toHaveBeenCalledTimes(1));
        await session.stop();
        expect(releaseCapture).toHaveBeenCalledTimes(1);
        expect(cancelVadDetector).toHaveBeenCalledTimes(1);
    });
});
