/**
 * Copy for the session's new pull request (Git lab PR / PRD): the form in the Git sidebar or a Details pane, the
 * card a created pull request becomes, the form's failures, and the placement setting.
 */
type ProviderArgs = { provider: string };

const en = {
    form: {
        title: 'New pull request',
        expand: 'Open in a Details pane',
        moveBack: 'Move back to the sidebar',
        close: 'Close the form (the draft is kept)',
        base: 'Merges into',
        titlePlaceholder: 'Title',
        bodyPlaceholder: 'What changed and why',
        draft: 'Draft',
        create: 'Create pull request',
        creating: 'Creating…',
        continueOn: ({ provider }: ProviderArgs) => `Continue on ${provider}`,
        pointer: 'The new pull request is open in Details',
        pointerShow: 'Show',
        openedProviderPage: ({ provider }: ProviderArgs) => `${provider} is open to finish it; your text is kept here.`,
    },
    failure: {
        authFailed: ({ provider }: ProviderArgs) => `${provider} didn’t accept the sign-in from this machine`,
        network: ({ provider }: ProviderArgs) => `Couldn’t reach ${provider}`,
        machineOffline: 'The machine is offline; your draft is kept',
        blocked: 'Another Git operation is running; try again when it finishes',
        other: 'The pull request wasn’t created',
    },
    card: {
        number: ({ number }: { number: number }) => `#${number}`,
        intoBase: ({ base }: { base: string }) => `into ${base}`,
        state: { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed', unknown: 'Pull request' },
        checks: { pending: 'Checks running', success: 'Checks passed', failure: 'Checks failed', unknown: 'Checks' },
        openOn: ({ provider }: ProviderArgs) => `Open on ${provider}`,
        copyLink: 'Copy link',
        copied: 'Link copied',
    },
    settings: {
        placementTitle: 'Open new pull requests in',
        placementDescription: 'On a phone the form always opens as its own page.',
        sidebar: 'Sidebar',
        details: 'Details pane',
    },
};

type GitPullRequestCopy = typeof en;

const ca: GitPullRequestCopy = {
    form: {
        title: 'Nova pull request', expand: 'Obre en un panell de detalls', moveBack: 'Torna-la a la barra lateral',
        close: 'Tanca el formulari (l’esborrany es conserva)', base: 'Es fusiona a', titlePlaceholder: 'Títol',
        bodyPlaceholder: 'Què ha canviat i per què', draft: 'Esborrany', create: 'Crea la pull request', creating: 'Creant…',
        continueOn: ({ provider }) => `Continua a ${provider}`, pointer: 'La nova pull request és oberta a Detalls', pointerShow: 'Mostra',
        openedProviderPage: ({ provider }) => `${provider} és obert per acabar-la; el teu text es conserva aquí.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} no ha acceptat l’inici de sessió d’aquesta màquina`,
        network: ({ provider }) => `No s’ha pogut connectar amb ${provider}`,
        machineOffline: 'La màquina està fora de línia; l’esborrany es conserva',
        blocked: 'Hi ha una altra operació de Git en curs; torna-ho a provar quan acabi',
        other: 'No s’ha creat la pull request',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `a ${base}`,
        state: { open: 'Oberta', draft: 'Esborrany', merged: 'Fusionada', closed: 'Tancada', unknown: 'Pull request' },
        checks: { pending: 'Comprovacions en curs', success: 'Comprovacions correctes', failure: 'Comprovacions fallides', unknown: 'Comprovacions' },
        openOn: ({ provider }) => `Obre a ${provider}`, copyLink: 'Copia l’enllaç', copied: 'Enllaç copiat',
    },
    settings: {
        placementTitle: 'Obre les noves pull requests a', placementDescription: 'En un telèfon el formulari sempre s’obre com a pàgina pròpia.',
        sidebar: 'Barra lateral', details: 'Panell de detalls',
    },
};

const de: GitPullRequestCopy = {
    form: {
        title: 'Neuer Pull Request', expand: 'In einem Detailbereich öffnen', moveBack: 'Zurück in die Seitenleiste',
        close: 'Formular schließen (der Entwurf bleibt erhalten)', base: 'Wird gemergt in', titlePlaceholder: 'Titel',
        bodyPlaceholder: 'Was sich geändert hat und warum', draft: 'Entwurf', create: 'Pull Request erstellen', creating: 'Wird erstellt…',
        continueOn: ({ provider }) => `Weiter auf ${provider}`, pointer: 'Der neue Pull Request ist in Details geöffnet', pointerShow: 'Zeigen',
        openedProviderPage: ({ provider }) => `${provider} ist zum Abschließen geöffnet; dein Text bleibt hier erhalten.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} hat die Anmeldung dieses Rechners nicht akzeptiert`,
        network: ({ provider }) => `${provider} war nicht erreichbar`,
        machineOffline: 'Der Rechner ist offline; dein Entwurf bleibt erhalten',
        blocked: 'Ein anderer Git-Vorgang läuft; versuche es danach erneut',
        other: 'Der Pull Request wurde nicht erstellt',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `in ${base}`,
        state: { open: 'Offen', draft: 'Entwurf', merged: 'Gemergt', closed: 'Geschlossen', unknown: 'Pull Request' },
        checks: { pending: 'Checks laufen', success: 'Checks bestanden', failure: 'Checks fehlgeschlagen', unknown: 'Checks' },
        openOn: ({ provider }) => `Auf ${provider} öffnen`, copyLink: 'Link kopieren', copied: 'Link kopiert',
    },
    settings: {
        placementTitle: 'Neue Pull Requests öffnen in', placementDescription: 'Auf einem Telefon öffnet sich das Formular immer als eigene Seite.',
        sidebar: 'Seitenleiste', details: 'Detailbereich',
    },
};

const es: GitPullRequestCopy = {
    form: {
        title: 'Nueva pull request', expand: 'Abrir en un panel de detalles', moveBack: 'Volver a la barra lateral',
        close: 'Cerrar el formulario (el borrador se conserva)', base: 'Se fusiona en', titlePlaceholder: 'Título',
        bodyPlaceholder: 'Qué cambió y por qué', draft: 'Borrador', create: 'Crear pull request', creating: 'Creando…',
        continueOn: ({ provider }) => `Continuar en ${provider}`, pointer: 'La nueva pull request está abierta en Detalles', pointerShow: 'Mostrar',
        openedProviderPage: ({ provider }) => `${provider} está abierto para terminarla; tu texto se conserva aquí.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} no aceptó el inicio de sesión de esta máquina`,
        network: ({ provider }) => `No se pudo conectar con ${provider}`,
        machineOffline: 'La máquina está sin conexión; tu borrador se conserva',
        blocked: 'Hay otra operación de Git en curso; inténtalo cuando termine',
        other: 'No se creó la pull request',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `en ${base}`,
        state: { open: 'Abierta', draft: 'Borrador', merged: 'Fusionada', closed: 'Cerrada', unknown: 'Pull request' },
        checks: { pending: 'Comprobaciones en curso', success: 'Comprobaciones correctas', failure: 'Comprobaciones fallidas', unknown: 'Comprobaciones' },
        openOn: ({ provider }) => `Abrir en ${provider}`, copyLink: 'Copiar enlace', copied: 'Enlace copiado',
    },
    settings: {
        placementTitle: 'Abrir nuevas pull requests en', placementDescription: 'En un teléfono el formulario siempre se abre como su propia página.',
        sidebar: 'Barra lateral', details: 'Panel de detalles',
    },
};

const fr: GitPullRequestCopy = {
    form: {
        title: 'Nouvelle pull request', expand: 'Ouvrir dans un panneau de détails', moveBack: 'Remettre dans la barre latérale',
        close: 'Fermer le formulaire (le brouillon est conservé)', base: 'Fusionnée dans', titlePlaceholder: 'Titre',
        bodyPlaceholder: 'Ce qui a changé et pourquoi', draft: 'Brouillon', create: 'Créer la pull request', creating: 'Création…',
        continueOn: ({ provider }) => `Continuer sur ${provider}`, pointer: 'La nouvelle pull request est ouverte dans Détails', pointerShow: 'Afficher',
        openedProviderPage: ({ provider }) => `${provider} est ouvert pour la terminer ; votre texte reste ici.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} n’a pas accepté la connexion de cette machine`,
        network: ({ provider }) => `Impossible de joindre ${provider}`,
        machineOffline: 'La machine est hors ligne ; votre brouillon est conservé',
        blocked: 'Une autre opération Git est en cours ; réessayez quand elle sera terminée',
        other: 'La pull request n’a pas été créée',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `dans ${base}`,
        state: { open: 'Ouverte', draft: 'Brouillon', merged: 'Fusionnée', closed: 'Fermée', unknown: 'Pull request' },
        checks: { pending: 'Vérifications en cours', success: 'Vérifications réussies', failure: 'Vérifications échouées', unknown: 'Vérifications' },
        openOn: ({ provider }) => `Ouvrir sur ${provider}`, copyLink: 'Copier le lien', copied: 'Lien copié',
    },
    settings: {
        placementTitle: 'Ouvrir les nouvelles pull requests dans', placementDescription: 'Sur un téléphone, le formulaire s’ouvre toujours dans sa propre page.',
        sidebar: 'Barre latérale', details: 'Panneau de détails',
    },
};

const it: GitPullRequestCopy = {
    form: {
        title: 'Nuova pull request', expand: 'Apri in un pannello dei dettagli', moveBack: 'Riporta nella barra laterale',
        close: 'Chiudi il modulo (la bozza resta)', base: 'Si unisce a', titlePlaceholder: 'Titolo',
        bodyPlaceholder: 'Cosa è cambiato e perché', draft: 'Bozza', create: 'Crea pull request', creating: 'Creazione…',
        continueOn: ({ provider }) => `Continua su ${provider}`, pointer: 'La nuova pull request è aperta in Dettagli', pointerShow: 'Mostra',
        openedProviderPage: ({ provider }) => `${provider} è aperto per completarla; il tuo testo resta qui.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} non ha accettato l’accesso da questa macchina`,
        network: ({ provider }) => `Impossibile raggiungere ${provider}`,
        machineOffline: 'La macchina è offline; la bozza resta',
        blocked: 'È in corso un’altra operazione Git; riprova quando finisce',
        other: 'La pull request non è stata creata',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `in ${base}`,
        state: { open: 'Aperta', draft: 'Bozza', merged: 'Unita', closed: 'Chiusa', unknown: 'Pull request' },
        checks: { pending: 'Controlli in corso', success: 'Controlli superati', failure: 'Controlli non superati', unknown: 'Controlli' },
        openOn: ({ provider }) => `Apri su ${provider}`, copyLink: 'Copia link', copied: 'Link copiato',
    },
    settings: {
        placementTitle: 'Apri le nuove pull request in', placementDescription: 'Su un telefono il modulo si apre sempre come pagina a sé.',
        sidebar: 'Barra laterale', details: 'Pannello dei dettagli',
    },
};

const ja: GitPullRequestCopy = {
    form: {
        title: '新しいプルリクエスト', expand: '詳細ペインで開く', moveBack: 'サイドバーに戻す',
        close: 'フォームを閉じる（下書きは保持されます）', base: 'マージ先', titlePlaceholder: 'タイトル',
        bodyPlaceholder: '何をなぜ変更したか', draft: '下書き', create: 'プルリクエストを作成', creating: '作成中…',
        continueOn: ({ provider }) => `${provider} で続ける`, pointer: '新しいプルリクエストは詳細で開いています', pointerShow: '表示',
        openedProviderPage: ({ provider }) => `${provider} で仕上げられるように開きました。テキストはここに残っています。`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} がこのマシンからのサインインを受け付けませんでした`,
        network: ({ provider }) => `${provider} に接続できませんでした`,
        machineOffline: 'マシンがオフラインです。下書きは保持されます',
        blocked: '別の Git 操作が実行中です。終わってから再試行してください',
        other: 'プルリクエストは作成されませんでした',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `${base} へ`,
        state: { open: 'オープン', draft: '下書き', merged: 'マージ済み', closed: 'クローズ', unknown: 'プルリクエスト' },
        checks: { pending: 'チェック実行中', success: 'チェック成功', failure: 'チェック失敗', unknown: 'チェック' },
        openOn: ({ provider }) => `${provider} で開く`, copyLink: 'リンクをコピー', copied: 'リンクをコピーしました',
    },
    settings: {
        placementTitle: '新しいプルリクエストを開く場所', placementDescription: 'スマートフォンでは常に専用ページで開きます。',
        sidebar: 'サイドバー', details: '詳細ペイン',
    },
};

const pl: GitPullRequestCopy = {
    form: {
        title: 'Nowy pull request', expand: 'Otwórz w panelu szczegółów', moveBack: 'Przenieś z powrotem na pasek boczny',
        close: 'Zamknij formularz (szkic zostaje)', base: 'Scalany do', titlePlaceholder: 'Tytuł',
        bodyPlaceholder: 'Co się zmieniło i dlaczego', draft: 'Szkic', create: 'Utwórz pull request', creating: 'Tworzenie…',
        continueOn: ({ provider }) => `Kontynuuj w ${provider}`, pointer: 'Nowy pull request jest otwarty w Szczegółach', pointerShow: 'Pokaż',
        openedProviderPage: ({ provider }) => `${provider} jest otwarty, by go dokończyć; twój tekst zostaje tutaj.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} nie zaakceptował logowania z tej maszyny`,
        network: ({ provider }) => `Nie można połączyć się z ${provider}`,
        machineOffline: 'Maszyna jest offline; szkic zostaje',
        blocked: 'Trwa inna operacja Git; spróbuj ponownie, gdy się skończy',
        other: 'Pull request nie został utworzony',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `do ${base}`,
        state: { open: 'Otwarty', draft: 'Szkic', merged: 'Scalony', closed: 'Zamknięty', unknown: 'Pull request' },
        checks: { pending: 'Sprawdzenia trwają', success: 'Sprawdzenia zaliczone', failure: 'Sprawdzenia nieudane', unknown: 'Sprawdzenia' },
        openOn: ({ provider }) => `Otwórz w ${provider}`, copyLink: 'Kopiuj link', copied: 'Skopiowano link',
    },
    settings: {
        placementTitle: 'Otwieraj nowe pull requesty w', placementDescription: 'Na telefonie formularz zawsze otwiera się jako osobna strona.',
        sidebar: 'Pasek boczny', details: 'Panel szczegółów',
    },
};

const pt: GitPullRequestCopy = {
    form: {
        title: 'Nova pull request', expand: 'Abrir num painel de detalhes', moveBack: 'Voltar para a barra lateral',
        close: 'Fechar o formulário (o rascunho é mantido)', base: 'Faz merge em', titlePlaceholder: 'Título',
        bodyPlaceholder: 'O que mudou e porquê', draft: 'Rascunho', create: 'Criar pull request', creating: 'A criar…',
        continueOn: ({ provider }) => `Continuar no ${provider}`, pointer: 'A nova pull request está aberta em Detalhes', pointerShow: 'Mostrar',
        openedProviderPage: ({ provider }) => `O ${provider} está aberto para a concluir; o seu texto fica aqui.`,
    },
    failure: {
        authFailed: ({ provider }) => `O ${provider} não aceitou o início de sessão desta máquina`,
        network: ({ provider }) => `Não foi possível contactar o ${provider}`,
        machineOffline: 'A máquina está offline; o rascunho é mantido',
        blocked: 'Outra operação Git está em curso; tente novamente quando terminar',
        other: 'A pull request não foi criada',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `para ${base}`,
        state: { open: 'Aberta', draft: 'Rascunho', merged: 'Com merge', closed: 'Fechada', unknown: 'Pull request' },
        checks: { pending: 'Verificações em curso', success: 'Verificações aprovadas', failure: 'Verificações falhadas', unknown: 'Verificações' },
        openOn: ({ provider }) => `Abrir no ${provider}`, copyLink: 'Copiar link', copied: 'Link copiado',
    },
    settings: {
        placementTitle: 'Abrir novas pull requests em', placementDescription: 'Num telemóvel, o formulário abre sempre como página própria.',
        sidebar: 'Barra lateral', details: 'Painel de detalhes',
    },
};

const ru: GitPullRequestCopy = {
    form: {
        title: 'Новый pull request', expand: 'Открыть в панели деталей', moveBack: 'Вернуть в боковую панель',
        close: 'Закрыть форму (черновик сохранится)', base: 'Слияние в', titlePlaceholder: 'Заголовок',
        bodyPlaceholder: 'Что изменилось и почему', draft: 'Черновик', create: 'Создать pull request', creating: 'Создание…',
        continueOn: ({ provider }) => `Продолжить в ${provider}`, pointer: 'Новый pull request открыт в деталях', pointerShow: 'Показать',
        openedProviderPage: ({ provider }) => `${provider} открыт, чтобы закончить; ваш текст сохранён здесь.`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} не принял вход с этой машины`,
        network: ({ provider }) => `Не удалось связаться с ${provider}`,
        machineOffline: 'Машина не в сети; черновик сохранён',
        blocked: 'Выполняется другая операция Git; попробуйте, когда она завершится',
        other: 'Pull request не создан',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `в ${base}`,
        state: { open: 'Открыт', draft: 'Черновик', merged: 'Слит', closed: 'Закрыт', unknown: 'Pull request' },
        checks: { pending: 'Проверки идут', success: 'Проверки пройдены', failure: 'Проверки не пройдены', unknown: 'Проверки' },
        openOn: ({ provider }) => `Открыть в ${provider}`, copyLink: 'Копировать ссылку', copied: 'Ссылка скопирована',
    },
    settings: {
        placementTitle: 'Открывать новые pull requests в', placementDescription: 'На телефоне форма всегда открывается отдельной страницей.',
        sidebar: 'Боковой панели', details: 'Панели деталей',
    },
};

