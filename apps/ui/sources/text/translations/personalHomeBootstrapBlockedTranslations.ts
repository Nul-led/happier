type PersonalHomeBootstrapBlockedTranslation = Readonly<{
    blocked: Readonly<{
        runtime_unhealthy: string;
        home_auth_invalid: string;
        existing_runtime: string;
        personal_home_erased: string;
    }>;
    blockedBody: Readonly<{
        personal_home_erased: string;
    }>;
}>;

/**
 * Complete blocked-state copy for Personal Home bootstrap.
 *
 * Keeping this small state family together prevents the product terms for Home,
 * local Home, and Personal Home from drifting within a single recovery card.
 */
export const personalHomeBootstrapBlockedTranslations = {
    de: {
        blocked: {
            runtime_unhealthy: 'Dein lokales Zuhause braucht Aufmerksamkeit, bevor es starten kann.',
            home_auth_invalid: 'Die Anmeldung für dein Zuhause braucht Aufmerksamkeit.',
            existing_runtime: 'Für ein vorhandenes lokales Zuhause ist eine Entscheidung nötig, bevor die Einrichtung fortgesetzt werden kann.',
            personal_home_erased: 'Dein persönliches Zuhause wurde gelöscht. Versuche es erneut, um ein neues zu erstellen.',
        },
        blockedBody: { personal_home_erased: 'Die Daten deines Zuhauses wurden gelöscht. Hier gibt es nichts wiederherzustellen – erstelle ein neues persönliches Zuhause oder nutze ein anderes Zuhause.' },
    },
    es: {
        blocked: {
            runtime_unhealthy: 'Tu Hogar local necesita atención antes de poder iniciarse.',
            home_auth_invalid: 'La autenticación de tu Hogar necesita atención.',
            existing_runtime: 'Debes elegir qué hacer con el Hogar local existente antes de continuar la configuración.',
            personal_home_erased: 'Tu Hogar personal se eliminó. Inténtalo de nuevo para crear uno nuevo.',
        },
        blockedBody: { personal_home_erased: 'Se eliminaron los datos de tu Hogar. Aquí no queda nada que recuperar; crea un Hogar personal nuevo o usa otro Hogar.' },
    },
    fr: {
        blocked: {
            runtime_unhealthy: 'Ta Maison locale nécessite ton attention avant de pouvoir démarrer.',
            home_auth_invalid: 'L’authentification de ta Maison nécessite ton attention.',
            existing_runtime: 'Tu dois choisir quoi faire de la Maison locale existante avant de poursuivre la configuration.',
            personal_home_erased: 'Ta Maison personnelle a été supprimée. Réessaie pour en créer une nouvelle.',
        },
        blockedBody: { personal_home_erased: 'Les données de ta Maison ont été supprimées. Il n’y a plus rien à récupérer ici ; crée une nouvelle Maison personnelle ou utilise une autre Maison.' },
    },
    it: {
        blocked: {
            runtime_unhealthy: 'La tua Casa locale richiede attenzione prima di poter essere avviata.',
            home_auth_invalid: 'L’autenticazione della tua Casa richiede attenzione.',
            existing_runtime: 'Devi scegliere cosa fare della Casa locale esistente prima di continuare la configurazione.',
            personal_home_erased: 'La tua Casa personale è stata eliminata. Riprova per crearne una nuova.',
        },
        blockedBody: { personal_home_erased: 'I dati della tua Casa sono stati eliminati. Qui non resta nulla da recuperare; crea una nuova Casa personale o usa un’altra Casa.' },
    },
    pt: {
        blocked: {
            runtime_unhealthy: 'A tua Casa local precisa de atenção antes de poder iniciar.',
            home_auth_invalid: 'A autenticação da tua Casa precisa de atenção.',
            existing_runtime: 'Tens de escolher o que fazer com a Casa local existente antes de continuar a configuração.',
            personal_home_erased: 'A tua Casa pessoal foi eliminada. Tenta novamente para criar uma nova.',
        },
        blockedBody: { personal_home_erased: 'Os dados da tua Casa foram eliminados. Não há nada a recuperar aqui; cria uma nova Casa pessoal ou usa outra Casa.' },
    },
    ca: {
        blocked: {
            runtime_unhealthy: 'La teva Llar local necessita atenció abans de poder iniciar-se.',
            home_auth_invalid: 'L’autenticació de la teva Llar necessita atenció.',
            existing_runtime: 'Has de triar què vols fer amb la Llar local existent abans de continuar la configuració.',
            personal_home_erased: 'La teva Llar personal s’ha esborrat. Torna-ho a provar per crear-ne una de nova.',
        },
        blockedBody: { personal_home_erased: 'Les dades de la teva Llar s’han esborrat. Aquí no queda res per recuperar; crea una Llar personal nova o fes servir una altra Llar.' },
    },
    pl: {
        blocked: {
            runtime_unhealthy: 'Twój lokalny Dom wymaga uwagi, zanim będzie można go uruchomić.',
            home_auth_invalid: 'Uwierzytelnianie Twojego Domu wymaga uwagi.',
            existing_runtime: 'Przed kontynuowaniem konfiguracji wybierz, co zrobić z istniejącym lokalnym Domem.',
            personal_home_erased: 'Twój Dom osobisty został usunięty. Spróbuj ponownie, aby utworzyć nowy.',
        },
        blockedBody: { personal_home_erased: 'Dane Twojego Domu zostały usunięte. Nie ma tu nic do odzyskania; utwórz nowy Dom osobisty albo użyj innego Domu.' },
    },
    ru: {
        blocked: {
            runtime_unhealthy: 'Ваш локальный Дом требует внимания, прежде чем его можно будет запустить.',
            home_auth_invalid: 'Аутентификация вашего Дома требует внимания.',
            existing_runtime: 'Прежде чем продолжить настройку, выберите, что делать с существующим локальным Домом.',
            personal_home_erased: 'Ваш Личный дом удалён. Повторите попытку, чтобы создать новый.',
        },
        blockedBody: { personal_home_erased: 'Данные вашего Дома удалены. Восстанавливать здесь нечего; создайте новый Личный дом или используйте другой Дом.' },
    },
    ja: {
        blocked: {
            runtime_unhealthy: 'ローカルホームを起動するには対応が必要です。',
            home_auth_invalid: 'ホームの認証に対応が必要です。',
            existing_runtime: 'セットアップを続ける前に、既存のローカルホームをどうするか選択してください。',
            personal_home_erased: 'パーソナルホームは削除されました。もう一度試して新しく作成してください。',
        },
        blockedBody: { personal_home_erased: 'ホームのデータは削除されました。ここに復元できるものはありません。新しいパーソナルホームを作成するか、別のホームを使ってください。' },
    },
    'zh-Hans': {
        blocked: {
            runtime_unhealthy: '本地之家需要处理后才能启动。',
            home_auth_invalid: '你的之家认证需要处理。',
            existing_runtime: '继续设置前，请选择如何处理现有的本地之家。',
            personal_home_erased: '你的个人之家已被删除。请重试以创建新的个人之家。',
        },
        blockedBody: { personal_home_erased: '你的之家数据已被删除。这里没有可恢复的内容；请创建新的个人之家或使用其他之家。' },
    },
    'zh-Hant': {
        blocked: {
            runtime_unhealthy: '本地之家需要處理後才能啟動。',
            home_auth_invalid: '你的之家驗證需要處理。',
            existing_runtime: '繼續設定前，請選擇如何處理現有的本地之家。',
            personal_home_erased: '你的個人之家已被刪除。請重試以建立新的個人之家。',
        },
        blockedBody: { personal_home_erased: '你的之家資料已被刪除。這裡沒有可復原的內容；請建立新的個人之家或使用其他之家。' },
    },
} as const satisfies Record<string, PersonalHomeBootstrapBlockedTranslation>;
