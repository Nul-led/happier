import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAEMON_VOICE_INFERENCE_STT_STREAM_PCM_FORMAT } from '@happier-dev/protocol';

import { createDaemonStreamingSttController } from './DaemonStreamingSttController';
import { createDaemonSpeechStreamSender } from './DaemonSpeechStreamSender';
import { createWebDaemonSpeechPcmCapture } from './WebDaemonSpeechPcmCapture.web';
import { createDaemonSpeechPcmCapture } from './DaemonSpeechPcmCapture.native';
import { createNativeVoicePcmCaptureHarness } from '@/dev/testkit/harness/nativeVoicePcmCapture';
import type { HappierAudioStreamNativeModule } from '../../../../../../packages/audio-stream-native/src/HappierAudioStreamNative.types';

const nativeBoundary = vi.hoisted(() => ({ module: null as HappierAudioStreamNativeModule | null }));
vi.mock('expo-modules-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('expo-modules-core')>(),
  requireOptionalNativeModule: (name: string) => name === 'HappierAudioStreamNative' ? nativeBoundary.module : null,
}));
vi.mock('@/modal', async () => {
  const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
  return createModalModuleMock();
});

describe('daemon STT capture pipeline', () => {
  afterEach(() => vi.useRealTimers());

  it('reports native source finalization failure instead of returning a successful transcript', async () => {
    const harness = createNativeVoicePcmCaptureHarness(false);
    nativeBoundary.module = harness.nativeModule;
    vi.mocked(harness.nativeModule.stop).mockRejectedValueOnce(new Error('native_stop_failed'));
    const finish = vi.fn(async () => ({ ok: true as const, streamId: 'stream', generation: 1, ackSeq: -1,
      finalText: 'incorrect success', language: 'en', modelPackId: 'pack', events: [] }));
    const sender = createDaemonSpeechStreamSender({ requestId: 'native-finish-failure', transport: {
      start: async () => ({ ok: true, requestId: 'native-finish-failure', streamId: 'stream', generation: 1,
        ackSeq: -1, format: DAEMON_VOICE_INFERENCE_STT_STREAM_PCM_FORMAT }),
      chunk: async ({ seq }) => ({ ok: true, streamId: 'stream', generation: 1, ackSeq: seq, events: [] }),
      finish, cancel: async () => ({ ok: true, streamId: 'stream', generation: 1 }),
    } });
    const controller = createDaemonStreamingSttController({
      createClient: () => ({ createStreamingSttSender: async () => sender }), createPcmCapture: createDaemonSpeechPcmCapture,
    });
    await controller.start({ capturePurpose: 'dictation', micSession: {
      ensureActive: async () => {}, setMuted() {}, isMuted: () => false, teardown: async () => {}, getStream: () => null,
    }, sink: { onAudioStarted() {}, onPartial() {}, onFinal() {}, onEndpoint() {}, onError() {} } });
    await expect(controller.stop()).resolves.toMatchObject({ error: { kind: 'provider_error', reason: 'daemon_streaming_stt_finalization_failed' } });
    expect(finish).not.toHaveBeenCalled();
  });

  it.each([0, 50, 100, 150])('maintains 20ms capture admission with %ims recognition replies and drains finals', async (latencyMs) => {
    vi.useFakeTimers();
    const sends: Array<{ seq: number; at: number }> = [];
    let inFlight = 0;
    let peakInFlight = 0;
    const processor = { connect() {}, disconnect() {}, onaudioprocess: null as ((event: {
      inputBuffer: { sampleRate: number; numberOfChannels: number; getChannelData(): Float32Array };
    }) => void) | null };
    const context = {
      sampleRate: 16_000, state: 'running', destination: {},
      createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
      createScriptProcessor: () => processor,
    };
    // Browser audio graph and daemon transport are the two system boundaries.
    const micSession = {
      ensureActive: async () => {}, setMuted() {}, isMuted: () => false, teardown: async () => {},
      getStream: () => ({ getAudioTracks: () => [] }) as unknown as MediaStream,
      getAudioContext: () => context as unknown as AudioContext,
    };
    const sender = createDaemonSpeechStreamSender({
      requestId: 'capture-pipeline',
      transport: {
        start: async () => ({ ok: true, requestId: 'capture-pipeline', streamId: 'stream', generation: 1,
          ackSeq: -1, format: DAEMON_VOICE_INFERENCE_STT_STREAM_PCM_FORMAT }),
        chunk: ({ seq }) => {
          sends.push({ seq, at: Date.now() });
          peakInFlight = Math.max(peakInFlight, ++inFlight);
          return new Promise((resolve) => setTimeout(() => {
            --inFlight;
            resolve({ ok: true, streamId: 'stream', generation: 1, ackSeq: seq,
              events: [{ type: 'partial', seq, text: `words-${seq}`, isEndpoint: false, confidence: null }] });
          }, latencyMs));
        },
        finish: async ({ finalSeq }) => {
          expect(inFlight).toBe(0);
          return { ok: true, streamId: 'stream', generation: 1, ackSeq: finalSeq,
            finalText: 'all admitted words', language: 'en', modelPackId: 'pack', events: [] };
        },
        cancel: async () => ({ ok: true, streamId: 'stream', generation: 1 }),
      },
    });
    const sink = { onAudioStarted: vi.fn(), onPartial: vi.fn(), onFinal: vi.fn(),
      onEndpoint: vi.fn(), onError: vi.fn() };
    const controller = createDaemonStreamingSttController({
      createClient: () => ({ createStreamingSttSender: async () => sender }),
      createPcmCapture: createWebDaemonSpeechPcmCapture,
    });
    await controller.start({ micSession, sink });
    for (let frame = 0; frame < 25; frame++) {
      processor.onaudioprocess?.({ inputBuffer: { sampleRate: 16_000, numberOfChannels: 1,
        getChannelData: () => new Float32Array(320).fill(0.25) } });
      await vi.advanceTimersByTimeAsync(20);
      expect(sends).toHaveLength(frame + 1);
    }
    const stopping = controller.stop();
    await vi.runAllTimersAsync();
    await expect(stopping).resolves.toEqual({ finalText: 'all admitted words' });
    expect(sends.map(({ seq }) => seq)).toEqual(Array.from({ length: 25 }, (_, index) => index));
    expect(sends.slice(1).every((send, index) => send.at - sends[index]!.at === 20)).toBe(true);
    expect(peakInFlight).toBeLessThanOrEqual(8);
    if (latencyMs > 20) expect(peakInFlight).toBeGreaterThan(1);
    expect(sink.onPartial).toHaveBeenCalledTimes(25);
    expect(sink.onError).not.toHaveBeenCalled();
  });
});
