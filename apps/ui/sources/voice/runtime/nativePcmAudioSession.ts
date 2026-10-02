/**
 * Shared host PCM capture runs while the native player can render Voice output.
 * Conversation consumers share this request so the coordinator admits capture
 * only after native AEC becomes active. Dictation uses the input-only policy below.
 */
export const VOICE_PCM_CONVERSATION_AUDIO_SESSION = Object.freeze({
  mode: 'conversation' as const,
  input: true,
  output: true,
  aec: 'required' as const,
});

const VOICE_PCM_DICTATION_AUDIO_SESSION = Object.freeze({
  mode: 'dictation' as const,
  input: true,
  output: false,
  aec: 'off' as const,
});

export function resolveVoicePcmCaptureAudioSession(purpose: 'dictation' | 'conversation') {
  return purpose === 'conversation' ? VOICE_PCM_CONVERSATION_AUDIO_SESSION : VOICE_PCM_DICTATION_AUDIO_SESSION;
}
