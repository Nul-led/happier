/**
 * Kimi's shipped UI copy, one authored bundle per supported locale.
 *
 * Unlike FX and Droid, these four keys also still exist in the host translation
 * tree from before Kimi became a bundled plugin, and `resolveRawTranslationValue`
 * resolves the host tree first. The wording here is therefore taken verbatim from
 * the host's already-localized Kimi strings rather than re-translated, so the two
 * owners cannot show different Kimi copy while both exist. Mapping one English
 * `messages` object over every locale — which this plugin previously did — would
 * ship English the moment the host copy is retired.
 *
 * `zh-Hant` has no Kimi entry in the host tree; it follows the same conventions
 * the other bundled Agent plugins use for that locale.
 */
export const KIMI_UI_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (experimental)',
    'sessionInfo.kimiSessionId': 'Kimi session ID',
    'sessionInfo.kimiSessionIdCopied': 'Kimi session ID copied',
  }),
  de: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (experimentell)',
    'sessionInfo.kimiSessionId': 'Kimi-Sitzungs-ID',
    'sessionInfo.kimiSessionIdCopied': 'Kimi-Sitzungs-ID kopiert',
  }),
  ru: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (экспериментально)',
    'sessionInfo.kimiSessionId': 'Идентификатор сессии Kimi',
    'sessionInfo.kimiSessionIdCopied': 'Идентификатор сессии Kimi скопирован',
  }),
  pl: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (eksperymentalne)',
    'sessionInfo.kimiSessionId': 'Identyfikator sesji Kimi',
    'sessionInfo.kimiSessionIdCopied': 'Skopiowano identyfikator sesji Kimi',
  }),
  es: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'CLI de Kimi (experimental)',
    'sessionInfo.kimiSessionId': 'ID de sesión de Kimi',
    'sessionInfo.kimiSessionIdCopied': 'ID de sesión de Kimi copiado',
  }),
  fr: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (expérimental)',
    'sessionInfo.kimiSessionId': 'ID de session Kimi',
    'sessionInfo.kimiSessionIdCopied': 'ID de session Kimi copié',
  }),
  it: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI (sperimentale)',
    'sessionInfo.kimiSessionId': 'ID sessione Kimi',
    'sessionInfo.kimiSessionIdCopied': 'ID sessione Kimi copiato',
  }),
  pt: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'CLI do Kimi (experimental)',
    'sessionInfo.kimiSessionId': 'ID da sessão Kimi',
    'sessionInfo.kimiSessionIdCopied': 'ID da sessão Kimi copiado',
  }),
  ca: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'CLI de Kimi (experimental)',
    'sessionInfo.kimiSessionId': 'ID de la sessió de Kimi',
    'sessionInfo.kimiSessionIdCopied': 'S’ha copiat l’ID de la sessió de Kimi',
  }),
  'zh-Hans': Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi 命令行（实验）',
    'sessionInfo.kimiSessionId': 'Kimi 会话 ID',
    'sessionInfo.kimiSessionIdCopied': '已复制 Kimi 会话 ID',
  }),
  'zh-Hant': Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI（實驗性）',
    'sessionInfo.kimiSessionId': 'Kimi 工作階段 ID',
    'sessionInfo.kimiSessionIdCopied': '已複製 Kimi 工作階段 ID',
  }),
  ja: Object.freeze({
    'agentInput.agent.kimi': 'Kimi',
    'profiles.aiBackend.kimiSubtitleExperimental': 'Kimi CLI（実験）',
    'sessionInfo.kimiSessionId': 'Kimi セッション ID',
    'sessionInfo.kimiSessionIdCopied': 'Kimi セッション ID をコピーしました',
  }),
});

export const KIMI_UI_TRANSLATION_BUNDLES = Object.freeze([
  { locale: 'en', messages: KIMI_UI_TRANSLATIONS.en },
  { locale: 'de', messages: KIMI_UI_TRANSLATIONS.de },
  { locale: 'ru', messages: KIMI_UI_TRANSLATIONS.ru },
  { locale: 'pl', messages: KIMI_UI_TRANSLATIONS.pl },
  { locale: 'es', messages: KIMI_UI_TRANSLATIONS.es },
  { locale: 'fr', messages: KIMI_UI_TRANSLATIONS.fr },
  { locale: 'it', messages: KIMI_UI_TRANSLATIONS.it },
  { locale: 'pt', messages: KIMI_UI_TRANSLATIONS.pt },
  { locale: 'ca', messages: KIMI_UI_TRANSLATIONS.ca },
  { locale: 'zh-Hans', messages: KIMI_UI_TRANSLATIONS['zh-Hans'] },
  { locale: 'zh-Hant', messages: KIMI_UI_TRANSLATIONS['zh-Hant'] },
  { locale: 'ja', messages: KIMI_UI_TRANSLATIONS.ja },
] as const);
