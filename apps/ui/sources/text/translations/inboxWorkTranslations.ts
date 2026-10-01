/**
 * Copy for the Inbox grouped by work root (ORC R-10, §3.8; lab `inbox-I1/I2/I3`, `phone-P4`).
 *
 * Status words come from their owners (session status, workflow run state) and are not repeated
 * here; the reminder submenu keeps the session menus' own "Remind me" copy.
 */
const en = {
    pageDescription: 'Everything waiting on you, grouped by the work it belongs to.',
    tabs: {
        a11y: 'Inbox view',
        needsYou: 'Needs you',
        updates: 'Updates',
    },
    groups: {
        unknownLead: 'Session',
        leadMeta: ({ count }: { count: number }) => (count === 1 ? '1 sub-session' : `${count} sub-sessions`),
        runMeta: 'Workflow run',
        otherTitle: 'Other sessions',
        otherMeta: 'Not part of an orchestrator or run',
        openSession: 'Open session',
        openRun: 'Open run',
    },
    rows: {
        step: 'Step',
        workflowRun: 'Workflow run',
        review: 'Review',
        stalled: 'Stalled',
        stalledReason: 'Its machine went offline mid-turn',
        landing: 'Landing',
        settle: 'Settle',
        snoozedUntil: ({ time }: { time: string }) => `Snoozed until ${time}`,
        more: 'More actions',
    },
    popover: {
        moreInOther: ({ count }: { count: number }) => `${count} more in Other sessions`,
        updates: ({ count }: { count: number }) => (count === 1 ? '1 update' : `${count} updates`),
    },
    empty: {
        title: 'Nothing needs you',
        description: 'Permission requests, reviews and anything an orchestrator or workflow waits on land here.',
    },
    updatesEmpty: {
        title: 'No updates',
        description: 'Finished sessions and friend requests land here.',
    },
    stale: {
        reason: "Couldn't refresh workflow runs",
        retry: 'Try again',
    },
    settleFailed: "Couldn't settle this session",
};

const ca: typeof en = {
    pageDescription: 'Tot el que t’espera, agrupat per la feina a què pertany.',
    tabs: { a11y: 'Vista de la safata', needsYou: 'Et necessita', updates: 'Novetats' },
    groups: {
        unknownLead: 'Sessió',
        leadMeta: ({ count }) => (count === 1 ? '1 subsessió' : `${count} subsessions`),
        runMeta: 'Execució de flux de treball',
        otherTitle: 'Altres sessions',
        otherMeta: 'No formen part d’un orquestrador ni d’una execució',
        openSession: 'Obre la sessió',
        openRun: 'Obre l’execució',
    },
    rows: {
        step: 'Pas',
        workflowRun: 'Execució de flux de treball',
        review: 'Revisa',
        stalled: 'Aturada',
        stalledReason: 'La màquina s’ha desconnectat enmig del torn',
        landing: 'Pendent de fusionar',
        settle: 'Tanca',
        snoozedUntil: ({ time }) => `Posposada fins ${time}`,
        more: 'Més accions',
    },
    popover: {
        moreInOther: ({ count }) => `${count} més a Altres sessions`,
        updates: ({ count }) => (count === 1 ? '1 novetat' : `${count} novetats`),
    },
    empty: {
        title: 'Res no et necessita',
        description: 'Aquí arriben les sol·licituds de permís, les revisions i tot el que un orquestrador o un flux de treball espera de tu.',
    },
    updatesEmpty: {
        title: 'Cap novetat',
        description: 'Aquí arriben les sessions acabades i les sol·licituds d’amistat.',
    },
    stale: { reason: 'No s’han pogut actualitzar les execucions de fluxos de treball', retry: 'Torna-ho a provar' },
    settleFailed: 'No s’ha pogut tancar aquesta sessió',
};

