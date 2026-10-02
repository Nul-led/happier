/**
 * Personal Home first-run decisions beyond the existing-runtime choice:
 * - `signedInHome` (R10 D4): the one question a returning user already signed in to another Home
 *   (such as Happier Cloud) is asked before the desktop creates a Personal Home.
 * - `existingRuntimeCredentials` (S18): an existing local Home whose credentials live with another
 *   Happier app on this computer; its way in is the recovery key.
 * `home` is a Home's display name, interpolated verbatim; `Home` and `Personal Home` are product
 * names.
 */

type HomeParams = { home: string };

const en = {
    homeIdentityAmbiguous: 'This Personal Home address matches more than one saved Home.',
    signedInHome: {
        status: 'You’re already signed in to another Home.',
        body: ({ home }: HomeParams) => `This computer is signed in to ${home}. Keep using it, or set up a Personal Home here.`,
        keep: ({ home }: HomeParams) => `Keep using ${home}`,
        keepDetail: 'Your sessions and machines stay exactly as they are.',
        create: 'Set up a Personal Home',
        createDetail: 'Create a private Home on this computer and switch to it.',
    },
    existingRuntimeCredentials: {
        body: 'This app can’t open it without that Home’s recovery key. Sign in with the key, or use another Home.',
        signIn: 'Sign in with a recovery key',
        signInDetail: 'Use the recovery key saved for this local Home.',
    },
};

export type PersonalHomeDecisionTranslation = typeof en;

const de: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Diese Adresse des persönlichen Homes entspricht mehreren gespeicherten Homes.',
    signedInHome: {
        status: 'Du bist bereits bei einem anderen Home angemeldet.',
        body: ({ home }: HomeParams) => `Dieser Computer ist bei ${home} angemeldet. Nutze es weiter oder richte hier ein persönliches Home ein.`,
        keep: ({ home }: HomeParams) => `${home} weiter nutzen`,
        keepDetail: 'Deine Sitzungen und Maschinen bleiben genau so, wie sie sind.',
        create: 'Persönliches Home einrichten',
        createDetail: 'Erstelle ein privates Home auf diesem Computer und wechsle dorthin.',
    },
    existingRuntimeCredentials: {
        body: 'Diese App kann es ohne den Wiederherstellungsschlüssel dieses Homes nicht öffnen. Melde dich mit dem Schlüssel an oder nutze ein anderes Home.',
        signIn: 'Mit Wiederherstellungsschlüssel anmelden',
        signInDetail: 'Nutze den für dieses lokale Home gespeicherten Wiederherstellungsschlüssel.',
    },
};

const es: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Esta dirección del Home personal corresponde a más de un Home guardado.',
    signedInHome: {
        status: 'Ya has iniciado sesión en otro Home.',
        body: ({ home }: HomeParams) => `Este ordenador tiene la sesión iniciada en ${home}. Sigue usándolo o configura aquí un Home personal.`,
        keep: ({ home }: HomeParams) => `Seguir usando ${home}`,
        keepDetail: 'Tus sesiones y máquinas se quedan exactamente como están.',
        create: 'Configurar un Home personal',
        createDetail: 'Crea un Home privado en este ordenador y cámbiate a él.',
    },
    existingRuntimeCredentials: {
        body: 'Esta app no puede abrirlo sin la clave de recuperación de ese Home. Inicia sesión con la clave o usa otro Home.',
        signIn: 'Iniciar sesión con una clave de recuperación',
        signInDetail: 'Usa la clave de recuperación guardada para este Home local.',
    },
};

const fr: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Cette adresse du Home personnel correspond à plusieurs Homes enregistrés.',
    signedInHome: {
        status: 'Tu es déjà connecté à un autre Home.',
        body: ({ home }: HomeParams) => `Cet ordinateur est connecté à ${home}. Continue de l’utiliser, ou configure ici un Home personnel.`,
        keep: ({ home }: HomeParams) => `Continuer avec ${home}`,
        keepDetail: 'Tes sessions et tes machines restent exactement comme elles sont.',
        create: 'Configurer un Home personnel',
        createDetail: 'Crée un Home privé sur cet ordinateur et bascule dessus.',
    },
    existingRuntimeCredentials: {
        body: 'Cette app ne peut pas l’ouvrir sans la clé de récupération de ce Home. Connecte-toi avec la clé, ou utilise un autre Home.',
        signIn: 'Se connecter avec une clé de récupération',
        signInDetail: 'Utilise la clé de récupération enregistrée pour ce Home local.',
    },
};

