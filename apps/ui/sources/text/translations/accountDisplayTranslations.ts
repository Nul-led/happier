/**
 * How an Account without a name is shown (`resolveAccountDisplayName`). An Account is never shown by
 * its raw id: without a name it is "Unnamed account", told apart by a short id suffix.
 */
type AccountDisplayTranslation = Readonly<{
    unnamed: string;
    /** The viewer's own Account while it has no name. */
    yours: string;
    /** The short, stable id suffix that tells unnamed Accounts apart. */
    shortId: (params: Readonly<{ id: string }>) => string;
}>;

export const accountDisplayTranslations = {
    en: { unnamed: 'Unnamed account', yours: 'Your account', shortId: ({ id }) => `ID …${id}` },
    de: { unnamed: 'Unbenanntes Konto', yours: 'Dein Konto', shortId: ({ id }) => `ID …${id}` },
    es: { unnamed: 'Cuenta sin nombre', yours: 'Tu cuenta', shortId: ({ id }) => `ID …${id}` },
    fr: { unnamed: 'Compte sans nom', yours: 'Votre compte', shortId: ({ id }) => `ID …${id}` },
    it: { unnamed: 'Account senza nome', yours: 'Il tuo account', shortId: ({ id }) => `ID …${id}` },
    pt: { unnamed: 'Conta sem nome', yours: 'Sua conta', shortId: ({ id }) => `ID …${id}` },
    ca: { unnamed: 'Compte sense nom', yours: 'El teu compte', shortId: ({ id }) => `ID …${id}` },
    pl: { unnamed: 'Konto bez nazwy', yours: 'Twoje konto', shortId: ({ id }) => `ID …${id}` },
    ru: { unnamed: 'Аккаунт без имени', yours: 'Ваш аккаунт', shortId: ({ id }) => `ID …${id}` },
    ja: { unnamed: '名前のないアカウント', yours: 'あなたのアカウント', shortId: ({ id }) => `ID …${id}` },
    'zh-Hans': { unnamed: '未命名的账户', yours: '你的账户', shortId: ({ id }) => `ID …${id}` },
    'zh-Hant': { unnamed: '未命名的帳戶', yours: '你的帳戶', shortId: ({ id }) => `ID …${id}` },
} as const satisfies Record<string, AccountDisplayTranslation>;
