import type { JsonValue } from '../json/strictJsonValue.js';
import type { VoiceSpeechInputMimeType, VoiceProviderContribution } from '../plugins/contributions/voiceProviders.js';

export type VoiceSpeechSynthesisInputLimits = Readonly<{
  maxInputCharacters?: number;
  maxInputUtf8Bytes?: number;
}>;

/** Resolve limits against the same immutable endpoint settings used for synthesis. */
export function resolveVoiceSpeechSynthesisInputLimits(input: Readonly<{
  contribution: Pick<Extract<VoiceProviderContribution, { kind: 'speech' }>, 'settings' | 'limits'>;
  settings: Readonly<Record<string, JsonValue>>;
}>): VoiceSpeechSynthesisInputLimits {
  const declaration = input.contribution.limits?.synthesize;
  let maxInputCharacters = declaration?.maxInputCharacters;
  const settingId = declaration?.maxInputCharactersSettingId;
  if (settingId) {
    const field = input.contribution.settings.fields.find((candidate) => candidate.id === settingId);
    const selected = Object.prototype.hasOwnProperty.call(input.settings, settingId)
      ? input.settings[settingId] : field?.default;
    if (typeof selected !== 'number' || !Number.isSafeInteger(selected) || selected < 1
      || maxInputCharacters === undefined || selected > maxInputCharacters) {
      throw Object.assign(new Error('provider_settings_invalid'), { code: 'provider_settings_invalid' });
    }
    maxInputCharacters = selected;
  }
  return { maxInputCharacters, maxInputUtf8Bytes: declaration?.maxInputUtf8Bytes };
}

export function isVoiceSpeechSynthesisInputWithinLimits(text: string, limits: VoiceSpeechSynthesisInputLimits): boolean {
  return (limits.maxInputCharacters === undefined || text.length <= limits.maxInputCharacters)
    && (limits.maxInputUtf8Bytes === undefined || new TextEncoder().encode(text).byteLength <= limits.maxInputUtf8Bytes);
}

/**
 * Provider-neutral speech invocation data. The Plugin SDK supplies the
 * credential and HTTP authority appropriate to its daemon realm.
 */
export type VoiceSpeechOperationContext<TCredentials, THttp> = Readonly<{
  credentials: TCredentials;
  settings: Readonly<Record<string, JsonValue>>;
  http: THttp;
  signal: AbortSignal;
}>;

export type VoiceSpeechTranscribeRequest = Readonly<{
  requestId: string;
  model: string;
  language: string | null;
  mimeType: VoiceSpeechInputMimeType;
  bytes: Uint8Array;
}>;

export type VoiceSpeechTranscribeResult = Readonly<{
  requestId: string;
  text: string;
}>;

export type VoiceSpeechSynthesizeRequest = Readonly<{
  requestId: string;
  input: string;
  model: string | null;
  voiceName: string;
  languageCode: string | null;
  format: 'mp3' | 'wav';
  speakingRate: number | null;
  pitch: number | null;
}>;

export type VoiceSpeechSynthesizeResult = Readonly<{
  requestId: string;
  bytes: Uint8Array;
  mimeType: 'audio/mpeg' | 'audio/wav';
}>;
