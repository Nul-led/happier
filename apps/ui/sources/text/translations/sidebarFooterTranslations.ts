type SidebarFooterTranslation = Readonly<{
    /** The account area when this device has no sign-in to the account service it names. */
    linkToService: (params: Readonly<{ service: string }>) => string;
    /** The same entry when the account service has no name to offer. */
    addHomeOrSignIn: string;
    machinesOnline: (params: Readonly<{ online: number; total: number }>) => string;
    usageNoAccounts: string;
    usageNotReported: string;
}>;

export const sidebarFooterTranslations = {
    en: {
        linkToService: ({ service }) => `Link to ${service}`,
        addHomeOrSignIn: 'Add a Home or sign in',
        machinesOnline: ({ online, total }) => `${online} of ${total} online`,
        usageNoAccounts: 'Connect an account to see how much of its limits is left.',
        usageNotReported: 'Your accounts have not reported usage yet.',
    },
    ca: {
        linkToService: ({ service }) => `Vincula amb ${service}`,
        addHomeOrSignIn: 'Afegeix una Home o inicia sessió',
        machinesOnline: ({ online, total }) => `${online} de ${total} en línia`,
        usageNoAccounts: 'Connecta un compte per veure quant li queda dels seus límits.',
        usageNotReported: 'Els teus comptes encara no han informat de l’ús.',
    },
    de: {
        linkToService: ({ service }) => `Mit ${service} verknüpfen`,
        addHomeOrSignIn: 'Home hinzufügen oder anmelden',
        machinesOnline: ({ online, total }) => `${online} von ${total} online`,
        usageNoAccounts: 'Verbinde ein Konto, um zu sehen, wie viel von seinen Limits übrig ist.',
        usageNotReported: 'Deine Konten haben noch keine Nutzung gemeldet.',
    },
    es: {
        linkToService: ({ service }) => `Vincular con ${service}`,
        addHomeOrSignIn: 'Añadir un Home o iniciar sesión',
        machinesOnline: ({ online, total }) => `${online} de ${total} en línea`,
        usageNoAccounts: 'Conecta una cuenta para ver cuánto queda de sus límites.',
        usageNotReported: 'Tus cuentas aún no han informado del uso.',
    },
    fr: {
        linkToService: ({ service }) => `Lier à ${service}`,
        addHomeOrSignIn: 'Ajouter un Home ou se connecter',
        machinesOnline: ({ online, total }) => `${online} sur ${total} en ligne`,
        usageNoAccounts: 'Connectez un compte pour voir ce qu’il reste de ses limites.',
        usageNotReported: 'Vos comptes n’ont pas encore indiqué leur utilisation.',
    },
    it: {
        linkToService: ({ service }) => `Collega a ${service}`,
        addHomeOrSignIn: 'Aggiungi una Home o accedi',
        machinesOnline: ({ online, total }) => `${online} di ${total} online`,
        usageNoAccounts: 'Collega un account per vedere quanto resta dei suoi limiti.',
        usageNotReported: 'I tuoi account non hanno ancora segnalato l’utilizzo.',
    },
    ja: {
        linkToService: ({ service }) => `${service} にリンク`,
        addHomeOrSignIn: 'Home を追加またはサインイン',
        machinesOnline: ({ online, total }) => `${total} 台中 ${online} 台がオンライン`,
        usageNoAccounts: 'アカウントを接続すると、上限の残りを確認できます。',
        usageNotReported: 'アカウントからまだ使用量が報告されていません。',
    },
    pl: {
        linkToService: ({ service }) => `Połącz z ${service}`,
        addHomeOrSignIn: 'Dodaj Home lub zaloguj się',
        machinesOnline: ({ online, total }) => `${online} z ${total} online`,
        usageNoAccounts: 'Połącz konto, aby zobaczyć, ile zostało z jego limitów.',
        usageNotReported: 'Twoje konta nie zgłosiły jeszcze użycia.',
    },
    pt: {
        linkToService: ({ service }) => `Associar a ${service}`,
        addHomeOrSignIn: 'Adicionar um Home ou iniciar sessão',
        machinesOnline: ({ online, total }) => `${online} de ${total} online`,
        usageNoAccounts: 'Ligue uma conta para ver quanto resta dos seus limites.',
        usageNotReported: 'As suas contas ainda não comunicaram o uso.',
    },
    ru: {
        linkToService: ({ service }) => `Связать с ${service}`,
        addHomeOrSignIn: 'Добавить Home или войти',
        machinesOnline: ({ online, total }) => `${online} из ${total} в сети`,
        usageNoAccounts: 'Подключите аккаунт, чтобы видеть, сколько осталось от его лимитов.',
        usageNotReported: 'Ваши аккаунты ещё не сообщили об использовании.',
    },
    'zh-Hans': {
        linkToService: ({ service }) => `关联到 ${service}`,
        addHomeOrSignIn: '添加 Home 或登录',
        machinesOnline: ({ online, total }) => `${online}/${total} 在线`,
        usageNoAccounts: '连接一个账户即可查看其剩余额度。',
        usageNotReported: '你的账户尚未报告用量。',
    },
    'zh-Hant': {
        linkToService: ({ service }) => `連結到 ${service}`,
        addHomeOrSignIn: '新增 Home 或登入',
        machinesOnline: ({ online, total }) => `${online}/${total} 在線`,
        usageNoAccounts: '連接一個帳戶即可查看其剩餘額度。',
        usageNotReported: '你的帳戶尚未回報用量。',
    },
} as const satisfies Record<string, SidebarFooterTranslation>;
