type PersonalHomeBootstrapBlockedTranslation = Readonly<{
    blocked: Readonly<{
        runtime_unhealthy: string;
        home_auth_invalid: string;
        existing_runtime: string;
        existing_runtime_credentials: string;
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
            runtime_unhealthy: 'Dein lokales Home braucht Aufmerksamkeit, bevor es starten kann.',
            home_auth_invalid: 'Die Anmeldung für dein Home braucht Aufmerksamkeit.',
            existing_runtime: 'Für ein vorhandenes lokales Home ist eine Entscheidung nötig, bevor die Einrichtung fortgesetzt werden kann.',
            existing_runtime_credentials: 'Dieses lokale Home gehört zu einer anderen Happier-App auf diesem Computer.',
            personal_home_erased: 'Dein persönliches Home wurde gelöscht. Versuch es erneut, um ein neues zu erstellen.',
        },
        blockedBody: { personal_home_erased: 'Die Daten deines Homes wurden gelöscht. Hier gibt es nichts wiederherzustellen – erstelle ein neues persönliches Home oder nutze ein anderes Home.' },
    },
    es: {
        blocked: {
            runtime_unhealthy: 'Tu Home local necesita atención antes de poder iniciarse.',
            home_auth_invalid: 'La autenticación de tu Home necesita atención.',
            existing_runtime: 'Debes elegir qué hacer con el Home local existente antes de continuar la configuración.',
            existing_runtime_credentials: 'Este Home local pertenece a otra app de Happier en este ordenador.',
            personal_home_erased: 'Tu Home personal se eliminó. Inténtalo de nuevo para crear uno nuevo.',
        },
        blockedBody: { personal_home_erased: 'Se eliminaron los datos de tu Home. Aquí no queda nada que recuperar; crea un Home personal nuevo o usa otro Home.' },
    },
    fr: {
        blocked: {
            runtime_unhealthy: 'Ton Home local nécessite ton attention avant de pouvoir démarrer.',
            home_auth_invalid: 'L’authentification de ton Home nécessite ton attention.',
            existing_runtime: 'Tu dois choisir quoi faire du Home local existant avant de poursuivre la configuration.',
            existing_runtime_credentials: 'Ce Home local appartient à une autre app Happier sur cet ordinateur.',
            personal_home_erased: 'Ton Home personnel a été supprimé. Réessaie pour en créer un nouveau.',
        },
        blockedBody: { personal_home_erased: 'Les données de ton Home ont été supprimées. Il n’y a plus rien à récupérer ici ; crée un nouveau Home personnel ou utilise un autre Home.' },
    },
    it: {
        blocked: {
            runtime_unhealthy: 'Il tuo Home locale richiede attenzione prima di potersi avviare.',
            home_auth_invalid: 'L’autenticazione del tuo Home richiede attenzione.',
            existing_runtime: 'Devi decidere cosa fare dell’Home locale esistente prima di continuare la configurazione.',
            existing_runtime_credentials: 'Questo Home locale appartiene a un’altra app Happier su questo computer.',
            personal_home_erased: 'Il tuo Home personale è stato cancellato. Riprova per crearne uno nuovo.',
        },
        blockedBody: { personal_home_erased: 'I dati del tuo Home sono stati eliminati. Qui non c’è più nulla da recuperare: crea un nuovo Home personale o usa un altro Home.' },
    },
    pt: {
        blocked: {
            runtime_unhealthy: 'Seu Home local precisa de atenção antes de poder iniciar.',
            home_auth_invalid: 'A autenticação do seu Home precisa de atenção.',
            existing_runtime: 'Você precisa escolher o que fazer com o Home local existente antes de continuar a configuração.',
            existing_runtime_credentials: 'Este Home local pertence a outro app Happier neste computador.',
            personal_home_erased: 'Seu Home pessoal foi apagado. Tente novamente para criar um novo.',
        },
        blockedBody: { personal_home_erased: 'Os dados do seu Home foram excluídos. Não há nada para recuperar aqui — crie um novo Home pessoal ou use outro Home.' },
    },
    ca: {
        blocked: {
            runtime_unhealthy: 'El teu Home local necessita atenció abans de poder iniciar-se.',
            home_auth_invalid: 'L’autenticació del teu Home necessita atenció.',
            existing_runtime: 'Has de decidir què fer amb el Home local existent abans de continuar la configuració.',
            existing_runtime_credentials: 'Aquest Home local pertany a una altra app de Happier en aquest ordinador.',
            personal_home_erased: 'El teu Home personal s’ha esborrat. Torna-ho a provar per crear-ne un de nou.',
        },
        blockedBody: { personal_home_erased: 'Les dades del teu Home s’han suprimit. Aquí no queda res per recuperar: crea un Home personal nou o utilitza un altre Home.' },
    },
    pl: {
        blocked: {
            runtime_unhealthy: 'Twój lokalny Home wymaga uwagi, zanim będzie mógł się uruchomić.',
            home_auth_invalid: 'Uwierzytelnianie Twojego Home wymaga uwagi.',
            existing_runtime: 'Zanim konfiguracja będzie kontynuowana, musisz zdecydować, co zrobić z istniejącym lokalnym Home.',
            existing_runtime_credentials: 'Ten lokalny Home należy do innej aplikacji Happier na tym komputerze.',
            personal_home_erased: 'Twój osobisty Home został usunięty. Spróbuj ponownie, aby utworzyć nowy.',
        },
        blockedBody: { personal_home_erased: 'Dane Twojego Home zostały usunięte. Nie ma tu nic do odzyskania — utwórz nowy osobisty Home albo użyj innego Home.' },
    },
    ru: {
        blocked: {
            runtime_unhealthy: 'Ваш локальный Home требует внимания, прежде чем сможет запуститься.',
            home_auth_invalid: 'Аутентификация вашего Home требует внимания.',
            existing_runtime: 'Прежде чем продолжить настройку, решите, что делать с существующим локальным Home.',
            existing_runtime_credentials: 'Этот локальный Home принадлежит другому приложению Happier на этом компьютере.',
            personal_home_erased: 'Ваш личный Home был стёрт. Попробуйте ещё раз, чтобы создать новый.',
        },
        blockedBody: { personal_home_erased: 'Данные вашего Home удалены. Здесь нечего восстанавливать — создайте новый личный Home или используйте другой Home.' },
    },
    ja: {
        blocked: {
            runtime_unhealthy: 'ローカル Home を起動するには対応が必要です。',
            home_auth_invalid: 'Home の認証に対応が必要です。',
            existing_runtime: 'セットアップを続ける前に、既存のローカル Home をどうするか選択してください。',
            existing_runtime_credentials: 'このローカル Home は、このコンピューター上の別の Happier アプリのものです。',
            personal_home_erased: 'パーソナル Home は削除されました。もう一度試して新しく作成してください。',
        },
        blockedBody: { personal_home_erased: 'Home のデータは削除されました。ここに復元できるものはありません。新しいパーソナル Home を作成するか、別の Home を使ってください。' },
    },
    'zh-Hans': {
        blocked: {
            runtime_unhealthy: '本地 Home 需要处理后才能启动。',
            home_auth_invalid: '你的 Home 认证需要处理。',
            existing_runtime: '继续设置前，请选择如何处理现有的本地 Home。',
            existing_runtime_credentials: '此本地 Home 属于这台电脑上的另一个 Happier 应用。',
            personal_home_erased: '你的个人 Home 已被删除。请重试以创建新的个人 Home。',
        },
        blockedBody: { personal_home_erased: '你的 Home 数据已被删除。这里没有可恢复的内容；请创建新的个人 Home 或使用其他 Home。' },
    },
    'zh-Hant': {
        blocked: {
            runtime_unhealthy: '本地 Home 需要處理後才能啟動。',
            home_auth_invalid: '你的 Home 驗證需要處理。',
            existing_runtime: '繼續設定前，請選擇如何處理現有的本地 Home。',
            existing_runtime_credentials: '此本機 Home 屬於這台電腦上的另一個 Happier 應用程式。',
            personal_home_erased: '你的個人 Home 已被刪除。請重試以建立新的個人 Home。',
        },
        blockedBody: { personal_home_erased: '你的 Home 資料已被刪除。這裡沒有可復原的內容；請建立新的個人 Home 或使用其他 Home。' },
    },
} as const satisfies Record<string, PersonalHomeBootstrapBlockedTranslation>;
