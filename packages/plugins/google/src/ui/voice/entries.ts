import { GOOGLE_CLOUD_SETTINGS, GOOGLE_GEMINI_SETTINGS } from './settings.js';

export const VOICE_PROVIDER_PRESENTATIONS = Object.freeze([
  Object.freeze({
    providerId: 'happier.voice.google/gemini-stt',
    settingsSectionId: 'voice.stt.google_gemini',
    settingsSpec: GOOGLE_GEMINI_SETTINGS,
    createSettingsSpec: () => GOOGLE_GEMINI_SETTINGS,
  }),
  Object.freeze({
    providerId: 'happier.voice.google/google-cloud-tts',
    settingsSectionId: 'voice.tts.google_cloud',
    settingsSpec: GOOGLE_CLOUD_SETTINGS,
    createSettingsSpec: () => GOOGLE_CLOUD_SETTINGS,
  }),
]);
