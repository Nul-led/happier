import { vi } from 'vitest';

import type { AudioStreamFrameEvent, HappierAudioStreamNativeModule } from '../../../../../../packages/audio-stream-native/src/HappierAudioStreamNative.types';
import { createVoiceAudioSessionCoordinator, type VoiceAudioSessionApplyRequest, type VoiceAudioSessionPlatformEvent } from '../../../../../../packages/audio-stream-native/src/voiceAudioSessionCoordinator';
import { createVoicePcmCapture } from '../../../../../../packages/audio-stream-native/src/voicePcmCapture';

/** Real capture/coordinator logic with only the native audio system boundary replaced. */
export function createNativeVoicePcmCaptureHarness(aecAvailable = true) {
  let frameListener: ((frame: AudioStreamFrameEvent) => void) | null = null;
  let sessionListener: ((event: VoiceAudioSessionPlatformEvent) => void) | null = null;
  let generation = 0;
  const apply = vi.fn(async (request: VoiceAudioSessionApplyRequest) => {
    generation = request.generation;
    return { generation, aecAvailable, aecActive: false, route: 'speaker' };
  });
  const coordinator = createVoiceAudioSessionCoordinator({ platform: {
    apply,
    restore: vi.fn(async () => {}),
    subscribe: (listener) => { sessionListener = listener; return { remove: () => { sessionListener = null; } }; },
  } });
  const nativeModule: HappierAudioStreamNativeModule = {
    start: vi.fn(async () => {
      sessionListener?.({ generation, kind: 'capabilities_changed', aecAvailable, aecActive: aecAvailable });
      return { streamId: 'native-stream' };
    }),
    stop: vi.fn(async () => {}),
    configureAudioSession: vi.fn(async ({ generation: nativeGeneration }) => ({ generation: nativeGeneration, aecAvailable, aecActive: aecAvailable, route: 'speaker' })),
    restoreAudioSession: vi.fn(async () => {}),
    addListener: vi.fn((name, listener) => {
      if (name === 'audioFrame') frameListener = listener as (frame: AudioStreamFrameEvent) => void;
      return { remove: () => { if (name === 'audioFrame') frameListener = null; } };
    }),
  };
  const capture = createVoicePcmCapture({ nativeModule, audioSessionCoordinator: coordinator });
  return {
    capture, nativeModule, apply,
    emit: (pcm16leBase64 = 'AAE=') => frameListener?.({ streamId: 'native-stream', pcm16leBase64, sampleRate: 16_000, channels: 1 }),
  };
}
