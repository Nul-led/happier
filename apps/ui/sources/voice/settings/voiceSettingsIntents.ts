import { SETTINGS_ROUTES } from '@/components/settings/catalog/routes';
import type { IconName } from '@/components/ui/icons/Icon';
import type { TranslationKeyNoParams } from '@/text';

export type VoiceSettingsIntent = 'dictation' | 'conversations' | 'privacy' | 'advanced';

export type VoiceSettingsIntentDefinition = Readonly<{
  id: VoiceSettingsIntent;
  route: string;
  titleKey: TranslationKeyNoParams;
  subtitleKey: TranslationKeyNoParams;
  /** The destination's landmark glyph on the intent index. */
  iconName: IconName;
}>;

export const VOICE_SETTINGS_INTENTS: readonly VoiceSettingsIntentDefinition[] = Object.freeze([
  {
    id: 'dictation',
    route: SETTINGS_ROUTES.voiceDictation,
    titleKey: 'settingsVoice.intents.dictation.title',
    subtitleKey: 'settingsVoice.intents.dictation.subtitle',
    iconName: 'microphone',
  },
  {
    id: 'conversations',
    route: SETTINGS_ROUTES.voiceConversations,
    titleKey: 'settingsVoice.intents.conversations.title',
    subtitleKey: 'settingsVoice.intents.conversations.subtitle',
    iconName: 'chat-circle-dots',
  },
  {
    id: 'privacy',
    route: SETTINGS_ROUTES.voicePrivacy,
    titleKey: 'settingsVoice.intents.privacy.title',
    subtitleKey: 'settingsVoice.intents.privacy.subtitle',
    iconName: 'shield-check',
  },
  {
    id: 'advanced',
    route: SETTINGS_ROUTES.voiceAdvanced,
    titleKey: 'settingsVoice.intents.advanced.title',
    subtitleKey: 'settingsVoice.intents.advanced.subtitle',
    iconName: 'sliders-horizontal',
  },
]);

export function resolveLegacyVoiceSettingsIntent(value: unknown): VoiceSettingsIntent | null {
  if (value === 'provider') return 'conversations';
  if (value === 'privacy') return 'privacy';
  return null;
}
