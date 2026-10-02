import {
  createOpenAiCompatSttVoiceSettingsSpec,
  createOpenAiCompatTtsVoiceSettingsSpec,
} from './settings.js';

export const VOICE_PROVIDER_PRESENTATIONS = Object.freeze([
  Object.freeze({
    providerId: 'happier.voice.openai-compat/stt',
    settingsSectionId: 'voice.stt.openai_compat',
    settingsSpec: createOpenAiCompatSttVoiceSettingsSpec(),
    createSettingsSpec: createOpenAiCompatSttVoiceSettingsSpec,
  }),
  Object.freeze({
    providerId: 'happier.voice.openai-compat/tts',
    settingsSectionId: 'voice.tts.openai_compat',
    settingsSpec: createOpenAiCompatTtsVoiceSettingsSpec(),
    createSettingsSpec: createOpenAiCompatTtsVoiceSettingsSpec,
  }),
]);
