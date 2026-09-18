/**
 * Factory Droid's shipped UI copy, one authored bundle per supported locale.
 *
 * These keys are not in the host translation tree, so this bundle is the only
 * thing the UI can show for Droid. Mapping one English `messages` object over
 * every locale — which this plugin previously did — silently ships English to
 * every non-English user while still satisfying a completeness check.
 *
 * `Factory Droid` is a product name and stays untranslated; only the
 * experimental qualifier and the session-ID copy are localized.
 */
export const DROID_UI_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (experimental)',
    'sessionInfo.droidSessionId': 'Droid session ID',
    'sessionInfo.droidSessionIdCopied': 'Droid session ID copied',
  }),
  de: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (experimentell)',
    'sessionInfo.droidSessionId': 'Droid-Sitzungs-ID',
    'sessionInfo.droidSessionIdCopied': 'Droid-Sitzungs-ID kopiert',
  }),
  ru: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (экспериментально)',
    'sessionInfo.droidSessionId': 'Идентификатор сессии Droid',
    'sessionInfo.droidSessionIdCopied': 'Идентификатор сессии Droid скопирован',
  }),
  pl: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (eksperymentalne)',
    'sessionInfo.droidSessionId': 'Identyfikator sesji Droid',
    'sessionInfo.droidSessionIdCopied': 'Skopiowano identyfikator sesji Droid',
  }),
  es: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (experimental)',
    'sessionInfo.droidSessionId': 'ID de sesión de Droid',
    'sessionInfo.droidSessionIdCopied': 'ID de sesión de Droid copiado',
  }),
  fr: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (expérimental)',
    'sessionInfo.droidSessionId': 'Identifiant de session Droid',
    'sessionInfo.droidSessionIdCopied': 'Identifiant de session Droid copié',
  }),
  it: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (sperimentale)',
    'sessionInfo.droidSessionId': 'ID sessione Droid',
    'sessionInfo.droidSessionIdCopied': 'ID sessione Droid copiato',
  }),
  pt: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (experimental)',
    'sessionInfo.droidSessionId': 'ID da sessão Droid',
    'sessionInfo.droidSessionIdCopied': 'ID da sessão Droid copiado',
  }),
  ca: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid (experimental)',
    'sessionInfo.droidSessionId': 'ID de sessió de Droid',
    'sessionInfo.droidSessionIdCopied': 'S’ha copiat l’ID de sessió de Droid',
  }),
  'zh-Hans': Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid（实验性）',
    'sessionInfo.droidSessionId': 'Droid 会话 ID',
    'sessionInfo.droidSessionIdCopied': '已复制 Droid 会话 ID',
  }),
  'zh-Hant': Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid（實驗性）',
    'sessionInfo.droidSessionId': 'Droid 工作階段 ID',
    'sessionInfo.droidSessionIdCopied': '已複製 Droid 工作階段 ID',
  }),
  ja: Object.freeze({
    'agentInput.agent.droid': 'Factory Droid',
    'profiles.aiBackend.droidSubtitleExperimental': 'Factory Droid（実験的）',
    'sessionInfo.droidSessionId': 'Droid セッション ID',
    'sessionInfo.droidSessionIdCopied': 'Droid セッション ID をコピーしました',
  }),
});

export const DROID_UI_TRANSLATION_BUNDLES = Object.freeze([
  { locale: 'en', messages: DROID_UI_TRANSLATIONS.en },
  { locale: 'de', messages: DROID_UI_TRANSLATIONS.de },
  { locale: 'ru', messages: DROID_UI_TRANSLATIONS.ru },
  { locale: 'pl', messages: DROID_UI_TRANSLATIONS.pl },
  { locale: 'es', messages: DROID_UI_TRANSLATIONS.es },
  { locale: 'fr', messages: DROID_UI_TRANSLATIONS.fr },
  { locale: 'it', messages: DROID_UI_TRANSLATIONS.it },
  { locale: 'pt', messages: DROID_UI_TRANSLATIONS.pt },
  { locale: 'ca', messages: DROID_UI_TRANSLATIONS.ca },
  { locale: 'zh-Hans', messages: DROID_UI_TRANSLATIONS['zh-Hans'] },
  { locale: 'zh-Hant', messages: DROID_UI_TRANSLATIONS['zh-Hant'] },
  { locale: 'ja', messages: DROID_UI_TRANSLATIONS.ja },
] as const);
