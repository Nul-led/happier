/**
 * FX's shipped UI copy, one authored bundle per supported locale.
 *
 * These keys are not in the host translation tree, so this bundle is the only
 * thing the UI can show for FX. Mapping one English `messages` object over every
 * locale — which this plugin previously did — silently ships English to every
 * non-English user while still satisfying a completeness check.
 */
export const FX_UI_TRANSLATIONS = Object.freeze({
  en: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'FX coding agent (experimental)',
    'sessionInfo.fxSessionId': 'FX session ID',
    'sessionInfo.fxSessionIdCopied': 'FX session ID copied',
  }),
  de: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'FX-Coding-Agent (experimentell)',
    'sessionInfo.fxSessionId': 'FX-Sitzungs-ID',
    'sessionInfo.fxSessionIdCopied': 'FX-Sitzungs-ID kopiert',
  }),
  ru: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Кодинг-агент FX (экспериментально)',
    'sessionInfo.fxSessionId': 'Идентификатор сессии FX',
    'sessionInfo.fxSessionIdCopied': 'Идентификатор сессии FX скопирован',
  }),
  pl: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agent kodowania FX (eksperymentalne)',
    'sessionInfo.fxSessionId': 'Identyfikator sesji FX',
    'sessionInfo.fxSessionIdCopied': 'Skopiowano identyfikator sesji FX',
  }),
  es: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agente de programación FX (experimental)',
    'sessionInfo.fxSessionId': 'ID de sesión de FX',
    'sessionInfo.fxSessionIdCopied': 'ID de sesión de FX copiado',
  }),
  fr: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agent de codage FX (expérimental)',
    'sessionInfo.fxSessionId': 'Identifiant de session FX',
    'sessionInfo.fxSessionIdCopied': 'Identifiant de session FX copié',
  }),
  it: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agente di programmazione FX (sperimentale)',
    'sessionInfo.fxSessionId': 'ID sessione FX',
    'sessionInfo.fxSessionIdCopied': 'ID sessione FX copiato',
  }),
  pt: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agente de programação FX (experimental)',
    'sessionInfo.fxSessionId': 'ID da sessão FX',
    'sessionInfo.fxSessionIdCopied': 'ID da sessão FX copiado',
  }),
  ca: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'Agent de programació FX (experimental)',
    'sessionInfo.fxSessionId': 'ID de sessió de FX',
    'sessionInfo.fxSessionIdCopied': 'S’ha copiat l’ID de sessió de FX',
  }),
  'zh-Hans': Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'FX 编程智能体（实验性）',
    'sessionInfo.fxSessionId': 'FX 会话 ID',
    'sessionInfo.fxSessionIdCopied': '已复制 FX 会话 ID',
  }),
  'zh-Hant': Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'FX 編程代理（實驗性）',
    'sessionInfo.fxSessionId': 'FX 工作階段 ID',
    'sessionInfo.fxSessionIdCopied': '已複製 FX 工作階段 ID',
  }),
  ja: Object.freeze({
    'agentInput.agent.fx': 'FX',
    'profiles.aiBackend.fxSubtitleExperimental': 'FX コーディングエージェント（実験的）',
    'sessionInfo.fxSessionId': 'FX セッション ID',
    'sessionInfo.fxSessionIdCopied': 'FX セッション ID をコピーしました',
  }),
});

export const FX_UI_TRANSLATION_BUNDLES = Object.freeze([
  { locale: 'en', messages: FX_UI_TRANSLATIONS.en },
  { locale: 'de', messages: FX_UI_TRANSLATIONS.de },
  { locale: 'ru', messages: FX_UI_TRANSLATIONS.ru },
  { locale: 'pl', messages: FX_UI_TRANSLATIONS.pl },
  { locale: 'es', messages: FX_UI_TRANSLATIONS.es },
  { locale: 'fr', messages: FX_UI_TRANSLATIONS.fr },
  { locale: 'it', messages: FX_UI_TRANSLATIONS.it },
  { locale: 'pt', messages: FX_UI_TRANSLATIONS.pt },
  { locale: 'ca', messages: FX_UI_TRANSLATIONS.ca },
  { locale: 'zh-Hans', messages: FX_UI_TRANSLATIONS['zh-Hans'] },
  { locale: 'zh-Hant', messages: FX_UI_TRANSLATIONS['zh-Hant'] },
  { locale: 'ja', messages: FX_UI_TRANSLATIONS.ja },
] as const);