const zhHans: GitPullRequestCopy = {
    form: {
        title: '新建拉取请求', expand: '在详情面板中打开', moveBack: '移回侧边栏',
        close: '关闭表单（草稿会保留）', base: '合并到', titlePlaceholder: '标题',
        bodyPlaceholder: '改了什么，为什么改', draft: '草稿', create: '创建拉取请求', creating: '正在创建…',
        continueOn: ({ provider }) => `在 ${provider} 上继续`, pointer: '新的拉取请求已在详情中打开', pointerShow: '显示',
        openedProviderPage: ({ provider }) => `已打开 ${provider} 以完成它；你的文字保留在这里。`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} 未接受这台机器的登录`,
        network: ({ provider }) => `无法连接 ${provider}`,
        machineOffline: '机器已离线；草稿会保留',
        blocked: '另一个 Git 操作正在进行；完成后再试',
        other: '拉取请求未创建',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `合并到 ${base}`,
        state: { open: '打开', draft: '草稿', merged: '已合并', closed: '已关闭', unknown: '拉取请求' },
        checks: { pending: '检查进行中', success: '检查通过', failure: '检查失败', unknown: '检查' },
        openOn: ({ provider }) => `在 ${provider} 上打开`, copyLink: '复制链接', copied: '链接已复制',
    },
    settings: {
        placementTitle: '新拉取请求打开位置', placementDescription: '在手机上，表单总是以独立页面打开。',
        sidebar: '侧边栏', details: '详情面板',
    },
};

const zhHant: GitPullRequestCopy = {
    form: {
        title: '新增拉取請求', expand: '在詳細資料面板中開啟', moveBack: '移回側邊欄',
        close: '關閉表單（草稿會保留）', base: '合併到', titlePlaceholder: '標題',
        bodyPlaceholder: '改了什麼，為什麼改', draft: '草稿', create: '建立拉取請求', creating: '正在建立…',
        continueOn: ({ provider }) => `在 ${provider} 上繼續`, pointer: '新的拉取請求已在詳細資料中開啟', pointerShow: '顯示',
        openedProviderPage: ({ provider }) => `已開啟 ${provider} 以完成它；你的文字保留在這裡。`,
    },
    failure: {
        authFailed: ({ provider }) => `${provider} 未接受這台機器的登入`,
        network: ({ provider }) => `無法連線到 ${provider}`,
        machineOffline: '機器已離線；草稿會保留',
        blocked: '另一個 Git 操作正在進行；完成後再試',
        other: '拉取請求未建立',
    },
    card: {
        number: ({ number }) => `#${number}`, intoBase: ({ base }) => `合併到 ${base}`,
        state: { open: '開啟', draft: '草稿', merged: '已合併', closed: '已關閉', unknown: '拉取請求' },
        checks: { pending: '檢查進行中', success: '檢查通過', failure: '檢查失敗', unknown: '檢查' },
        openOn: ({ provider }) => `在 ${provider} 上開啟`, copyLink: '複製連結', copied: '連結已複製',
    },
    settings: {
        placementTitle: '新拉取請求開啟位置', placementDescription: '在手機上，表單一律以獨立頁面開啟。',
        sidebar: '側邊欄', details: '詳細資料面板',
    },
};

export const sessionGitPullRequestTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
