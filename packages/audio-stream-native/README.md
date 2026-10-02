# `@happier-dev/audio-stream-native`

Host-owned native audio substrate for voice capture and native audio-session policy.

Use `getSharedVoiceAudioSessionCoordinator()` for call/dictation/playback mode ownership
and `getSharedVoicePcmCapture()` for microphone PCM. The package deliberately exposes
only these per-JS-runtime shared owners at its root. The capture service owns one native
stream and fans frames out through refcounted subscriber leases with independent bounded
queues. STT, VAD, and diagnostics must subscribe to that service; they must not call the
native `start`/`stop` methods independently.

For graceful transcription completion, use the subscriber lease's `finish()` to
stop admitting frames and deliver its already admitted tail before finalizing the
recognizer. `release()` cancels queued delivery and releases capture without waiting
for a slow subscriber. Dictation requests input-only audio with AEC off; conversation
capture retains its input/output and required-AEC request.

Raw native discovery and module types are package-internal through `src/internal.ts` and
are intentionally absent from the package root.

Development PCM output uses `getSharedVoicePcmPlayback()` attached to the active
capture identity. The playback owner accepts ordered response bursts and releases
pending PCM on clear, stop, or terminal failure. On Android its existing monitor
feeds `AudioTrack` without blocking the JS bridge; the hardware buffer size comes
from `AudioTrack.getMinBufferSize()`. iOS schedules response buffers through the
shared `AVAudioPlayerNode`. A provider does not impose a spoken-duration backlog
limit. Compilation and physical-device acoustic validation remain required before
releasing changes to these native owners.

On iOS, `createVoiceFileRecording()` and `createVoiceEncodedAudioPlayback()` keep recorded
turns and encoded TTS bytes inside this same native owner. They require an already-acquired
shared audio-session lease and never configure or deactivate `AVAudioSession` themselves.
Android and web continue to use their existing Expo/browser recording and playback paths.

The native `start`/`stop` methods are implementation details behind the shared capture
service. Native `start` fails closed unless the coordinator has configured the audio
session; it never self-acquires a legacy dictation session.

`aec: 'required'` fails closed when the platform cannot provide echo cancellation.
Simulator/emulator checks prove lifecycle wiring only; speakerphone echo quality,
Bluetooth/wired route changes, phone/VoIP interruptions, and restoration require physical
device evidence.
