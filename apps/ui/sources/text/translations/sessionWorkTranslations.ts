/**
 * Copy for the Session's Work surfaces (ORC §3.8): the Work tab, the header's work strip and the peek.
 *
 * One module because these strings are read from one projection: the tab, the strip and the peek say
 * the same words about the same work. The status words themselves come from their owners (session
 * awareness, workflow run state, agent activity) and are not repeated here.
 */
const en = {
    workerUpdate: {
        settled: "Settled",
        stalled: "Stalled",
        published: "Published",
        truncated: "Result shortened.",
        wokenBy: ({ count }: { count: number }) => (count === 1 ? 'Woken by an update' : `Woken by ${count} updates`),
        notFromYou: 'not a message from you',
    },
    title: 'Work',
    subtitle: {
        sessions: ({ count }: { count: number }) => (count === 1 ? '1 session' : `${count} sessions`),
        runs: ({ count }: { count: number }) => (count === 1 ? '1 run' : `${count} runs`),
        nothingStarted: 'Nothing started',
    },
    states: {
        recent: 'Recent',
    },
    view: {
        a11y: 'Work view',
        list: 'List',
        map: 'Map',
        expandMap: 'Open the map beside the session',
    },
    map: {
        positionUnder: ({ position, total, parent }: { position: number; total: number; parent: string }) => `${position} of ${total} under ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Make this an orchestrator',
        makeOrchestratorSubtitle: 'This session plans, delegates and reports back',
        makeOrchestratorFailed: "Couldn't make this session an orchestrator",
    },
    putUnder: {
        title: "Put under…",
        subtitle: "Report to another session",
        search: "Find a session",
        topLevel: "Top level — reports to no one",
        errors: {
            cycle: "That session already reports to this one",
            changed: "This session was just moved. Try again",
            forbidden: "You can’t put it under that session",
            failed: "Couldn’t move this session",
        },
    },
    kinds: {
        session: 'Session',
        workflowRun: 'Workflow run',
        backgroundRun: 'Background run',
    },
    showMore: ({ count }: { count: number }) => `Show ${count} more`,
    role: {
        none: 'None',
        handsOff: 'hands-off',
        a11y: ({ role }: { role: string }) => `Role: ${role}. Change role`,
    },
    empty: {
        title: 'No work started yet',
        reason: 'Sessions, workflows and background runs this session starts will appear here, with anything that needs you.',
    },
    row: {
        a11y: ({ title, status }: { title: string; status: string }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }: { completed: number; total: number }) => `${completed} of ${total}`,
    strip: {
        openInSidebar: 'Open in sidebar',
        stillWorking: ({ count }: { count: number }) => `${count} still working`,
        needsYou: ({ count }: { count: number }) => `${count} needs you`,
        a11y: ({ summary }: { summary: string }) => `Work: ${summary}`,
    },
    leadArchived: ({ count }: { count: number }) => `This session is archived · ${count} still working`,
    runsStale: 'Workflow runs may be out of date',
    list: {
        level: ({ level }: { level: number }) => `Level ${level}`,
        subSessions: ({ count }: { count: number }) => (count === 1 ? '1 sub-session' : `${count} sub-sessions`),
        reportsWorking: ({ count }: { count: number }) => `${count} working`,
        reportsNeedYou: ({ count }: { count: number }) => (count === 1 ? '1 sub-session needs you' : `${count} sub-sessions need you`),
    },
    archive: {
        alsoArchiveReports: ({ count }: { count: number }) => (count === 1 ? 'Also archive 1 sub-session' : `Also archive ${count} sub-sessions`),
        someNotArchivedTitle: ({ count }: { count: number }) => (count === 1 ? '1 sub-session was not archived' : `${count} sub-sessions were not archived`),
    },
    peek: {
        reportsTo: ({ lead }: { lead: string }) => `Reports to ${lead}`,
        repliesGoHere: 'Replies go to this session',
    },
};

const ca: typeof en = {
    workerUpdate: {
        settled: "Resolut",
        stalled: "Aturat",
        published: "Publicat",
        truncated: "Resultat escurçat.",
        wokenBy: ({ count }) => (count === 1 ? 'Despertat per una actualització' : `Despertat per ${count} actualitzacions`),
        notFromYou: 'no és un missatge teu',
    },
    title: 'Feina',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 sessió' : `${count} sessions`),
        runs: ({ count }) => (count === 1 ? '1 execució' : `${count} execucions`),
        nothingStarted: 'Encara no s’ha iniciat res',
    },
    states: {
        recent: 'Recents',
    },
    view: {
        a11y: 'Vista de la feina',
        list: 'Llista',
        map: 'Mapa',
        expandMap: 'Obre el mapa al costat de la sessió',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} de ${total} sota ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Converteix-la en orquestradora',
        makeOrchestratorSubtitle: 'Aquesta sessió planifica, delega i informa',
        makeOrchestratorFailed: "No s’ha pogut convertir la sessió en orquestradora",
    },
    putUnder: {
        title: "Posa sota…",
        subtitle: "Informa a una altra sessió",
        search: "Cerca una sessió",
        topLevel: "Nivell superior — no informa a ningú",
        errors: {
            cycle: "Aquella sessió ja informa a aquesta",
            changed: "La sessió s’acaba de moure. Torna-ho a provar",
            forbidden: "No la pots posar sota aquella sessió",
            failed: "No s’ha pogut moure la sessió",
        },
    },
    kinds: {
        session: 'Sessió',
        workflowRun: 'Execució de flux',
        backgroundRun: 'Execució en segon pla',
    },
    showMore: ({ count }) => `Mostra ${count} més`,
    role: {
        none: 'Cap',
        handsOff: 'sense editar',
        a11y: ({ role }) => `Rol: ${role}. Canvia el rol`,
    },
    empty: {
        title: 'Encara no hi ha feina',
        reason: 'Les sessions, els fluxos de treball i les execucions en segon pla que iniciï aquesta sessió apareixeran aquí, amb tot allò que et necessita.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} de ${total}`,
    strip: {
        openInSidebar: 'Obre a la barra lateral',
        stillWorking: ({ count }) => `${count} encara treballant`,
        needsYou: ({ count }) => `${count} et necessita${count === 1 ? '' : 'n'}`,
        a11y: ({ summary }) => `Feina: ${summary}`,
    },
    leadArchived: ({ count }) => `Aquesta sessió està arxivada · ${count} encara treballant`,
    runsStale: 'Les execucions de fluxos de treball poden no estar al dia',
    list: {
        level: ({ level }) => `Nivell ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 subsessió' : `${count} subsessions`),
        reportsWorking: ({ count }) => `${count} treballant`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 subsessió et necessita' : `${count} subsessions et necessiten`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Arxiva també 1 subsessió' : `Arxiva també ${count} subsessions`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 subsessió no s’ha arxivat' : `${count} subsessions no s’han arxivat`),
    },
    peek: {
        reportsTo: ({ lead }) => `Informa a ${lead}`,
        repliesGoHere: 'Les respostes van a aquesta sessió',
    },
};

const de: typeof en = {
    workerUpdate: {
        settled: "Abgeschlossen",
        stalled: "Stockt",
        published: "Veröffentlicht",
        truncated: "Ergebnis gekürzt.",
        wokenBy: ({ count }) => (count === 1 ? 'Durch ein Update geweckt' : `Durch ${count} Updates geweckt`),
        notFromYou: 'keine Nachricht von dir',
    },
    title: 'Arbeit',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 Sitzung' : `${count} Sitzungen`),
        runs: ({ count }) => (count === 1 ? '1 Lauf' : `${count} Läufe`),
        nothingStarted: 'Noch nichts gestartet',
    },
    states: {
        recent: 'Kürzlich',
    },
    view: {
        a11y: 'Arbeitsansicht',
        list: 'Liste',
        map: 'Karte',
        expandMap: 'Karte neben der Sitzung öffnen',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} von ${total} unter ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Zum Orchestrator machen',
        makeOrchestratorSubtitle: 'Diese Sitzung plant, delegiert und berichtet',
        makeOrchestratorFailed: "Die Sitzung konnte nicht zum Orchestrator werden",
    },
    putUnder: {
        title: "Unterordnen…",
        subtitle: "An eine andere Sitzung berichten",
        search: "Sitzung suchen",
        topLevel: "Oberste Ebene – berichtet an niemanden",
        errors: {
            cycle: "Diese Sitzung berichtet bereits an diese",
            changed: "Die Sitzung wurde gerade verschoben. Versuche es erneut",
            forbidden: "Du kannst sie dieser Sitzung nicht unterordnen",
            failed: "Die Sitzung konnte nicht verschoben werden",
        },
    },
    kinds: {
        session: 'Sitzung',
        workflowRun: 'Workflow-Lauf',
        backgroundRun: 'Hintergrundlauf',
    },
    showMore: ({ count }) => `${count} weitere anzeigen`,
    role: {
        none: 'Keine',
        handsOff: 'nur delegieren',
        a11y: ({ role }) => `Rolle: ${role}. Rolle ändern`,
    },
    empty: {
        title: 'Noch keine Arbeit gestartet',
        reason: 'Sitzungen, Workflows und Hintergrundläufe, die diese Sitzung startet, erscheinen hier – zusammen mit allem, was dich braucht.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} von ${total}`,
    strip: {
        openInSidebar: 'In der Seitenleiste öffnen',
        stillWorking: ({ count }) => `${count} arbeiten noch`,
        needsYou: ({ count }) => `${count} braucht dich`,
        a11y: ({ summary }) => `Arbeit: ${summary}`,
    },
    leadArchived: ({ count }) => `Diese Sitzung ist archiviert · ${count} arbeiten noch`,
    runsStale: 'Workflow-Läufe sind möglicherweise nicht aktuell',
    list: {
        level: ({ level }) => `Ebene ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 Untersitzung' : `${count} Untersitzungen`),
        reportsWorking: ({ count }) => `${count} arbeiten`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 Untersitzung braucht dich' : `${count} Untersitzungen brauchen dich`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Auch 1 Untersitzung archivieren' : `Auch ${count} Untersitzungen archivieren`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 Untersitzung wurde nicht archiviert' : `${count} Untersitzungen wurden nicht archiviert`),
    },
    peek: {
        reportsTo: ({ lead }) => `Berichtet an ${lead}`,
        repliesGoHere: 'Antworten gehen an diese Sitzung',
    },
};

const es: typeof en = {
    workerUpdate: {
        settled: "Resuelto",
        stalled: "Estancado",
        published: "Publicado",
        truncated: "Resultado abreviado.",
        wokenBy: ({ count }) => (count === 1 ? 'Despertado por una actualización' : `Despertado por ${count} actualizaciones`),
        notFromYou: 'no es un mensaje tuyo',
    },
    title: 'Trabajo',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 sesión' : `${count} sesiones`),
        runs: ({ count }) => (count === 1 ? '1 ejecución' : `${count} ejecuciones`),
        nothingStarted: 'Aún no se ha iniciado nada',
    },
    states: {
        recent: 'Recientes',
    },
    view: {
        a11y: 'Vista del trabajo',
        list: 'Lista',
        map: 'Mapa',
        expandMap: 'Abrir el mapa junto a la sesión',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} de ${total} bajo ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Convertir en orquestador',
        makeOrchestratorSubtitle: 'Esta sesión planifica, delega e informa',
        makeOrchestratorFailed: "No se pudo convertir la sesión en orquestador",
    },
    putUnder: {
        title: "Poner debajo de…",
        subtitle: "Informar a otra sesión",
        search: "Buscar una sesión",
        topLevel: "Nivel superior — no informa a nadie",
        errors: {
            cycle: "Esa sesión ya informa a esta",
            changed: "La sesión se acaba de mover. Inténtalo de nuevo",
            forbidden: "No puedes ponerla debajo de esa sesión",
            failed: "No se pudo mover la sesión",
        },
    },
    kinds: {
        session: 'Sesión',
        workflowRun: 'Ejecución de flujo',
        backgroundRun: 'Ejecución en segundo plano',
    },
    showMore: ({ count }) => `Mostrar ${count} más`,
    role: {
        none: 'Ninguno',
        handsOff: 'sin editar',
        a11y: ({ role }) => `Rol: ${role}. Cambiar rol`,
    },
    empty: {
        title: 'Aún no hay trabajo',
        reason: 'Las sesiones, los flujos de trabajo y las ejecuciones en segundo plano que inicie esta sesión aparecerán aquí, junto con todo lo que te necesite.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} de ${total}`,
    strip: {
        openInSidebar: 'Abrir en la barra lateral',
        stillWorking: ({ count }) => `${count} aún trabajando`,
        needsYou: ({ count }) => `${count} te necesita${count === 1 ? '' : 'n'}`,
        a11y: ({ summary }) => `Trabajo: ${summary}`,
    },
    leadArchived: ({ count }) => `Esta sesión está archivada · ${count} aún trabajando`,
    runsStale: 'Las ejecuciones de flujos de trabajo pueden estar desactualizadas',
    list: {
        level: ({ level }) => `Nivel ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 subsesión' : `${count} subsesiones`),
        reportsWorking: ({ count }) => `${count} trabajando`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 subsesión te necesita' : `${count} subsesiones te necesitan`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Archivar también 1 subsesión' : `Archivar también ${count} subsesiones`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 subsesión no se archivó' : `${count} subsesiones no se archivaron`),
    },
    peek: {
        reportsTo: ({ lead }) => `Informa a ${lead}`,
        repliesGoHere: 'Las respuestas van a esta sesión',
    },
};

const fr: typeof en = {
    workerUpdate: {
        settled: "Terminé",
        stalled: "Bloqué",
        published: "Publié",
        truncated: "Résultat abrégé.",
        wokenBy: ({ count }) => (count === 1 ? 'Réveillé par une mise à jour' : `Réveillé par ${count} mises à jour`),
        notFromYou: 'pas un message de votre part',
    },
    title: 'Travail',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 session' : `${count} sessions`),
        runs: ({ count }) => (count === 1 ? '1 exécution' : `${count} exécutions`),
        nothingStarted: 'Rien de lancé',
    },
    states: {
        recent: 'Récents',
    },
    view: {
        a11y: 'Vue du travail',
        list: 'Liste',
        map: 'Carte',
        expandMap: 'Ouvrir la carte à côté de la session',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} sur ${total} sous ${parent}`,
    },
    actions: {
        makeOrchestrator: 'En faire un orchestrateur',
        makeOrchestratorSubtitle: 'Cette session planifie, délègue et rend compte',
        makeOrchestratorFailed: "Impossible de faire de cette session un orchestrateur",
    },
    putUnder: {
        title: "Placer sous…",
        subtitle: "Rendre compte à une autre session",
        search: "Trouver une session",
        topLevel: "Niveau supérieur — ne rend compte à personne",
        errors: {
            cycle: "Cette session rend déjà compte à celle-ci",
            changed: "La session vient d’être déplacée. Réessayez",
            forbidden: "Vous ne pouvez pas la placer sous cette session",
            failed: "Impossible de déplacer cette session",
        },
    },
    kinds: {
        session: 'Session',
        workflowRun: 'Exécution de workflow',
        backgroundRun: 'Exécution en arrière-plan',
    },
    showMore: ({ count }) => `Afficher ${count} de plus`,
    role: {
        none: 'Aucun',
        handsOff: 'sans les mains',
        a11y: ({ role }) => `Rôle : ${role}. Changer de rôle`,
    },
    empty: {
        title: 'Aucun travail lancé',
        reason: 'Les sessions, workflows et exécutions en arrière-plan lancés par cette session apparaîtront ici, avec tout ce qui a besoin de vous.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} sur ${total}`,
    strip: {
        openInSidebar: 'Ouvrir dans la barre latérale',
        stillWorking: ({ count }) => `${count} encore en cours`,
        needsYou: ({ count }) => `${count} a${count === 1 ? '' : 'ont'} besoin de vous`,
        a11y: ({ summary }) => `Travail : ${summary}`,
    },
    leadArchived: ({ count }) => `Cette session est archivée · ${count} encore en cours`,
    runsStale: 'Les exécutions de workflows ne sont peut-être pas à jour',
    list: {
        level: ({ level }) => `Niveau ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 sous-session' : `${count} sous-sessions`),
        reportsWorking: ({ count }) => `${count} en cours`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 sous-session a besoin de vous' : `${count} sous-sessions ont besoin de vous`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Archiver aussi 1 sous-session' : `Archiver aussi ${count} sous-sessions`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 sous-session n’a pas été archivée' : `${count} sous-sessions n’ont pas été archivées`),
    },
    peek: {
        reportsTo: ({ lead }) => `Rend compte à ${lead}`,
        repliesGoHere: 'Les réponses vont à cette session',
    },
};

const it: typeof en = {
    workerUpdate: {
        settled: "Concluso",
        stalled: "Bloccato",
        published: "Pubblicato",
        truncated: "Risultato abbreviato.",
        wokenBy: ({ count }) => (count === 1 ? 'Risvegliato da un aggiornamento' : `Risvegliato da ${count} aggiornamenti`),
        notFromYou: 'non è un tuo messaggio',
    },
    title: 'Lavoro',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 sessione' : `${count} sessioni`),
        runs: ({ count }) => (count === 1 ? '1 esecuzione' : `${count} esecuzioni`),
        nothingStarted: 'Ancora niente avviato',
    },
    states: {
        recent: 'Recenti',
    },
    view: {
        a11y: 'Vista del lavoro',
        list: 'Elenco',
        map: 'Mappa',
        expandMap: 'Apri la mappa accanto alla sessione',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} di ${total} sotto ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Rendila un orchestratore',
        makeOrchestratorSubtitle: 'Questa sessione pianifica, delega e riferisce',
        makeOrchestratorFailed: "Impossibile rendere la sessione un orchestratore",
    },
    putUnder: {
        title: "Metti sotto…",
        subtitle: "Riferisci a un’altra sessione",
        search: "Trova una sessione",
        topLevel: "Livello superiore — non riferisce a nessuno",
        errors: {
            cycle: "Quella sessione riferisce già a questa",
            changed: "La sessione è appena stata spostata. Riprova",
            forbidden: "Non puoi metterla sotto quella sessione",
            failed: "Impossibile spostare la sessione",
        },
    },
    kinds: {
        session: 'Sessione',
        workflowRun: 'Esecuzione del workflow',
        backgroundRun: 'Esecuzione in background',
    },
    showMore: ({ count }) => `Mostra altri ${count}`,
    role: {
        none: 'Nessuno',
        handsOff: 'senza modifiche',
        a11y: ({ role }) => `Ruolo: ${role}. Cambia ruolo`,
    },
    empty: {
        title: 'Nessun lavoro avviato',
        reason: 'Le sessioni, i workflow e le esecuzioni in background avviati da questa sessione appariranno qui, insieme a tutto ciò che ha bisogno di te.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} di ${total}`,
    strip: {
        openInSidebar: 'Apri nella barra laterale',
        stillWorking: ({ count }) => `${count} ancora al lavoro`,
        needsYou: ({ count }) => `${count} ha${count === 1 ? '' : 'nno'} bisogno di te`,
        a11y: ({ summary }) => `Lavoro: ${summary}`,
    },
    leadArchived: ({ count }) => `Questa sessione è archiviata · ${count} ancora al lavoro`,
    runsStale: 'Le esecuzioni dei workflow potrebbero non essere aggiornate',
    list: {
        level: ({ level }) => `Livello ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 sottosessione' : `${count} sottosessioni`),
        reportsWorking: ({ count }) => `${count} al lavoro`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 sottosessione ha bisogno di te' : `${count} sottosessioni hanno bisogno di te`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Archivia anche 1 sottosessione' : `Archivia anche ${count} sottosessioni`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 sottosessione non è stata archiviata' : `${count} sottosessioni non sono state archiviate`),
    },
    peek: {
        reportsTo: ({ lead }) => `Riferisce a ${lead}`,
        repliesGoHere: 'Le risposte vanno a questa sessione',
    },
};

const ja: typeof en = {
    workerUpdate: {
        settled: "完了",
        stalled: "停滞",
        published: "公開済み",
        truncated: "結果を短縮しました。",
        wokenBy: ({ count }) => (count === 1 ? '更新により再開' : `${count} 件の更新により再開`),
        notFromYou: 'あなたからのメッセージではありません',
    },
    title: '作業',
    subtitle: {
        sessions: ({ count }) => `${count} 件のセッション`,
        runs: ({ count }) => `${count} 件の実行`,
        nothingStarted: 'まだ何も開始していません',
    },
    states: {
        recent: '最近',
    },
    view: {
        a11y: '作業の表示',
        list: 'リスト',
        map: 'マップ',
        expandMap: 'セッションの横にマップを開く',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${parent} の下 ${position} / ${total}`,
    },
    actions: {
        makeOrchestrator: 'オーケストレーターにする',
        makeOrchestratorSubtitle: 'このセッションが計画・委任・報告を行います',
        makeOrchestratorFailed: "このセッションをオーケストレーターにできませんでした",
    },
    putUnder: {
        title: "配下に移動…",
        subtitle: "別のセッションに報告する",
        search: "セッションを検索",
        topLevel: "最上位 — 報告先なし",
        errors: {
            cycle: "そのセッションはすでにこのセッションに報告しています",
            changed: "このセッションは移動されたばかりです。もう一度お試しください",
            forbidden: "そのセッションの配下には移動できません",
            failed: "セッションを移動できませんでした",
        },
    },
    kinds: {
        session: 'セッション',
        workflowRun: 'ワークフロー実行',
        backgroundRun: 'バックグラウンド実行',
    },
    showMore: ({ count }) => `さらに ${count} 件を表示`,
    role: {
        none: 'なし',
        handsOff: '委任のみ',
        a11y: ({ role }) => `ロール: ${role}。ロールを変更`,
    },
    empty: {
        title: 'まだ作業はありません',
        reason: 'このセッションが開始したセッション、ワークフロー、バックグラウンド実行が、あなたの対応が必要なものと一緒にここに表示されます。',
    },
    row: {
        a11y: ({ title, status }) => `${title}、${status}`,
    },
    progress: ({ completed, total }) => `${completed} / ${total}`,
    strip: {
        openInSidebar: 'サイドバーで開く',
        stillWorking: ({ count }) => `${count} 件が作業中`,
        needsYou: ({ count }) => `${count} 件が対応待ち`,
        a11y: ({ summary }) => `作業: ${summary}`,
    },
    leadArchived: ({ count }) => `このセッションはアーカイブ済み · ${count} 件が作業中`,
    runsStale: 'ワークフローの実行が最新でない可能性があります',
    list: {
        level: ({ level }) => `レベル ${level}`,
        subSessions: ({ count }) => `${count} 件のサブセッション`,
        reportsWorking: ({ count }) => `${count} 件作業中`,
        reportsNeedYou: ({ count }) => `${count} 件のサブセッションが対応待ち`,
    },
    archive: {
        alsoArchiveReports: ({ count }) => `${count} 件のサブセッションもアーカイブ`,
        someNotArchivedTitle: ({ count }) => `${count} 件のサブセッションをアーカイブできませんでした`,
    },
    peek: {
        reportsTo: ({ lead }) => `${lead} に報告`,
        repliesGoHere: '返信はこのセッションに送られます',
    },
};

const pl: typeof en = {
    workerUpdate: {
        settled: "Zakończono",
        stalled: "Wstrzymano",
        published: "Opublikowano",
        truncated: "Wynik skrócony.",
        wokenBy: ({ count }) => (count === 1 ? 'Wybudzono przez aktualizację' : `Wybudzono przez aktualizacje: ${count}`),
        notFromYou: 'to nie jest twoja wiadomość',
    },
    title: 'Praca',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 sesja' : `${count} sesje`),
        runs: ({ count }) => (count === 1 ? '1 uruchomienie' : `${count} uruchomienia`),
        nothingStarted: 'Nic jeszcze nie uruchomiono',
    },
    states: {
        recent: 'Ostatnie',
    },
    view: {
        a11y: 'Widok pracy',
        list: 'Lista',
        map: 'Mapa',
        expandMap: 'Otwórz mapę obok sesji',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} z ${total} pod ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Ustaw jako orkiestratora',
        makeOrchestratorSubtitle: 'Ta sesja planuje, deleguje i raportuje',
        makeOrchestratorFailed: "Nie udało się ustawić sesji jako orkiestratora",
    },
    putUnder: {
        title: "Umieść pod…",
        subtitle: "Raportuj do innej sesji",
        search: "Znajdź sesję",
        topLevel: "Najwyższy poziom — nie raportuje do nikogo",
        errors: {
            cycle: "Ta sesja już raportuje do tej",
            changed: "Sesja została właśnie przeniesiona. Spróbuj ponownie",
            forbidden: "Nie możesz umieścić jej pod tą sesją",
            failed: "Nie udało się przenieść sesji",
        },
    },
    kinds: {
        session: 'Sesja',
        workflowRun: 'Uruchomienie przepływu',
        backgroundRun: 'Uruchomienie w tle',
    },
    showMore: ({ count }) => `Pokaż jeszcze ${count}`,
    role: {
        none: 'Brak',
        handsOff: 'bez edycji',
        a11y: ({ role }) => `Rola: ${role}. Zmień rolę`,
    },
    empty: {
        title: 'Nie rozpoczęto jeszcze pracy',
        reason: 'Sesje, przepływy pracy i uruchomienia w tle rozpoczęte przez tę sesję pojawią się tutaj, razem ze wszystkim, co wymaga Twojej uwagi.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} z ${total}`,
    strip: {
        openInSidebar: 'Otwórz na pasku bocznym',
        stillWorking: ({ count }) => `${count} nadal pracuje`,
        needsYou: ({ count }) => `${count} czeka na Ciebie`,
        a11y: ({ summary }) => `Praca: ${summary}`,
    },
    leadArchived: ({ count }) => `Ta sesja jest zarchiwizowana · ${count} nadal pracuje`,
    runsStale: 'Uruchomienia przepływów pracy mogą być nieaktualne',
    list: {
        level: ({ level }) => `Poziom ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 podsesja' : `Podsesje: ${count}`),
        reportsWorking: ({ count }) => `${count} pracuje`,
        reportsNeedYou: ({ count }) => `Podsesje czekające na Ciebie: ${count}`,
    },
    archive: {
        alsoArchiveReports: ({ count }) => `Zarchiwizuj też podsesje (${count})`,
        someNotArchivedTitle: ({ count }) => `Nie zarchiwizowano podsesji: ${count}`,
    },
    peek: {
        reportsTo: ({ lead }) => `Raportuje do ${lead}`,
        repliesGoHere: 'Odpowiedzi trafiają do tej sesji',
    },
};

const pt: typeof en = {
    workerUpdate: {
        settled: "Concluído",
        stalled: "Parado",
        published: "Publicado",
        truncated: "Resultado abreviado.",
        wokenBy: ({ count }) => (count === 1 ? 'Despertado por uma atualização' : `Despertado por ${count} atualizações`),
        notFromYou: 'não é uma mensagem sua',
    },
    title: 'Trabalho',
    subtitle: {
        sessions: ({ count }) => (count === 1 ? '1 sessão' : `${count} sessões`),
        runs: ({ count }) => (count === 1 ? '1 execução' : `${count} execuções`),
        nothingStarted: 'Nada iniciado ainda',
    },
    states: {
        recent: 'Recentes',
    },
    view: {
        a11y: 'Vista do trabalho',
        list: 'Lista',
        map: 'Mapa',
        expandMap: 'Abrir o mapa ao lado da sessão',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} de ${total} sob ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Tornar orquestrador',
        makeOrchestratorSubtitle: 'Esta sessão planeja, delega e reporta',
        makeOrchestratorFailed: "Não foi possível tornar esta sessão um orquestrador",
    },
    putUnder: {
        title: "Colocar sob…",
        subtitle: "Reportar a outra sessão",
        search: "Encontrar uma sessão",
        topLevel: "Nível superior — não reporta a ninguém",
        errors: {
            cycle: "Essa sessão já reporta a esta",
            changed: "A sessão acabou de ser movida. Tente novamente",
            forbidden: "Você não pode colocá-la sob essa sessão",
            failed: "Não foi possível mover a sessão",
        },
    },
    kinds: {
        session: 'Sessão',
        workflowRun: 'Execução de fluxo',
        backgroundRun: 'Execução em segundo plano',
    },
    showMore: ({ count }) => `Mostrar mais ${count}`,
    role: {
        none: 'Nenhum',
        handsOff: 'sem edição',
        a11y: ({ role }) => `Função: ${role}. Alterar função`,
    },
    empty: {
        title: 'Nenhum trabalho iniciado',
        reason: 'As sessões, os fluxos de trabalho e as execuções em segundo plano que esta sessão iniciar aparecerão aqui, com tudo o que precisar de você.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} de ${total}`,
    strip: {
        openInSidebar: 'Abrir na barra lateral',
        stillWorking: ({ count }) => `${count} ainda trabalhando`,
        needsYou: ({ count }) => `${count} precisa${count === 1 ? '' : 'm'} de você`,
        a11y: ({ summary }) => `Trabalho: ${summary}`,
    },
    leadArchived: ({ count }) => `Esta sessão está arquivada · ${count} ainda trabalhando`,
    runsStale: 'As execuções de fluxos de trabalho podem estar desatualizadas',
    list: {
        level: ({ level }) => `Nível ${level}`,
        subSessions: ({ count }) => (count === 1 ? '1 subsessão' : `${count} subsessões`),
        reportsWorking: ({ count }) => `${count} trabalhando`,
        reportsNeedYou: ({ count }) => (count === 1 ? '1 subsessão precisa de você' : `${count} subsessões precisam de você`),
    },
    archive: {
        alsoArchiveReports: ({ count }) => (count === 1 ? 'Arquivar também 1 subsessão' : `Arquivar também ${count} subsessões`),
        someNotArchivedTitle: ({ count }) => (count === 1 ? '1 subsessão não foi arquivada' : `${count} subsessões não foram arquivadas`),
    },
    peek: {
        reportsTo: ({ lead }) => `Reporta a ${lead}`,
        repliesGoHere: 'As respostas vão para esta sessão',
    },
};

const ru: typeof en = {
    workerUpdate: {
        settled: "Завершено",
        stalled: "Застопорилось",
        published: "Опубликовано",
        truncated: "Результат сокращён.",
        wokenBy: ({ count }) => (count === 1 ? 'Разбужено обновлением' : `Разбужено обновлениями: ${count}`),
        notFromYou: 'это не ваше сообщение',
    },
    title: 'Работа',
    subtitle: {
        sessions: ({ count }) => `Сессий: ${count}`,
        runs: ({ count }) => `Запусков: ${count}`,
        nothingStarted: 'Пока ничего не запущено',
    },
    states: {
        recent: 'Недавние',
    },
    view: {
        a11y: 'Вид работы',
        list: 'Список',
        map: 'Карта',
        expandMap: 'Открыть карту рядом с сессией',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${position} из ${total} под ${parent}`,
    },
    actions: {
        makeOrchestrator: 'Сделать оркестратором',
        makeOrchestratorSubtitle: 'Эта сессия планирует, делегирует и отчитывается',
        makeOrchestratorFailed: "Не удалось сделать сессию оркестратором",
    },
    putUnder: {
        title: "Подчинить…",
        subtitle: "Отчитываться перед другой сессией",
        search: "Найти сессию",
        topLevel: "Верхний уровень — ни перед кем не отчитывается",
        errors: {
            cycle: "Та сессия уже отчитывается перед этой",
            changed: "Сессию только что переместили. Попробуйте снова",
            forbidden: "Нельзя подчинить её этой сессии",
            failed: "Не удалось переместить сессию",
        },
    },
    kinds: {
        session: 'Сессия',
        workflowRun: 'Запуск процесса',
        backgroundRun: 'Фоновый запуск',
    },
    showMore: ({ count }) => `Показать ещё ${count}`,
    role: {
        none: 'Нет',
        handsOff: 'без правок',
        a11y: ({ role }) => `Роль: ${role}. Изменить роль`,
    },
    empty: {
        title: 'Работа ещё не начата',
        reason: 'Здесь появятся сессии, рабочие процессы и фоновые запуски, начатые этой сессией, вместе со всем, что требует вашего внимания.',
    },
    row: {
        a11y: ({ title, status }) => `${title}, ${status}`,
    },
    progress: ({ completed, total }) => `${completed} из ${total}`,
    strip: {
        openInSidebar: 'Открыть на боковой панели',
        stillWorking: ({ count }) => `В работе: ${count}`,
        needsYou: ({ count }) => `Ждут вас: ${count}`,
        a11y: ({ summary }) => `Работа: ${summary}`,
    },
    leadArchived: ({ count }) => `Эта сессия в архиве · в работе: ${count}`,
    runsStale: 'Запуски рабочих процессов могут быть неактуальны',
    list: {
        level: ({ level }) => `Уровень ${level}`,
        subSessions: ({ count }) => `Подсессий: ${count}`,
        reportsWorking: ({ count }) => `В работе: ${count}`,
        reportsNeedYou: ({ count }) => `Подсессий ждут вас: ${count}`,
    },
    archive: {
        alsoArchiveReports: ({ count }) => `Также архивировать подсессии (${count})`,
        someNotArchivedTitle: ({ count }) => `Не удалось архивировать подсессий: ${count}`,
    },
    peek: {
        reportsTo: ({ lead }) => `Отчитывается перед ${lead}`,
        repliesGoHere: 'Ответы уходят в эту сессию',
    },
};

const zhHans: typeof en = {
    workerUpdate: {
        settled: "已完成",
        stalled: "已停滞",
        published: "已发布",
        truncated: "结果已缩短。",
        wokenBy: ({ count }) => (count === 1 ? '由一条更新唤醒' : `由 ${count} 条更新唤醒`),
        notFromYou: '不是你发送的消息',
    },
    title: '工作',
    subtitle: {
        sessions: ({ count }) => `${count} 个会话`,
        runs: ({ count }) => `${count} 次运行`,
        nothingStarted: '尚未开始任何工作',
    },
    states: {
        recent: '最近',
    },
    view: {
        a11y: '工作视图',
        list: '列表',
        map: '地图',
        expandMap: '在会话旁打开地图',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${parent} 下的第 ${position}/${total} 项`,
    },
    actions: {
        makeOrchestrator: '设为编排者',
        makeOrchestratorSubtitle: '此会话负责规划、委派并汇报',
        makeOrchestratorFailed: "无法将此会话设为编排者",
    },
    putUnder: {
        title: "置于…之下",
        subtitle: "向另一个会话汇报",
        search: "查找会话",
        topLevel: "顶层 — 不向任何会话汇报",
        errors: {
            cycle: "该会话已向此会话汇报",
            changed: "该会话刚被移动，请重试",
            forbidden: "不能将其置于该会话之下",
            failed: "无法移动此会话",
        },
    },
    kinds: {
        session: '会话',
        workflowRun: '工作流运行',
        backgroundRun: '后台运行',
    },
    showMore: ({ count }) => `再显示 ${count} 项`,
    role: {
        none: '无',
        handsOff: '只委派',
        a11y: ({ role }) => `角色：${role}。更改角色`,
    },
    empty: {
        title: '尚未开始工作',
        reason: '此会话启动的会话、工作流和后台运行会显示在这里，需要你处理的事项也会一并显示。',
    },
    row: {
        a11y: ({ title, status }) => `${title}，${status}`,
    },
    progress: ({ completed, total }) => `${completed} / ${total}`,
    strip: {
        openInSidebar: '在侧边栏中打开',
        stillWorking: ({ count }) => `${count} 项仍在进行`,
        needsYou: ({ count }) => `${count} 项需要你`,
        a11y: ({ summary }) => `工作：${summary}`,
    },
    leadArchived: ({ count }) => `此会话已归档 · ${count} 项仍在进行`,
    runsStale: '工作流运行可能不是最新的',
    list: {
        level: ({ level }) => `第 ${level} 级`,
        subSessions: ({ count }) => `${count} 个子会话`,
        reportsWorking: ({ count }) => `${count} 个进行中`,
        reportsNeedYou: ({ count }) => `${count} 个子会话需要你`,
    },
    archive: {
        alsoArchiveReports: ({ count }) => `同时归档 ${count} 个子会话`,
        someNotArchivedTitle: ({ count }) => `有 ${count} 个子会话未归档`,
    },
    peek: {
        reportsTo: ({ lead }) => `向 ${lead} 汇报`,
        repliesGoHere: '回复会发送到此会话',
    },
};

const zhHant: typeof en = {
    workerUpdate: {
        settled: "已完成",
        stalled: "已停滯",
        published: "已發佈",
        truncated: "結果已縮短。",
        wokenBy: ({ count }) => (count === 1 ? '由一則更新喚醒' : `由 ${count} 則更新喚醒`),
        notFromYou: '不是你傳送的訊息',
    },
    title: '工作',
    subtitle: {
        sessions: ({ count }) => `${count} 個工作階段`,
        runs: ({ count }) => `${count} 次執行`,
        nothingStarted: '尚未開始任何工作',
    },
    states: {
        recent: '最近',
    },
    view: {
        a11y: '工作檢視',
        list: '清單',
        map: '地圖',
        expandMap: '在工作階段旁開啟地圖',
    },
    map: {
        positionUnder: ({ position, total, parent }) => `${parent} 下的第 ${position}/${total} 項`,
    },
    actions: {
        makeOrchestrator: '設為編排者',
        makeOrchestratorSubtitle: '此工作階段負責規劃、委派並回報',
        makeOrchestratorFailed: "無法將此工作階段設為編排者",
    },
    putUnder: {
        title: "置於…之下",
        subtitle: "向另一個工作階段回報",
        search: "尋找工作階段",
        topLevel: "最上層 — 不向任何工作階段回報",
        errors: {
            cycle: "該工作階段已向此工作階段回報",
            changed: "此工作階段剛被移動，請再試一次",
            forbidden: "無法將其置於該工作階段之下",
            failed: "無法移動此工作階段",
        },
    },
    kinds: {
        session: '工作階段',
        workflowRun: '工作流程執行',
        backgroundRun: '背景執行',
    },
    showMore: ({ count }) => `再顯示 ${count} 項`,
    role: {
        none: '無',
        handsOff: '只委派',
        a11y: ({ role }) => `角色：${role}。變更角色`,
    },
    empty: {
        title: '尚未開始工作',
        reason: '此工作階段啟動的工作階段、工作流程和背景執行會顯示在這裡，需要你處理的事項也會一併顯示。',
    },
    row: {
        a11y: ({ title, status }) => `${title}，${status}`,
    },
    progress: ({ completed, total }) => `${completed} / ${total}`,
    strip: {
        openInSidebar: '在側邊欄中開啟',
        stillWorking: ({ count }) => `${count} 項仍在進行`,
        needsYou: ({ count }) => `${count} 項需要你`,
        a11y: ({ summary }) => `工作：${summary}`,
    },
    leadArchived: ({ count }) => `此工作階段已封存 · ${count} 項仍在進行`,
    runsStale: '工作流程執行可能不是最新的',
    list: {
        level: ({ level }) => `第 ${level} 層`,
        subSessions: ({ count }) => `${count} 個子工作階段`,
        reportsWorking: ({ count }) => `${count} 個進行中`,
        reportsNeedYou: ({ count }) => `${count} 個子工作階段需要你`,
    },
    archive: {
        alsoArchiveReports: ({ count }) => `同時封存 ${count} 個子工作階段`,
        someNotArchivedTitle: ({ count }) => `有 ${count} 個子工作階段未封存`,
    },
    peek: {
        reportsTo: ({ lead }) => `向 ${lead} 回報`,
        repliesGoHere: '回覆會傳送到此工作階段',
    },
};

export const sessionWorkTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