const de: typeof en = {
    pageDescription: 'Alles, was auf dich wartet, gruppiert nach der Arbeit, zu der es gehört.',
    tabs: { a11y: 'Posteingangsansicht', needsYou: 'Braucht dich', updates: 'Neuigkeiten' },
    groups: {
        unknownLead: 'Sitzung',
        leadMeta: ({ count }) => (count === 1 ? '1 Untersitzung' : `${count} Untersitzungen`),
        runMeta: 'Workflow-Ausführung',
        otherTitle: 'Weitere Sitzungen',
        otherMeta: 'Gehören zu keinem Orchestrator und keiner Ausführung',
        openSession: 'Sitzung öffnen',
        openRun: 'Ausführung öffnen',
    },
    rows: {
        step: 'Schritt',
        workflowRun: 'Workflow-Ausführung',
        review: 'Prüfen',
        stalled: 'Hängt',
        stalledReason: 'Sein Rechner ging mitten im Zug offline',
        landing: 'Wird gemergt',
        settle: 'Abschließen',
        snoozedUntil: ({ time }) => `Zurückgestellt bis ${time}`,
        more: 'Weitere Aktionen',
    },
    popover: {
        moreInOther: ({ count }) => `${count} weitere unter Weitere Sitzungen`,
        updates: ({ count }) => (count === 1 ? '1 Neuigkeit' : `${count} Neuigkeiten`),
    },
    empty: {
        title: 'Nichts braucht dich',
        description: 'Berechtigungsanfragen, Prüfungen und alles, worauf ein Orchestrator oder Workflow wartet, landen hier.',
    },
    updatesEmpty: {
        title: 'Keine Neuigkeiten',
        description: 'Fertige Sitzungen und Freundschaftsanfragen landen hier.',
    },
    stale: { reason: 'Workflow-Ausführungen konnten nicht aktualisiert werden', retry: 'Erneut versuchen' },
    settleFailed: 'Diese Sitzung konnte nicht abgeschlossen werden',
};

const es: typeof en = {
    pageDescription: 'Todo lo que te espera, agrupado por el trabajo al que pertenece.',
    tabs: { a11y: 'Vista de la bandeja', needsYou: 'Te necesita', updates: 'Novedades' },
    groups: {
        unknownLead: 'Sesión',
        leadMeta: ({ count }) => (count === 1 ? '1 subsesión' : `${count} subsesiones`),
        runMeta: 'Ejecución de flujo de trabajo',
        otherTitle: 'Otras sesiones',
        otherMeta: 'No forman parte de un orquestador ni de una ejecución',
        openSession: 'Abrir sesión',
        openRun: 'Abrir ejecución',
    },
    rows: {
        step: 'Paso',
        workflowRun: 'Ejecución de flujo de trabajo',
        review: 'Revisar',
        stalled: 'Detenida',
        stalledReason: 'Su máquina se desconectó a mitad del turno',
        landing: 'Pendiente de fusionar',
        settle: 'Cerrar',
        snoozedUntil: ({ time }) => `Pospuesta hasta ${time}`,
        more: 'Más acciones',
    },
    popover: {
        moreInOther: ({ count }) => `${count} más en Otras sesiones`,
        updates: ({ count }) => (count === 1 ? '1 novedad' : `${count} novedades`),
    },
    empty: {
        title: 'Nada te necesita',
        description: 'Aquí llegan las solicitudes de permiso, las revisiones y todo lo que un orquestador o un flujo de trabajo espera de ti.',
    },
    updatesEmpty: {
        title: 'Sin novedades',
        description: 'Aquí llegan las sesiones terminadas y las solicitudes de amistad.',
    },
    stale: { reason: 'No se pudieron actualizar las ejecuciones de flujos de trabajo', retry: 'Reintentar' },
    settleFailed: 'No se pudo cerrar esta sesión',
};

