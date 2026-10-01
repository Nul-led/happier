/**
 * Copy owned by the shared pane/surface state composition (`SurfaceStateCard`, `SurfaceFreshnessLine`,
 * the pane loader's failure): the live "still waiting" line, the freshness line's "as of", the quiet
 * "How it works" link, and a pane that failed to open.
 */
type SurfaceStateTranslations = Readonly<{
    stillWaiting: (params: Readonly<{ seconds: number }>) => string;
    asOf: (params: Readonly<{ time: string }>) => string;
    howItWorks: string;
    tryAgain: string;
    checkAgain: string;
    paneFailedTitle: string;
    paneFailedReason: string;
    opening: (params: Readonly<{ name: string }>) => string;
    couldNotOpen: (params: Readonly<{ name: string }>) => string;
}>;

export const surfaceStateTranslations = {
    en: {
        stillWaiting: ({ seconds }) => `Still waiting · ${seconds} s`,
        asOf: ({ time }) => `As of ${time}`,
        howItWorks: 'How it works',
        tryAgain: 'Try again',
        checkAgain: 'Check again',
        paneFailedTitle: 'Couldn’t show this pane',
        paneFailedReason: 'Something went wrong while drawing it. Your session isn’t affected.',
        opening: ({ name }) => `Opening ${name}`,
        couldNotOpen: ({ name }) => `Couldn’t open ${name}`,
    },
    de: {
        stillWaiting: ({ seconds }) => `Warte noch · ${seconds} s`,
        asOf: ({ time }) => `Stand ${time}`,
        howItWorks: 'So funktioniert es',
        tryAgain: 'Erneut versuchen',
        checkAgain: 'Erneut prüfen',
        paneFailedTitle: 'Dieser Bereich konnte nicht angezeigt werden',
        paneFailedReason: 'Beim Darstellen ist etwas schiefgelaufen. Deine Sitzung ist nicht betroffen.',
        opening: ({ name }) => `${name} wird geöffnet`,
        couldNotOpen: ({ name }) => `${name} konnte nicht geöffnet werden`,
    },
    fr: {
        stillWaiting: ({ seconds }) => `Toujours en attente · ${seconds} s`,
        asOf: ({ time }) => `À ${time}`,
        howItWorks: 'Comment ça marche',
        tryAgain: 'Réessayer',
        checkAgain: 'Vérifier à nouveau',
        paneFailedTitle: 'Impossible d’afficher ce panneau',
        paneFailedReason: 'Un problème est survenu pendant l’affichage. Votre session n’est pas affectée.',
        opening: ({ name }) => `Ouverture de ${name}`,
        couldNotOpen: ({ name }) => `Impossible d’ouvrir ${name}`,
    },
    ru: {
        stillWaiting: ({ seconds }) => `Всё ещё ждём · ${seconds} с`,
        asOf: ({ time }) => `На ${time}`,
        howItWorks: 'Как это работает',
        tryAgain: 'Повторить',
        checkAgain: 'Проверить снова',
        paneFailedTitle: 'Не удалось показать эту панель',
        paneFailedReason: 'При отрисовке что-то пошло не так. Ваша сессия не затронута.',
        opening: ({ name }) => `Открываем ${name}`,
        couldNotOpen: ({ name }) => `Не удалось открыть ${name}`,
    },
    pl: {
        stillWaiting: ({ seconds }) => `Wciąż czekamy · ${seconds} s`,
        asOf: ({ time }) => `Stan na ${time}`,
        howItWorks: 'Jak to działa',
        tryAgain: 'Spróbuj ponownie',
        checkAgain: 'Sprawdź ponownie',
        paneFailedTitle: 'Nie udało się wyświetlić tego panelu',
        paneFailedReason: 'Coś poszło nie tak podczas rysowania. Twoja sesja nie jest zagrożona.',
        opening: ({ name }) => `Otwieranie ${name}`,
        couldNotOpen: ({ name }) => `Nie udało się otworzyć ${name}`,
    },
    es: {
        stillWaiting: ({ seconds }) => `Seguimos esperando · ${seconds} s`,
        asOf: ({ time }) => `A las ${time}`,
        howItWorks: 'Cómo funciona',
        tryAgain: 'Reintentar',
        checkAgain: 'Volver a comprobar',
        paneFailedTitle: 'No se pudo mostrar este panel',
        paneFailedReason: 'Algo salió mal al dibujarlo. Tu sesión no se ve afectada.',
        opening: ({ name }) => `Abriendo ${name}`,
        couldNotOpen: ({ name }) => `No se pudo abrir ${name}`,
    },
    it: {
        stillWaiting: ({ seconds }) => `Ancora in attesa · ${seconds} s`,
        asOf: ({ time }) => `Alle ${time}`,
        howItWorks: 'Come funziona',
        tryAgain: 'Riprova',
        checkAgain: 'Controlla di nuovo',
        paneFailedTitle: 'Impossibile mostrare questo pannello',
        paneFailedReason: 'Qualcosa è andato storto durante la visualizzazione. La tua sessione non è interessata.',
        opening: ({ name }) => `Apertura di ${name}`,
        couldNotOpen: ({ name }) => `Impossibile aprire ${name}`,
    },
    pt: {
        stillWaiting: ({ seconds }) => `Ainda aguardando · ${seconds} s`,
        asOf: ({ time }) => `Às ${time}`,
        howItWorks: 'Como funciona',
        tryAgain: 'Tentar novamente',
        checkAgain: 'Verificar novamente',
        paneFailedTitle: 'Não foi possível mostrar este painel',
        paneFailedReason: 'Algo deu errado ao desenhá-lo. Sua sessão não foi afetada.',
        opening: ({ name }) => `Abrindo ${name}`,
        couldNotOpen: ({ name }) => `Não foi possível abrir ${name}`,
    },
    ca: {
        stillWaiting: ({ seconds }) => `Encara esperant · ${seconds} s`,
        asOf: ({ time }) => `A les ${time}`,
        howItWorks: 'Com funciona',
        tryAgain: 'Torna-ho a provar',
        checkAgain: 'Torna a comprovar',
        paneFailedTitle: 'No s’ha pogut mostrar aquest panell',
        paneFailedReason: 'Alguna cosa ha fallat en dibuixar-lo. La teva sessió no se’n veu afectada.',
        opening: ({ name }) => `Obrint ${name}`,
        couldNotOpen: ({ name }) => `No s’ha pogut obrir ${name}`,
    },
    'zh-Hans': {
        stillWaiting: ({ seconds }) => `仍在等待 · ${seconds} 秒`,
        asOf: ({ time }) => `截至 ${time}`,
        howItWorks: '了解原理',
        tryAgain: '重试',
        checkAgain: '再次检查',
        paneFailedTitle: '无法显示此面板',
        paneFailedReason: '绘制时出了问题。你的会话不受影响。',
        opening: ({ name }) => `正在打开 ${name}`,
        couldNotOpen: ({ name }) => `无法打开 ${name}`,
    },
    'zh-Hant': {
        stillWaiting: ({ seconds }) => `仍在等待 · ${seconds} 秒`,
        asOf: ({ time }) => `截至 ${time}`,
        howItWorks: '了解運作方式',
        tryAgain: '重試',
        checkAgain: '再次檢查',
        paneFailedTitle: '無法顯示此面板',
        paneFailedReason: '繪製時出了問題。你的工作階段不受影響。',
        opening: ({ name }) => `正在開啟 ${name}`,
        couldNotOpen: ({ name }) => `無法開啟 ${name}`,
    },
    ja: {
        stillWaiting: ({ seconds }) => `待機中 · ${seconds} 秒`,
        asOf: ({ time }) => `${time} 時点`,
        howItWorks: '仕組み',
        tryAgain: '再試行',
        checkAgain: 'もう一度確認',
        paneFailedTitle: 'このパネルを表示できませんでした',
        paneFailedReason: '描画中に問題が発生しました。セッションには影響ありません。',
        opening: ({ name }) => `${name} を開いています`,
        couldNotOpen: ({ name }) => `${name} を開けませんでした`,
    },
} as const satisfies Record<string, SurfaceStateTranslations>;