const it: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Questo indirizzo dell’Home personale corrisponde a più Home salvati.',
    signedInHome: {
        status: 'Hai già effettuato l’accesso a un altro Home.',
        body: ({ home }: HomeParams) => `Questo computer ha effettuato l’accesso a ${home}. Continua a usarlo o configura qui un Home personale.`,
        keep: ({ home }: HomeParams) => `Continua con ${home}`,
        keepDetail: 'Le tue sessioni e le tue macchine restano esattamente come sono.',
        create: 'Configura un Home personale',
        createDetail: 'Crea un Home privato su questo computer e passa a quello.',
    },
    existingRuntimeCredentials: {
        body: 'Questa app non può aprirlo senza la chiave di recupero di quell’Home. Accedi con la chiave o usa un altro Home.',
        signIn: 'Accedi con una chiave di recupero',
        signInDetail: 'Usa la chiave di recupero salvata per questo Home locale.',
    },
};

const pt: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Este endereço do Home pessoal corresponde a mais de um Home salvo.',
    signedInHome: {
        status: 'Você já entrou em outro Home.',
        body: ({ home }: HomeParams) => `Este computador está conectado a ${home}. Continue usando-o ou configure aqui um Home pessoal.`,
        keep: ({ home }: HomeParams) => `Continuar usando ${home}`,
        keepDetail: 'Suas sessões e máquinas continuam exatamente como estão.',
        create: 'Configurar um Home pessoal',
        createDetail: 'Crie um Home privado neste computador e mude para ele.',
    },
    existingRuntimeCredentials: {
        body: 'Este app não consegue abri-lo sem a chave de recuperação desse Home. Entre com a chave ou use outro Home.',
        signIn: 'Entrar com uma chave de recuperação',
        signInDetail: 'Use a chave de recuperação salva para este Home local.',
    },
};

const ca: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Aquesta adreça del Home personal correspon a més d’un Home desat.',
    signedInHome: {
        status: 'Ja tens la sessió iniciada en un altre Home.',
        body: ({ home }: HomeParams) => `Aquest ordinador té la sessió iniciada a ${home}. Continua fent-lo servir o configura-hi un Home personal.`,
        keep: ({ home }: HomeParams) => `Continua amb ${home}`,
        keepDetail: 'Les teves sessions i màquines es queden exactament com estan.',
        create: 'Configura un Home personal',
        createDetail: 'Crea un Home privat en aquest ordinador i canvia-hi.',
    },
    existingRuntimeCredentials: {
        body: 'Aquesta app no el pot obrir sense la clau de recuperació d’aquest Home. Inicia la sessió amb la clau o utilitza un altre Home.',
        signIn: 'Inicia la sessió amb una clau de recuperació',
        signInDetail: 'Utilitza la clau de recuperació desada per a aquest Home local.',
    },
};

const pl: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Ten adres osobistego Home odpowiada więcej niż jednemu zapisanemu Home.',
    signedInHome: {
        status: 'Jesteś już zalogowany w innym Home.',
        body: ({ home }: HomeParams) => `Ten komputer jest zalogowany w ${home}. Korzystaj z niego dalej albo skonfiguruj tutaj osobisty Home.`,
        keep: ({ home }: HomeParams) => `Dalej używaj ${home}`,
        keepDetail: 'Twoje sesje i maszyny pozostaną dokładnie takie, jakie są.',
        create: 'Skonfiguruj osobisty Home',
        createDetail: 'Utwórz prywatny Home na tym komputerze i przełącz się na niego.',
    },
    existingRuntimeCredentials: {
        body: 'Ta aplikacja nie może go otworzyć bez klucza odzyskiwania tego Home. Zaloguj się kluczem albo użyj innego Home.',
        signIn: 'Zaloguj się kluczem odzyskiwania',
        signInDetail: 'Użyj klucza odzyskiwania zapisanego dla tego lokalnego Home.',
    },
};