const fr: typeof en = {
    pageDescription: 'Tout ce qui vous attend, regroupé par le travail auquel il appartient.',
    tabs: { a11y: 'Vue de la boîte de réception', needsYou: 'Vous attend', updates: 'Nouveautés' },
    groups: {
        unknownLead: 'Session',
        leadMeta: ({ count }) => (count === 1 ? '1 sous-session' : `${count} sous-sessions`),
        runMeta: 'Exécution de workflow',
        otherTitle: 'Autres sessions',
        otherMeta: 'Hors orchestrateur et hors exécution',
        openSession: 'Ouvrir la session',
        openRun: 'Ouvrir l’exécution',
    },
    rows: {
        step: 'Étape',
        workflowRun: 'Exécution de workflow',
        review: 'Examiner',
        stalled: 'Bloquée',
        stalledReason: 'Sa machine s’est déconnectée en plein tour',
        landing: 'À fusionner',
        settle: 'Clore',
        snoozedUntil: ({ time }) => `Reportée jusqu’à ${time}`,
        more: 'Plus d’actions',
    },
    popover: {
        moreInOther: ({ count }) => `${count} de plus dans Autres sessions`,
        updates: ({ count }) => (count === 1 ? '1 nouveauté' : `${count} nouveautés`),
    },
    empty: {
        title: 'Rien ne vous attend',
        description: 'Les demandes d’autorisation, les revues et tout ce qu’un orchestrateur ou un workflow attend de vous arrivent ici.',
    },
    updatesEmpty: {
        title: 'Aucune nouveauté',
        description: 'Les sessions terminées et les demandes d’ami arrivent ici.',
    },
    stale: { reason: 'Impossible d’actualiser les exécutions de workflow', retry: 'Réessayer' },
    settleFailed: 'Impossible de clore cette session',
};

const it: typeof en = {
    pageDescription: 'Tutto ciò che ti aspetta, raggruppato per il lavoro a cui appartiene.',
    tabs: { a11y: 'Vista della posta in arrivo', needsYou: 'Ti aspetta', updates: 'Novità' },
    groups: {
        unknownLead: 'Sessione',
        leadMeta: ({ count }) => (count === 1 ? '1 sottosessione' : `${count} sottosessioni`),
        runMeta: 'Esecuzione di workflow',
        otherTitle: 'Altre sessioni',
        otherMeta: 'Non fanno parte di un orchestratore né di un’esecuzione',
        openSession: 'Apri sessione',
        openRun: 'Apri esecuzione',
    },
    rows: {
        step: 'Passaggio',
        workflowRun: 'Esecuzione di workflow',
        review: 'Rivedi',
        stalled: 'Bloccata',
        stalledReason: 'La sua macchina è andata offline a metà turno',
        landing: 'Da unire',
        settle: 'Chiudi',
        snoozedUntil: ({ time }) => `Rimandata fino a ${time}`,
        more: 'Altre azioni',
    },
    popover: {
        moreInOther: ({ count }) => `Altre ${count} in Altre sessioni`,
        updates: ({ count }) => (count === 1 ? '1 novità' : `${count} novità`),
    },
    empty: {
        title: 'Niente ti aspetta',
        description: 'Qui arrivano le richieste di autorizzazione, le revisioni e tutto ciò che un orchestratore o un workflow aspetta da te.',
    },
    updatesEmpty: {
        title: 'Nessuna novità',
        description: 'Qui arrivano le sessioni terminate e le richieste di amicizia.',
    },
    stale: { reason: 'Impossibile aggiornare le esecuzioni dei workflow', retry: 'Riprova' },
    settleFailed: 'Impossibile chiudere questa sessione',
};

const ja: typeof en = {
    pageDescription: 'あなたを待っているものを、属する作業ごとにまとめています。',
    tabs: { a11y: '受信トレイの表示', needsYou: '対応が必要', updates: '更新' },
    groups: {
        unknownLead: 'セッション',
        leadMeta: ({ count }) => `サブセッション ${count} 件`,
        runMeta: 'ワークフロー実行',
        otherTitle: 'その他のセッション',
        otherMeta: 'オーケストレーターにも実行にも属していません',
        openSession: 'セッションを開く',
        openRun: '実行を開く',
    },
    rows: {
        step: 'ステップ',
        workflowRun: 'ワークフロー実行',
        review: 'レビュー',
        stalled: '停止中',
        stalledReason: 'ターンの途中でマシンがオフラインになりました',
        landing: 'マージ待ち',
        settle: '完了にする',
        snoozedUntil: ({ time }) => `${time} までスヌーズ`,
        more: 'その他の操作',
    },
    popover: {
        moreInOther: ({ count }) => `その他のセッションにあと ${count} 件`,
        updates: ({ count }) => `更新 ${count} 件`,
    },
    empty: {
        title: '対応が必要なものはありません',
        description: '権限リクエスト、レビュー、オーケストレーターやワークフローがあなたを待っているものがここに届きます。',
    },
    updatesEmpty: {
        title: '更新はありません',
        description: '完了したセッションとフレンドリクエストがここに届きます。',
    },
    stale: { reason: 'ワークフロー実行を更新できませんでした', retry: '再試行' },
    settleFailed: 'このセッションを完了にできませんでした',
};

