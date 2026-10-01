const en = {
    unavailable: 'This session isn’t available',
    respondInSession: 'Open the session to respond.',
    regionLabel: ({ title }: { title: string }) => `Session: ${title}`,
    /** The embedded new chat's line above the composer, before anything has been said. */
    newChatWelcome: 'What should we work on?',
};

function translated(value: typeof en): typeof en { return value; }

/**
 * Copy owned by the embedded Session presentation (plugin session parts, the embed route, the
 * peek). `unavailable` is deliberately neutral: an embedded mount never says whether a Session was
 * deleted or is simply out of its reach.
 */
export const sessionEmbeddedTranslations = {
    en,
    ca: translated({
        unavailable: 'Aquesta sessió no està disponible',
        respondInSession: 'Obre la sessió per respondre.',
        regionLabel: ({ title }) => `Sessió: ${title}`,
        newChatWelcome: 'En què treballem?',
    }),
    de: translated({
        unavailable: 'Diese Sitzung ist nicht verfügbar',
        respondInSession: 'Öffne die Sitzung, um zu antworten.',
        regionLabel: ({ title }) => `Sitzung: ${title}`,
        newChatWelcome: 'Woran arbeiten wir?',
    }),
    es: translated({
        unavailable: 'Esta sesión no está disponible',
        respondInSession: 'Abre la sesión para responder.',
        regionLabel: ({ title }) => `Sesión: ${title}`,
        newChatWelcome: '¿En qué trabajamos?',
    }),
    fr: translated({
        unavailable: 'Cette session n’est pas disponible',
        respondInSession: 'Ouvrez la session pour répondre.',
        regionLabel: ({ title }) => `Session : ${title}`,
        newChatWelcome: 'Sur quoi travaillons-nous ?',
    }),
    it: translated({
        unavailable: 'Questa sessione non è disponibile',
        respondInSession: 'Apri la sessione per rispondere.',
        regionLabel: ({ title }) => `Sessione: ${title}`,
        newChatWelcome: 'Su cosa lavoriamo?',
    }),
    ja: translated({
        unavailable: 'このセッションは利用できません',
        respondInSession: '応答するにはセッションを開いてください。',
        regionLabel: ({ title }) => `セッション: ${title}`,
        newChatWelcome: '何に取り組みましょうか？',
    }),
    pl: translated({
        unavailable: 'Ta sesja jest niedostępna',
        respondInSession: 'Otwórz sesję, aby odpowiedzieć.',
        regionLabel: ({ title }) => `Sesja: ${title}`,
        newChatWelcome: 'Nad czym pracujemy?',
    }),
    pt: translated({
        unavailable: 'Esta sessão não está disponível',
        respondInSession: 'Abra a sessão para responder.',
        regionLabel: ({ title }) => `Sessão: ${title}`,
        newChatWelcome: 'Em que vamos trabalhar?',
    }),
    ru: translated({
        unavailable: 'Эта сессия недоступна',
        respondInSession: 'Откройте сессию, чтобы ответить.',
        regionLabel: ({ title }) => `Сессия: ${title}`,
        newChatWelcome: 'Над чем поработаем?',
    }),
    'zh-Hans': translated({
        unavailable: '此会话不可用',
        respondInSession: '打开会话以回复。',
        regionLabel: ({ title }) => `会话：${title}`,
        newChatWelcome: '我们要做什么？',
    }),
    'zh-Hant': translated({
        unavailable: '此工作階段無法使用',
        respondInSession: '開啟工作階段以回覆。',
        regionLabel: ({ title }) => `工作階段：${title}`,
        newChatWelcome: '我們要做什麼？',
    }),
} as const;
