/**
 * Copy for detail and collection pages outside Settings that use the configuration-page anatomy
 * (approval detail, all runs, a person's profile, managing friends): page purpose lines and section
 * titles/descriptions.
 */
type DetailPageTranslations = Readonly<{
    approval: Readonly<{
        requestTitle: string;
        requestDescription: string;
        failureTitle: string;
        homeUnavailableTitle: string;
        contextTitle: string;
        contextDescription: string;
        proposalsDescription: string;
    }>;
    runs: Readonly<{
        description: string;
        filterLabel: string;
        filterRunning: string;
        filterAll: string;
        onHome: (params: Readonly<{ home: string }>) => string;
    }>;
    person: Readonly<{
        placeholderTitle: string;
        friendshipTitle: string;
        sharedSessionsDescription: string;
        linkedAccountsTitle: string;
        linkedAccountsDescription: string;
    }>;
    friendsManage: Readonly<{
        description: string;
        requestsTitle: string;
        requestsDescription: string;
        sentTitle: string;
        sentDescription: string;
        friendsTitle: string;
        friendsDescription: string;
    }>;
}>;

export const detailPageTranslations = {
    en: {
        approval: {
            requestTitle: 'Request',
            requestDescription: 'What was asked and where it stands.',
            failureTitle: 'Why it failed',
            homeUnavailableTitle: 'Home unavailable',
            contextTitle: 'Requested by',
            contextDescription: 'The session and agent that asked for this.',
            proposalsDescription: 'Posted to the review if you approve.',
        },
        runs: {
            description: 'Background runs on your machines.',
            filterLabel: 'Runs to show',
            filterRunning: 'Running',
            filterAll: 'All',
            onHome: ({ home }) => `On ${home}`,
        },
        person: {
            placeholderTitle: 'Person',
            friendshipTitle: 'Friendship',
            sharedSessionsDescription: 'Sessions this friend shares with you, view only.',
            linkedAccountsTitle: 'Linked accounts',
            linkedAccountsDescription: 'Where else they sign in. Opens in your browser.',
        },
        friendsManage: {
            description: 'People you work with on Happier, and requests between you.',
            requestsTitle: 'Friend requests',
            requestsDescription: 'Open a request to accept or decline it.',
            sentTitle: 'Sent requests',
            sentDescription: 'Waiting for them to accept.',
            friendsTitle: 'Friends',
            friendsDescription: 'Open a friend to see what they share with you.',
        },
    },
    de: {
        approval: {
            requestTitle: 'Anfrage',
            requestDescription: 'Was angefragt wurde und wie der Stand ist.',
            failureTitle: 'Warum es fehlgeschlagen ist',
            homeUnavailableTitle: 'Home nicht verfügbar',
            contextTitle: 'Angefragt von',
            contextDescription: 'Die Sitzung und der Agent, die dies angefragt haben.',
            proposalsDescription: 'Werden im Review veröffentlicht, wenn du zustimmst.',
        },
        runs: {
            description: 'Hintergrundläufe auf deinen Maschinen.',
            filterLabel: 'Angezeigte Läufe',
            filterRunning: 'Aktiv',
            filterAll: 'Alle',
            onHome: ({ home }) => `Auf ${home}`,
        },
        person: {
            placeholderTitle: 'Person',
            friendshipTitle: 'Freundschaft',
            sharedSessionsDescription: 'Sitzungen, die diese Person mit dir teilt, nur lesend.',
            linkedAccountsTitle: 'Verknüpfte Konten',
            linkedAccountsDescription: 'Wo sie sich sonst anmeldet. Öffnet sich im Browser.',
        },
        friendsManage: {
            description: 'Menschen, mit denen du auf Happier arbeitest, und Anfragen zwischen euch.',
            requestsTitle: 'Freundschaftsanfragen',
            requestsDescription: 'Öffne eine Anfrage, um sie anzunehmen oder abzulehnen.',
            sentTitle: 'Gesendete Anfragen',
            sentDescription: 'Warten auf ihre Zustimmung.',
            friendsTitle: 'Freunde',
            friendsDescription: 'Öffne einen Freund, um zu sehen, was er mit dir teilt.',
        },
    },
    fr: {
        approval: {
            requestTitle: 'Demande',
            requestDescription: 'Ce qui a été demandé et où en est la demande.',
            failureTitle: 'Raison de l’échec',
            homeUnavailableTitle: 'Home indisponible',
            contextTitle: 'Demandé par',
            contextDescription: 'La session et l’agent à l’origine de la demande.',
            proposalsDescription: 'Publiés dans la revue si vous approuvez.',
        },
        runs: {
            description: 'Exécutions en arrière-plan sur vos machines.',
            filterLabel: 'Exécutions affichées',
            filterRunning: 'En cours',
            filterAll: 'Toutes',
            onHome: ({ home }) => `Sur ${home}`,
        },
        person: {
            placeholderTitle: 'Personne',
            friendshipTitle: 'Amitié',
            sharedSessionsDescription: 'Sessions que cet ami partage avec vous, en lecture seule.',
            linkedAccountsTitle: 'Comptes associés',
            linkedAccountsDescription: 'Où cette personne se connecte aussi. S’ouvre dans votre navigateur.',
        },
        friendsManage: {
            description: 'Les personnes avec qui vous travaillez sur Happier, et vos demandes mutuelles.',
            requestsTitle: 'Demandes d’ami',
            requestsDescription: 'Ouvrez une demande pour l’accepter ou la refuser.',
            sentTitle: 'Demandes envoyées',
            sentDescription: 'En attente de leur acceptation.',
            friendsTitle: 'Amis',
            friendsDescription: 'Ouvrez un ami pour voir ce qu’il partage avec vous.',
        },
    },
    ru: {
        approval: {
            requestTitle: 'Запрос',
            requestDescription: 'Что запрошено и каков статус.',
            failureTitle: 'Причина сбоя',
            homeUnavailableTitle: 'Home недоступен',
            contextTitle: 'Кто запросил',
            contextDescription: 'Сессия и агент, от которых пришёл запрос.',
            proposalsDescription: 'Будут опубликованы в ревью, если вы одобрите.',
        },
        runs: {
            description: 'Фоновые запуски на ваших машинах.',
            filterLabel: 'Показывать запуски',
            filterRunning: 'Активные',
            filterAll: 'Все',
            onHome: ({ home }) => `В ${home}`,
        },
        person: {
            placeholderTitle: 'Пользователь',
            friendshipTitle: 'Дружба',
            sharedSessionsDescription: 'Сессии, которыми этот друг делится с вами, только просмотр.',
            linkedAccountsTitle: 'Связанные аккаунты',
            linkedAccountsDescription: 'Где ещё этот человек входит в систему. Откроется в браузере.',
        },
        friendsManage: {
            description: 'Люди, с которыми вы работаете в Happier, и запросы между вами.',
            requestsTitle: 'Запросы в друзья',
            requestsDescription: 'Откройте запрос, чтобы принять или отклонить его.',
            sentTitle: 'Отправленные запросы',
            sentDescription: 'Ожидают подтверждения.',
            friendsTitle: 'Друзья',
            friendsDescription: 'Откройте друга, чтобы увидеть, чем он с вами делится.',
        },
    },
    pl: {
        approval: {
            requestTitle: 'Prośba',
            requestDescription: 'O co poproszono i jaki jest status.',
            failureTitle: 'Przyczyna niepowodzenia',
            homeUnavailableTitle: 'Home niedostępny',
            contextTitle: 'Prośba od',
            contextDescription: 'Sesja i agent, którzy o to poprosili.',
            proposalsDescription: 'Zostaną opublikowane w przeglądzie, jeśli zatwierdzisz.',
        },
        runs: {
            description: 'Uruchomienia w tle na twoich maszynach.',
            filterLabel: 'Pokazywane uruchomienia',
            filterRunning: 'Aktywne',
            filterAll: 'Wszystkie',
            onHome: ({ home }) => `W ${home}`,
        },
        person: {
            placeholderTitle: 'Osoba',
            friendshipTitle: 'Znajomość',
            sharedSessionsDescription: 'Sesje, które ten znajomy ci udostępnia, tylko do podglądu.',
            linkedAccountsTitle: 'Połączone konta',
            linkedAccountsDescription: 'Gdzie jeszcze się loguje. Otwiera się w przeglądarce.',
        },
        friendsManage: {
            description: 'Osoby, z którymi pracujesz w Happier, i zaproszenia między wami.',
            requestsTitle: 'Zaproszenia do znajomych',
            requestsDescription: 'Otwórz zaproszenie, aby je przyjąć lub odrzucić.',
            sentTitle: 'Wysłane zaproszenia',
            sentDescription: 'Czekają na akceptację.',
            friendsTitle: 'Znajomi',
            friendsDescription: 'Otwórz znajomego, aby zobaczyć, co ci udostępnia.',
        },
    },
    es: {
        approval: {
            requestTitle: 'Solicitud',
            requestDescription: 'Qué se pidió y en qué estado está.',
            failureTitle: 'Por qué falló',
            homeUnavailableTitle: 'Home no disponible',
            contextTitle: 'Solicitado por',
            contextDescription: 'La sesión y el agente que lo pidieron.',
            proposalsDescription: 'Se publican en la revisión si apruebas.',
        },
        runs: {
            description: 'Ejecuciones en segundo plano en tus máquinas.',
            filterLabel: 'Ejecuciones que se muestran',
            filterRunning: 'En curso',
            filterAll: 'Todas',
            onHome: ({ home }) => `En ${home}`,
        },
        person: {
            placeholderTitle: 'Persona',
            friendshipTitle: 'Amistad',
            sharedSessionsDescription: 'Sesiones que este amigo comparte contigo, solo lectura.',
            linkedAccountsTitle: 'Cuentas vinculadas',
            linkedAccountsDescription: 'Dónde más inicia sesión. Se abre en tu navegador.',
        },
        friendsManage: {
            description: 'Las personas con las que trabajas en Happier y las solicitudes entre vosotros.',
            requestsTitle: 'Solicitudes de amistad',
            requestsDescription: 'Abre una solicitud para aceptarla o rechazarla.',
            sentTitle: 'Solicitudes enviadas',
            sentDescription: 'Esperando a que acepten.',
            friendsTitle: 'Amigos',
            friendsDescription: 'Abre un amigo para ver lo que comparte contigo.',
        },
    },
    it: {
        approval: {
            requestTitle: 'Richiesta',
            requestDescription: 'Cosa è stato chiesto e a che punto è.',
            failureTitle: 'Perché non è riuscita',
            homeUnavailableTitle: 'Home non disponibile',
            contextTitle: 'Richiesto da',
            contextDescription: 'La sessione e l’agente che l’hanno chiesto.',
            proposalsDescription: 'Pubblicati nella revisione se approvi.',
        },
        runs: {
            description: 'Esecuzioni in background sulle tue macchine.',
            filterLabel: 'Esecuzioni mostrate',
            filterRunning: 'In corso',
            filterAll: 'Tutte',
            onHome: ({ home }) => `Su ${home}`,
        },
        person: {
            placeholderTitle: 'Persona',
            friendshipTitle: 'Amicizia',
            sharedSessionsDescription: 'Sessioni che questo amico condivide con te, sola lettura.',
            linkedAccountsTitle: 'Account collegati',
            linkedAccountsDescription: 'Dove altro accede. Si apre nel browser.',
        },
        friendsManage: {
            description: 'Le persone con cui lavori su Happier e le richieste tra voi.',
            requestsTitle: 'Richieste di amicizia',
            requestsDescription: 'Apri una richiesta per accettarla o rifiutarla.',
            sentTitle: 'Richieste inviate',
            sentDescription: 'In attesa che accettino.',
            friendsTitle: 'Amici',
            friendsDescription: 'Apri un amico per vedere cosa condivide con te.',
        },
    },
    pt: {
        approval: {
            requestTitle: 'Pedido',
            requestDescription: 'O que foi pedido e em que ponto está.',
            failureTitle: 'Porque falhou',
            homeUnavailableTitle: 'Home indisponível',
            contextTitle: 'Pedido por',
            contextDescription: 'A sessão e o agente que fizeram o pedido.',
            proposalsDescription: 'Publicados na revisão se aprovar.',
        },
        runs: {
            description: 'Execuções em segundo plano nas suas máquinas.',
            filterLabel: 'Execuções apresentadas',
            filterRunning: 'Em curso',
            filterAll: 'Todas',
            onHome: ({ home }) => `Em ${home}`,
        },
        person: {
            placeholderTitle: 'Pessoa',
            friendshipTitle: 'Amizade',
            sharedSessionsDescription: 'Sessões que este amigo partilha consigo, só de leitura.',
            linkedAccountsTitle: 'Contas associadas',
            linkedAccountsDescription: 'Onde mais inicia sessão. Abre no navegador.',
        },
        friendsManage: {
            description: 'As pessoas com quem trabalha no Happier e os pedidos entre vocês.',
            requestsTitle: 'Pedidos de amizade',
            requestsDescription: 'Abra um pedido para o aceitar ou recusar.',
            sentTitle: 'Pedidos enviados',
            sentDescription: 'À espera que aceitem.',
            friendsTitle: 'Amigos',
            friendsDescription: 'Abra um amigo para ver o que partilha consigo.',
        },
    },
    ca: {
        approval: {
            requestTitle: 'Sol·licitud',
            requestDescription: 'Què s’ha demanat i en quin estat està.',
            failureTitle: 'Per què ha fallat',
            homeUnavailableTitle: 'Home no disponible',
            contextTitle: 'Sol·licitat per',
            contextDescription: 'La sessió i l’agent que ho han demanat.',
            proposalsDescription: 'Es publiquen a la revisió si ho aproves.',
        },
        runs: {
            description: 'Execucions en segon pla a les teves màquines.',
            filterLabel: 'Execucions que es mostren',
            filterRunning: 'En curs',
            filterAll: 'Totes',
            onHome: ({ home }) => `A ${home}`,
        },
        person: {
            placeholderTitle: 'Persona',
            friendshipTitle: 'Amistat',
            sharedSessionsDescription: 'Sessions que aquest amic comparteix amb tu, només lectura.',
            linkedAccountsTitle: 'Comptes vinculats',
            linkedAccountsDescription: 'On més inicia sessió. S’obre al navegador.',
        },
        friendsManage: {
            description: 'Les persones amb qui treballes a Happier i les sol·licituds entre vosaltres.',
            requestsTitle: 'Sol·licituds d’amistat',
            requestsDescription: 'Obre una sol·licitud per acceptar-la o rebutjar-la.',
            sentTitle: 'Sol·licituds enviades',
            sentDescription: 'Esperant que acceptin.',
            friendsTitle: 'Amics',
            friendsDescription: 'Obre un amic per veure què comparteix amb tu.',
        },
    },
    'zh-Hans': {
        approval: {
            requestTitle: '请求',
            requestDescription: '请求的内容及当前状态。',
            failureTitle: '失败原因',
            homeUnavailableTitle: 'Home 不可用',
            contextTitle: '请求来源',
            contextDescription: '发起此请求的会话和代理。',
            proposalsDescription: '批准后将发布到评审中。',
        },
        runs: {
            description: '你的机器上的后台运行。',
            filterLabel: '显示的运行',
            filterRunning: '运行中',
            filterAll: '全部',
            onHome: ({ home }) => `位于 ${home}`,
        },
        person: {
            placeholderTitle: '用户',
            friendshipTitle: '好友关系',
            sharedSessionsDescription: '此好友与你共享的会话，仅可查看。',
            linkedAccountsTitle: '关联账户',
            linkedAccountsDescription: '对方在其他地方的登录方式。将在浏览器中打开。',
        },
        friendsManage: {
            description: '你在 Happier 上合作的人，以及你们之间的请求。',
            requestsTitle: '好友请求',
            requestsDescription: '打开请求以接受或拒绝。',
            sentTitle: '已发送的请求',
            sentDescription: '等待对方接受。',
            friendsTitle: '好友',
            friendsDescription: '打开好友以查看其与你共享的内容。',
        },
    },
    'zh-Hant': {
        approval: {
            requestTitle: '請求',
            requestDescription: '請求的內容及目前狀態。',
            failureTitle: '失敗原因',
            homeUnavailableTitle: 'Home 無法使用',
            contextTitle: '請求來源',
            contextDescription: '發起此請求的工作階段和代理。',
            proposalsDescription: '核准後將發佈到審查中。',
        },
        runs: {
            description: '你的機器上的背景執行。',
            filterLabel: '顯示的執行',
            filterRunning: '執行中',
            filterAll: '全部',
            onHome: ({ home }) => `位於 ${home}`,
        },
        person: {
            placeholderTitle: '使用者',
            friendshipTitle: '好友關係',
            sharedSessionsDescription: '此好友與你分享的工作階段，僅可檢視。',
            linkedAccountsTitle: '連結的帳號',
            linkedAccountsDescription: '對方在其他地方的登入方式。將在瀏覽器中開啟。',
        },
        friendsManage: {
            description: '你在 Happier 上合作的人，以及你們之間的請求。',
            requestsTitle: '好友請求',
            requestsDescription: '開啟請求以接受或拒絕。',
            sentTitle: '已傳送的請求',
            sentDescription: '等待對方接受。',
            friendsTitle: '好友',
            friendsDescription: '開啟好友以查看其與你分享的內容。',
        },
    },
    ja: {
        approval: {
            requestTitle: 'リクエスト',
            requestDescription: '依頼された内容と現在の状況です。',
            failureTitle: '失敗した理由',
            homeUnavailableTitle: 'Home を利用できません',
            contextTitle: '依頼元',
            contextDescription: 'このリクエストを出したセッションとエージェントです。',
            proposalsDescription: '承認するとレビューに投稿されます。',
        },
        runs: {
            description: 'マシン上のバックグラウンド実行です。',
            filterLabel: '表示する実行',
            filterRunning: '実行中',
            filterAll: 'すべて',
            onHome: ({ home }) => `${home} 上`,
        },
        person: {
            placeholderTitle: 'ユーザー',
            friendshipTitle: 'フレンド',
            sharedSessionsDescription: 'このフレンドが共有しているセッション（閲覧のみ）。',
            linkedAccountsTitle: 'リンクされたアカウント',
            linkedAccountsDescription: '他のサインイン先です。ブラウザで開きます。',
        },
        friendsManage: {
            description: 'Happier で一緒に作業する人と、お互いのリクエストです。',
            requestsTitle: 'フレンドリクエスト',
            requestsDescription: 'リクエストを開いて承認または拒否します。',
            sentTitle: '送信したリクエスト',
            sentDescription: '相手の承認待ちです。',
            friendsTitle: 'フレンド',
            friendsDescription: 'フレンドを開くと、共有されている内容を確認できます。',
        },
    },
} as const satisfies Record<string, DetailPageTranslations>;