const pl: typeof en = {
    pageDescription: 'Wszystko, co na ciebie czeka, pogrupowane według pracy, do której należy.',
    tabs: { a11y: 'Widok skrzynki', needsYou: 'Czeka na ciebie', updates: 'Nowości' },
    groups: {
        unknownLead: 'Sesja',
        leadMeta: ({ count }) => (count === 1 ? '1 podsesja' : `Podsesje: ${count}`),
        runMeta: 'Uruchomienie przepływu pracy',
        otherTitle: 'Inne sesje',
        otherMeta: 'Poza orkiestratorem i uruchomieniem',
        openSession: 'Otwórz sesję',
        openRun: 'Otwórz uruchomienie',
    },
    rows: {
        step: 'Krok',
        workflowRun: 'Uruchomienie przepływu pracy',
        review: 'Przejrzyj',
        stalled: 'Utknęła',
        stalledReason: 'Jej maszyna przeszła w tryb offline w trakcie tury',
        landing: 'Do scalenia',
        settle: 'Zamknij',
        snoozedUntil: ({ time }) => `Odłożona do ${time}`,
        more: 'Więcej działań',
    },
    popover: {
        moreInOther: ({ count }) => `Jeszcze ${count} w Innych sesjach`,
        updates: ({ count }) => `Nowości: ${count}`,
    },
    empty: {
        title: 'Nic na ciebie nie czeka',
        description: 'Tu trafiają prośby o uprawnienia, przeglądy i wszystko, na co czeka orkiestrator lub przepływ pracy.',
    },
    updatesEmpty: {
        title: 'Brak nowości',
        description: 'Tu trafiają zakończone sesje i zaproszenia do znajomych.',
    },
    stale: { reason: 'Nie udało się odświeżyć uruchomień przepływów pracy', retry: 'Spróbuj ponownie' },
    settleFailed: 'Nie udało się zamknąć tej sesji',
};

const pt: typeof en = {
    pageDescription: 'Tudo o que espera por você, agrupado pelo trabalho a que pertence.',
    tabs: { a11y: 'Visualização da caixa de entrada', needsYou: 'Precisa de você', updates: 'Novidades' },
    groups: {
        unknownLead: 'Sessão',
        leadMeta: ({ count }) => (count === 1 ? '1 subsessão' : `${count} subsessões`),
        runMeta: 'Execução de fluxo de trabalho',
        otherTitle: 'Outras sessões',
        otherMeta: 'Fora de um orquestrador ou de uma execução',
        openSession: 'Abrir sessão',
        openRun: 'Abrir execução',
    },
    rows: {
        step: 'Etapa',
        workflowRun: 'Execução de fluxo de trabalho',
        review: 'Revisar',
        stalled: 'Parada',
        stalledReason: 'A máquina ficou offline no meio do turno',
        landing: 'Aguardando merge',
        settle: 'Encerrar',
        snoozedUntil: ({ time }) => `Adiada até ${time}`,
        more: 'Mais ações',
    },
    popover: {
        moreInOther: ({ count }) => `Mais ${count} em Outras sessões`,
        updates: ({ count }) => (count === 1 ? '1 novidade' : `${count} novidades`),
    },
    empty: {
        title: 'Nada precisa de você',
        description: 'Pedidos de permissão, revisões e tudo o que um orquestrador ou fluxo de trabalho espera de você chegam aqui.',
    },
    updatesEmpty: {
        title: 'Sem novidades',
        description: 'Sessões concluídas e pedidos de amizade chegam aqui.',
    },
    stale: { reason: 'Não foi possível atualizar as execuções de fluxos de trabalho', retry: 'Tentar novamente' },
    settleFailed: 'Não foi possível encerrar esta sessão',
};

