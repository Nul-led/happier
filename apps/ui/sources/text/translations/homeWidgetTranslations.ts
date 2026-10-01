/** Widgets on Home: the host frame's footer and the built-in Automations · Latest runs widget. */
type HomeWidgetTranslation = Readonly<{
    /** The frame's footer row: where the widget leads. */
    open: (params: Readonly<{ destination: string }>) => string;
    /** The stale footer: last-known rows are shown because the refresh did not answer. */
    refreshFailed: string;
    latestRunsTitle: string;
    latestRunsLoading: string;
    latestRunsEmptyTitle: string;
    latestRunsEmptyReason: string;
    latestRunsErrorTitle: string;
    latestRunsErrorReason: string;
}>;

export const homeWidgetTranslations = {
    en: {
        open: ({ destination }) => `Open ${destination}`,
        refreshFailed: 'Couldn’t refresh',
        latestRunsTitle: 'Latest runs',
        latestRunsLoading: 'Loading the latest runs',
        latestRunsEmptyTitle: 'No runs yet',
        latestRunsEmptyReason: 'When your automations run, how each run went shows up here.',
        latestRunsErrorTitle: 'Couldn’t load the latest runs',
        latestRunsErrorReason: 'Your Home didn’t answer. Check the connection, then try again.',
    },
    ru: {
        open: ({ destination }) => `Открыть: ${destination}`,
        refreshFailed: 'Не удалось обновить',
        latestRunsTitle: 'Последние запуски',
        latestRunsLoading: 'Загрузка последних запусков',
        latestRunsEmptyTitle: 'Запусков пока нет',
        latestRunsEmptyReason: 'Когда ваши автоматизации запустятся, здесь появится результат каждого запуска.',
        latestRunsErrorTitle: 'Не удалось загрузить последние запуски',
        latestRunsErrorReason: 'Ваш Home не ответил. Проверьте подключение и повторите попытку.',
    },
    pl: {
        open: ({ destination }) => `Otwórz: ${destination}`,
        refreshFailed: 'Nie udało się odświeżyć',
        latestRunsTitle: 'Ostatnie uruchomienia',
        latestRunsLoading: 'Wczytywanie ostatnich uruchomień',
        latestRunsEmptyTitle: 'Brak uruchomień',
        latestRunsEmptyReason: 'Gdy Twoje automatyzacje się uruchomią, tutaj zobaczysz wynik każdego uruchomienia.',
        latestRunsErrorTitle: 'Nie udało się wczytać ostatnich uruchomień',
        latestRunsErrorReason: 'Twój Home nie odpowiedział. Sprawdź połączenie i spróbuj ponownie.',
    },
    es: {
        open: ({ destination }) => `Abrir ${destination}`,
        refreshFailed: 'No se pudo actualizar',
        latestRunsTitle: 'Últimas ejecuciones',
        latestRunsLoading: 'Cargando las últimas ejecuciones',
        latestRunsEmptyTitle: 'Aún no hay ejecuciones',
        latestRunsEmptyReason: 'Cuando tus automatizaciones se ejecuten, aquí verás cómo fue cada ejecución.',
        latestRunsErrorTitle: 'No se pudieron cargar las últimas ejecuciones',
        latestRunsErrorReason: 'Tu Home no respondió. Comprueba la conexión y vuelve a intentarlo.',
    },
    fr: {
        open: ({ destination }) => `Ouvrir ${destination}`,
        refreshFailed: 'Actualisation impossible',
        latestRunsTitle: 'Dernières exécutions',
        latestRunsLoading: 'Chargement des dernières exécutions',
        latestRunsEmptyTitle: 'Aucune exécution pour l’instant',
        latestRunsEmptyReason: 'Quand vos automatisations s’exécutent, le résultat de chaque exécution s’affiche ici.',
        latestRunsErrorTitle: 'Impossible de charger les dernières exécutions',
        latestRunsErrorReason: 'Votre Home n’a pas répondu. Vérifiez la connexion, puis réessayez.',
    },
    it: {
        open: ({ destination }) => `Apri ${destination}`,
        refreshFailed: 'Impossibile aggiornare',
        latestRunsTitle: 'Ultime esecuzioni',
        latestRunsLoading: 'Caricamento delle ultime esecuzioni',
        latestRunsEmptyTitle: 'Ancora nessuna esecuzione',
        latestRunsEmptyReason: 'Quando le tue automazioni vengono eseguite, qui vedrai com’è andata ogni esecuzione.',
        latestRunsErrorTitle: 'Impossibile caricare le ultime esecuzioni',
        latestRunsErrorReason: 'La tua Home non ha risposto. Controlla la connessione e riprova.',
    },
    pt: {
        open: ({ destination }) => `Abrir ${destination}`,
        refreshFailed: 'Não foi possível atualizar',
        latestRunsTitle: 'Últimas execuções',
        latestRunsLoading: 'Carregando as últimas execuções',
        latestRunsEmptyTitle: 'Ainda não há execuções',
        latestRunsEmptyReason: 'Quando suas automações forem executadas, você verá aqui como foi cada execução.',
        latestRunsErrorTitle: 'Não foi possível carregar as últimas execuções',
        latestRunsErrorReason: 'Sua Home não respondeu. Verifique a conexão e tente novamente.',
    },
    ca: {
        open: ({ destination }) => `Obre ${destination}`,
        refreshFailed: 'No s’ha pogut actualitzar',
        latestRunsTitle: 'Darreres execucions',
        latestRunsLoading: 'S’estan carregant les darreres execucions',
        latestRunsEmptyTitle: 'Encara no hi ha execucions',
        latestRunsEmptyReason: 'Quan les teves automatitzacions s’executin, aquí veuràs com ha anat cada execució.',
        latestRunsErrorTitle: 'No s’han pogut carregar les darreres execucions',
        latestRunsErrorReason: 'La teva Home no ha respost. Comprova la connexió i torna-ho a provar.',
    },
    de: {
        open: ({ destination }) => `${destination} öffnen`,
        refreshFailed: 'Aktualisieren fehlgeschlagen',
        latestRunsTitle: 'Letzte Ausführungen',
        latestRunsLoading: 'Letzte Ausführungen werden geladen',
        latestRunsEmptyTitle: 'Noch keine Ausführungen',
        latestRunsEmptyReason: 'Sobald deine Automationen laufen, siehst du hier, wie jede Ausführung verlaufen ist.',
        latestRunsErrorTitle: 'Letzte Ausführungen konnten nicht geladen werden',
        latestRunsErrorReason: 'Dein Home hat nicht geantwortet. Prüfe die Verbindung und versuche es erneut.',
    },
    'zh-Hans': {
        open: ({ destination }) => `打开${destination}`,
        refreshFailed: '无法刷新',
        latestRunsTitle: '最近运行',
        latestRunsLoading: '正在加载最近运行',
        latestRunsEmptyTitle: '还没有运行记录',
        latestRunsEmptyReason: '你的自动化运行后，每次运行的结果都会显示在这里。',
        latestRunsErrorTitle: '无法加载最近运行',
        latestRunsErrorReason: '你的 Home 没有响应。请检查连接后重试。',
    },
    'zh-Hant': {
        open: ({ destination }) => `開啟${destination}`,
        refreshFailed: '無法重新整理',
        latestRunsTitle: '最近執行',
        latestRunsLoading: '正在載入最近執行',
        latestRunsEmptyTitle: '尚無執行紀錄',
        latestRunsEmptyReason: '你的自動化執行後，每次執行的結果都會顯示在這裡。',
        latestRunsErrorTitle: '無法載入最近執行',
        latestRunsErrorReason: '你的 Home 沒有回應。請檢查連線後再試一次。',
    },
    ja: {
        open: ({ destination }) => `${destination}を開く`,
        refreshFailed: '更新できませんでした',
        latestRunsTitle: '最近の実行',
        latestRunsLoading: '最近の実行を読み込んでいます',
        latestRunsEmptyTitle: 'まだ実行はありません',
        latestRunsEmptyReason: 'オートメーションが実行されると、各実行の結果がここに表示されます。',
        latestRunsErrorTitle: '最近の実行を読み込めませんでした',
        latestRunsErrorReason: 'Home から応答がありません。接続を確認して、もう一度お試しください。',
    },
} satisfies Readonly<Record<string, HomeWidgetTranslation>>;