const ru: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'Этот адрес личного Home соответствует нескольким сохранённым Home.',
    signedInHome: {
        status: 'Вы уже вошли в другой Home.',
        body: ({ home }: HomeParams) => `Этот компьютер вошёл в ${home}. Продолжайте пользоваться им или настройте здесь личный Home.`,
        keep: ({ home }: HomeParams) => `Продолжить с ${home}`,
        keepDetail: 'Ваши сессии и машины останутся без изменений.',
        create: 'Настроить личный Home',
        createDetail: 'Создайте приватный Home на этом компьютере и переключитесь на него.',
    },
    existingRuntimeCredentials: {
        body: 'Это приложение не может открыть его без ключа восстановления этого Home. Войдите с ключом или используйте другой Home.',
        signIn: 'Войти с ключом восстановления',
        signInDetail: 'Используйте ключ восстановления, сохранённый для этого локального Home.',
    },
};

const ja: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: 'このパーソナル Home のアドレスは、複数の保存済み Home に一致します。',
    signedInHome: {
        status: 'すでに別の Home にサインインしています。',
        body: ({ home }: HomeParams) => `このコンピューターは ${home} にサインインしています。そのまま使い続けるか、ここにパーソナル Home を設定できます。`,
        keep: ({ home }: HomeParams) => `${home} を使い続ける`,
        keepDetail: 'セッションとマシンはそのまま残ります。',
        create: 'パーソナル Home を設定',
        createDetail: 'このコンピューターにプライベートな Home を作成して切り替えます。',
    },
    existingRuntimeCredentials: {
        body: 'この Home の復元キーがないと、このアプリでは開けません。キーでサインインするか、別の Home を使用してください。',
        signIn: '復元キーでサインイン',
        signInDetail: 'このローカル Home 用に保存した復元キーを使います。',
    },
};

const zhHans: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: '此个人 Home 地址对应多个已保存的 Home。',
    signedInHome: {
        status: '你已经登录了另一个 Home。',
        body: ({ home }: HomeParams) => `这台电脑已登录 ${home}。你可以继续使用它，也可以在这里设置个人 Home。`,
        keep: ({ home }: HomeParams) => `继续使用 ${home}`,
        keepDetail: '你的会话和机器都会保持原样。',
        create: '设置个人 Home',
        createDetail: '在这台电脑上创建一个私人 Home 并切换过去。',
    },
    existingRuntimeCredentials: {
        body: '没有该 Home 的恢复密钥，此应用无法打开它。请使用密钥登录，或使用其他 Home。',
        signIn: '使用恢复密钥登录',
        signInDetail: '使用为此本地 Home 保存的恢复密钥。',
    },
};

const zhHant: PersonalHomeDecisionTranslation = {
    homeIdentityAmbiguous: '此個人 Home 位址對應多個已儲存的 Home。',
    signedInHome: {
        status: '你已經登入了另一個 Home。',
        body: ({ home }: HomeParams) => `這台電腦已登入 ${home}。你可以繼續使用它，也可以在這裡設定個人 Home。`,
        keep: ({ home }: HomeParams) => `繼續使用 ${home}`,
        keepDetail: '你的工作階段和機器都會保持原樣。',
        create: '設定個人 Home',
        createDetail: '在這台電腦上建立一個私人 Home 並切換過去。',
    },
    existingRuntimeCredentials: {
        body: '沒有該 Home 的復原金鑰，此應用程式無法開啟它。請使用金鑰登入，或使用其他 Home。',
        signIn: '使用復原金鑰登入',
        signInDetail: '使用為此本機 Home 儲存的復原金鑰。',
    },
};

export const personalHomeDecisionTranslations = {
    en,
    de,
    es,
    fr,
    it,
    ja,
    pl,
    pt,
    ru,
    ca,
    zhHans,
    zhHant,
};