const ru: typeof en = {
    pageDescription: 'Всё, что ждёт вас, сгруппировано по работе, к которой относится.',
    tabs: { a11y: 'Вид входящих', needsYou: 'Ждёт вас', updates: 'Новое' },
    groups: {
        unknownLead: 'Сессия',
        leadMeta: ({ count }) => `Подсессий: ${count}`,
        runMeta: 'Запуск рабочего процесса',
        otherTitle: 'Другие сессии',
        otherMeta: 'Не относятся к оркестратору или запуску',
        openSession: 'Открыть сессию',
        openRun: 'Открыть запуск',
    },
    rows: {
        step: 'Шаг',
        workflowRun: 'Запуск рабочего процесса',
        review: 'Просмотреть',
        stalled: 'Зависла',
        stalledReason: 'Её машина ушла в офлайн посреди хода',
        landing: 'Ожидает слияния',
        settle: 'Закрыть',
        snoozedUntil: ({ time }) => `Отложена до ${time}`,
        more: 'Другие действия',
    },
    popover: {
        moreInOther: ({ count }) => `Ещё ${count} в «Других сессиях»`,
        updates: ({ count }) => `Нового: ${count}`,
    },
    empty: {
        title: 'Вас ничего не ждёт',
        description: 'Сюда приходят запросы разрешений, проверки и всё, чего от вас ждёт оркестратор или рабочий процесс.',
    },
    updatesEmpty: {
        title: 'Нового нет',
        description: 'Сюда приходят завершённые сессии и запросы в друзья.',
    },
    stale: { reason: 'Не удалось обновить запуски рабочих процессов', retry: 'Повторить' },
    settleFailed: 'Не удалось закрыть эту сессию',
};

const zhHans: typeof en = {
    pageDescription: '所有等你处理的事项，按所属工作分组。',
    tabs: { a11y: '收件箱视图', needsYou: '需要你', updates: '动态' },
    groups: {
        unknownLead: '会话',
        leadMeta: ({ count }) => `${count} 个子会话`,
        runMeta: '工作流运行',
        otherTitle: '其他会话',
        otherMeta: '不属于任何编排者或运行',
        openSession: '打开会话',
        openRun: '打开运行',
    },
    rows: {
        step: '步骤',
        workflowRun: '工作流运行',
        review: '审阅',
        stalled: '已停滞',
        stalledReason: '它的机器在轮次中途离线',
        landing: '待合并',
        settle: '结束',
        snoozedUntil: ({ time }) => `已推迟到 ${time}`,
        more: '更多操作',
    },
    popover: {
        moreInOther: ({ count }) => `其他会话中还有 ${count} 项`,
        updates: ({ count }) => `${count} 条动态`,
    },
    empty: {
        title: '没有需要你处理的事项',
        description: '权限请求、审阅，以及编排者或工作流在等你的事项都会出现在这里。',
    },
    updatesEmpty: {
        title: '暂无动态',
        description: '已完成的会话和好友请求会出现在这里。',
    },
    stale: { reason: '无法刷新工作流运行', retry: '重试' },
    settleFailed: '无法结束此会话',
};

const zhHant: typeof en = {
    pageDescription: '所有等你處理的事項，依所屬工作分組。',
    tabs: { a11y: '收件匣檢視', needsYou: '需要你', updates: '動態' },
    groups: {
        unknownLead: '工作階段',
        leadMeta: ({ count }) => `${count} 個子工作階段`,
        runMeta: '工作流程執行',
        otherTitle: '其他工作階段',
        otherMeta: '不屬於任何協調者或執行',
        openSession: '開啟工作階段',
        openRun: '開啟執行',
    },
    rows: {
        step: '步驟',
        workflowRun: '工作流程執行',
        review: '審閱',
        stalled: '已停滯',
        stalledReason: '它的機器在回合中途離線',
        landing: '待合併',
        settle: '結束',
        snoozedUntil: ({ time }) => `已延後到 ${time}`,
        more: '更多動作',
    },
    popover: {
        moreInOther: ({ count }) => `其他工作階段中還有 ${count} 項`,
        updates: ({ count }) => `${count} 則動態`,
    },
    empty: {
        title: '沒有需要你處理的事項',
        description: '權限請求、審閱，以及協調者或工作流程在等你的事項都會出現在這裡。',
    },
    updatesEmpty: {
        title: '目前沒有動態',
        description: '已完成的工作階段和好友邀請會出現在這裡。',
    },
    stale: { reason: '無法重新整理工作流程執行', retry: '重試' },
    settleFailed: '無法結束此工作階段',
};

export const inboxWorkTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
