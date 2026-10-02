import type {
  VoiceRealtimeJsonValue,
  VoiceRealtimeAttemptPolicy,
} from '@happier-dev/plugin-sdk/voice/client';

export type ElevenLabsSessionState = Readonly<{
  billingMode: 'happier' | 'byo';
  expiresAtMs: number | null;
  leaseId: string | null;
}>;

export type ElevenLabsPreparedSession = Readonly<{
  sessionConfig: VoiceRealtimeJsonValue;
  sessionState: ElevenLabsSessionState;
  attemptPolicy?: VoiceRealtimeAttemptPolicy;
}>;

export type ElevenLabsSessionPreparation =
  | Readonly<{ kind: 'prepared'; session: ElevenLabsPreparedSession }>
  | Readonly<{ kind: 'declined'; failure: Readonly<{ reason: string }> }>
  | Readonly<{ kind: 'aborted' }>;
