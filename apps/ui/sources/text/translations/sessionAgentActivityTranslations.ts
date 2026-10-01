/**
 * Copy for the shared Session Agent-activity summary.
 *
 * One module, because these strings are read from ONE presentation resolver: the roster row, the
 * Details overview and a conversation's run reference must say the same words about the same entry,
 * and spreading them across twelve locale files is how one state ends up with two names. The module
 * keeps that single owner while still carrying a real translation per locale — the vocabulary is
 * read aloud by VoiceOver/TalkBack, so an English-only block would speak English on every surface.
 *
 * Status labels exist at all because surfaces previously rendered the raw
 * `AgentActivityStatusV1`/provider status token (`running`, `timedOut`) straight onto the screen.
 */
const en = {
    status: {
        queued: 'Queued',
        starting: 'Starting',
        running: 'Running',
        waiting: 'Waiting',
        blocked: 'Blocked',
        succeeded: 'Completed',
        failed: 'Failed',
        timedOut: 'Timed out',
        cancelled: 'Stopped',
        unknown: 'Unknown',
    },
    attention: {
        /** A tool wants to run and someone has to approve it. */
        permission: 'Needs approval',
        /** The agent asked a question and is waiting on an answer. */
        userAction: 'Needs your answer',
        /**
         * Both at once. The badge stays one short phrase so a dense row does not grow a second
         * line; `bothDescription` is what a screen reader hears, and it names both facts.
         */
        both: 'Needs attention',
        bothDescription: 'Needs approval and needs your answer',
    },
    /** `<title>, <status>` — the spoken form of a row whose status is a badge beside the title. */
    /** The Agents roster: what is working, what waits on a person, what finished. */
    /** What kind of work a Run is, from its canonical intent and class — never a raw token. */
    runKind: {
        conversation: 'Conversation',
        review: 'Review',
        plan: 'Plan',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }: { team: string; count: number }) => `Team ${team} · ${count} ${count === 1 ? 'agent' : 'agents'}`,
        teamActionsA11y: 'Team actions',
        openWork: 'Open',
        needsYouCount: ({ count }: { count: number }) => `${count} needs you`,
        runningCount: ({ count }: { count: number }) => `${count} running`,
        nothingRunning: 'Nothing running.',
        startAgent: 'Start an agent',
        machineOffline: ({ machine }: { machine: string }) => `${machine} isn’t answering`,
        machineOfflineUnnamed: 'The machine isn’t answering',
        launch: {
            menuA11y: 'Start an agent',
            conversationDescription: 'Talk to an agent beside this session',
            reviewDescription: 'Check the changes so far',
            planDescription: 'Work out the next steps',
            delegateDescription: 'Hand off a task and get it back done',
            advancedDescription: 'Choose agents, permissions and profile',
        },
        empty: {
            title: 'Put more agents on this session',
            reason: ({ machine }: { machine: string }) => `Start a side conversation, or ask one to review or plan while you keep working. They run on ${machine} and report back here.`,
            reasonUnnamed: 'Start a side conversation, or ask one to review or plan while you keep working. They report back here.',
            moreWays: 'Ask for a review, plan or delegate',
        },
        unavailable: {
            notEnabled: 'Agents can’t start on this Home.',
            machineOffline: ({ machine }: { machine: string }) => `Starting agents needs ${machine} online.`,
            machineOfflineUnnamed: 'Starting agents needs this machine online.',
            sessionInactive: 'This session has stopped. Resume it to start agents here.',
            externalRunnerInactive: 'This session was started outside Happier. Agents can start from here while Happier is attached to it.',
        },
    },
    summaryA11y: ({ title, status }: { title: string; status: string }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }: { title: string; status: string; attention: string }) =>
        `${title}, ${status}, ${attention}`,
};

const ca: typeof en = {
    status: {
        queued: 'En cua',
        starting: 'Iniciant',
        running: 'En execució',
        waiting: 'Esperant',
        blocked: 'Bloquejat',
        succeeded: 'Completat',
        failed: 'Ha fallat',
        timedOut: 'Temps esgotat',
        cancelled: 'Aturat',
        unknown: 'Desconegut',
    },
    attention: {
        permission: 'Cal aprovació',
        userAction: 'Cal la teva resposta',
        both: 'Necessita atenció',
        bothDescription: 'Cal aprovació i cal la teva resposta',
    },
    runKind: {
        conversation: 'Conversa',
        review: 'Revisió',
        plan: 'Pla',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Equip ${team} · ${count} ${count === 1 ? 'agent' : 'agents'}`,
        teamActionsA11y: 'Accions de l’equip',
        openWork: 'Obre',
        needsYouCount: ({ count }) => `${count} et necessiten`,
        runningCount: ({ count }) => `${count} en execució`,
        nothingRunning: 'No hi ha res en execució.',
        startAgent: 'Inicia un agent',
        machineOffline: ({ machine }) => `${machine} no respon`,
        machineOfflineUnnamed: 'La màquina no respon',
        launch: {
            menuA11y: 'Inicia un agent',
            conversationDescription: 'Parla amb un agent al costat d’aquesta sessió',
            reviewDescription: 'Revisa els canvis fins ara',
            planDescription: 'Planifica els passos següents',
            delegateDescription: 'Delega una tasca i recupera-la feta',
            advancedDescription: 'Tria agents, permisos i perfil',
        },
        empty: {
            title: 'Posa més agents en aquesta sessió',
            reason: ({ machine }) => `Comença una conversa paral·lela, o demana una revisió o un pla mentre continues treballant. S’executen a ${machine} i t’informen aquí.`,
            reasonUnnamed: 'Comença una conversa paral·lela, o demana una revisió o un pla mentre continues treballant. T’informen aquí.',
            moreWays: 'Demana una revisió, un pla o una delegació',
        },
        unavailable: {
            notEnabled: 'Els agents no es poden iniciar en aquesta Home.',
            machineOffline: ({ machine }) => `Per iniciar agents cal que ${machine} estigui en línia.`,
            machineOfflineUnnamed: 'Per iniciar agents cal que aquesta màquina estigui en línia.',
            sessionInactive: 'Aquesta sessió s’ha aturat. Reprèn-la per iniciar agents aquí.',
            externalRunnerInactive: 'Aquesta sessió es va iniciar fora de Happier. Els agents es poden iniciar des d’aquí mentre Happier hi estigui connectat.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const de: typeof en = {
    status: {
        queued: 'In Warteschlange',
        starting: 'Wird gestartet',
        running: 'Läuft',
        waiting: 'Wartet',
        blocked: 'Blockiert',
        succeeded: 'Abgeschlossen',
        failed: 'Fehlgeschlagen',
        timedOut: 'Zeitüberschreitung',
        cancelled: 'Gestoppt',
        unknown: 'Unbekannt',
    },
    attention: {
        permission: 'Freigabe erforderlich',
        userAction: 'Antwort erforderlich',
        both: 'Benötigt Aufmerksamkeit',
        bothDescription: 'Freigabe und deine Antwort erforderlich',
    },
    runKind: {
        conversation: 'Unterhaltung',
        review: 'Review',
        plan: 'Plan',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Team ${team} · ${count} ${count === 1 ? 'Agent' : 'Agents'}`,
        teamActionsA11y: 'Team-Aktionen',
        openWork: 'Öffnen',
        needsYouCount: ({ count }) => `${count} brauchen dich`,
        runningCount: ({ count }) => `${count} laufen`,
        nothingRunning: 'Nichts läuft.',
        startAgent: 'Agent starten',
        machineOffline: ({ machine }) => `${machine} antwortet nicht`,
        machineOfflineUnnamed: 'Die Maschine antwortet nicht',
        launch: {
            menuA11y: 'Agent starten',
            conversationDescription: 'Mit einem Agenten neben dieser Sitzung sprechen',
            reviewDescription: 'Die bisherigen Änderungen prüfen',
            planDescription: 'Die nächsten Schritte planen',
            delegateDescription: 'Eine Aufgabe abgeben und erledigt zurückbekommen',
            advancedDescription: 'Agenten, Berechtigungen und Profil wählen',
        },
        empty: {
            title: 'Mehr Agenten auf diese Sitzung setzen',
            reason: ({ machine }) => `Starte ein Nebengespräch oder lass prüfen oder planen, während du weiterarbeitest. Sie laufen auf ${machine} und berichten hier.`,
            reasonUnnamed: 'Starte ein Nebengespräch oder lass prüfen oder planen, während du weiterarbeitest. Sie berichten hier.',
            moreWays: 'Review, Plan oder Delegation anfragen',
        },
        unavailable: {
            notEnabled: 'Agenten können in diesem Home nicht starten.',
            machineOffline: ({ machine }) => `Zum Starten von Agenten muss ${machine} online sein.`,
            machineOfflineUnnamed: 'Zum Starten von Agenten muss diese Maschine online sein.',
            sessionInactive: 'Diese Sitzung wurde beendet. Setze sie fort, um hier Agenten zu starten.',
            externalRunnerInactive: 'Diese Sitzung wurde außerhalb von Happier gestartet. Agenten können von hier starten, solange Happier verbunden ist.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const es: typeof en = {
    status: {
        queued: 'En cola',
        starting: 'Iniciando',
        running: 'En ejecución',
        waiting: 'Esperando',
        blocked: 'Bloqueado',
        succeeded: 'Completado',
        failed: 'Ha fallado',
        timedOut: 'Tiempo agotado',
        cancelled: 'Detenido',
        unknown: 'Desconocido',
    },
    attention: {
        permission: 'Necesita aprobación',
        userAction: 'Necesita tu respuesta',
        both: 'Necesita atención',
        bothDescription: 'Necesita aprobación y tu respuesta',
    },
    runKind: {
        conversation: 'Conversación',
        review: 'Revisión',
        plan: 'Plan',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Equipo ${team} · ${count} ${count === 1 ? 'agente' : 'agentes'}`,
        teamActionsA11y: 'Acciones del equipo',
        openWork: 'Abrir',
        needsYouCount: ({ count }) => `${count} te necesitan`,
        runningCount: ({ count }) => `${count} en ejecución`,
        nothingRunning: 'Nada en ejecución.',
        startAgent: 'Iniciar un agente',
        machineOffline: ({ machine }) => `${machine} no responde`,
        machineOfflineUnnamed: 'La máquina no responde',
        launch: {
            menuA11y: 'Iniciar un agente',
            conversationDescription: 'Habla con un agente junto a esta sesión',
            reviewDescription: 'Revisa los cambios hasta ahora',
            planDescription: 'Planifica los siguientes pasos',
            delegateDescription: 'Delega una tarea y recíbela hecha',
            advancedDescription: 'Elige agentes, permisos y perfil',
        },
        empty: {
            title: 'Pon más agentes en esta sesión',
            reason: ({ machine }) => `Empieza una conversación paralela, o pide una revisión o un plan mientras sigues trabajando. Se ejecutan en ${machine} y te informan aquí.`,
            reasonUnnamed: 'Empieza una conversación paralela, o pide una revisión o un plan mientras sigues trabajando. Te informan aquí.',
            moreWays: 'Pide una revisión, un plan o una delegación',
        },
        unavailable: {
            notEnabled: 'Los agentes no pueden iniciarse en este Home.',
            machineOffline: ({ machine }) => `Para iniciar agentes, ${machine} debe estar en línea.`,
            machineOfflineUnnamed: 'Para iniciar agentes, esta máquina debe estar en línea.',
            sessionInactive: 'Esta sesión se detuvo. Reanúdala para iniciar agentes aquí.',
            externalRunnerInactive: 'Esta sesión se inició fuera de Happier. Los agentes pueden iniciarse desde aquí mientras Happier esté conectado.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const fr: typeof en = {
    status: {
        queued: 'En file d’attente',
        starting: 'Démarrage',
        running: 'En cours',
        waiting: 'En attente',
        blocked: 'Bloqué',
        succeeded: 'Terminé',
        failed: 'Échec',
        timedOut: 'Délai dépassé',
        cancelled: 'Arrêté',
        unknown: 'Inconnu',
    },
    attention: {
        permission: 'Approbation requise',
        userAction: 'Votre réponse est requise',
        both: 'Nécessite votre attention',
        bothDescription: 'Approbation et votre réponse requises',
    },
    runKind: {
        conversation: 'Conversation',
        review: 'Revue',
        plan: 'Plan',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Équipe ${team} · ${count} ${count === 1 ? 'agent' : 'agents'}`,
        teamActionsA11y: 'Actions de l’équipe',
        openWork: 'Ouvrir',
        needsYouCount: ({ count }) => `${count} ont besoin de vous`,
        runningCount: ({ count }) => `${count} en cours`,
        nothingRunning: 'Rien en cours.',
        startAgent: 'Démarrer un agent',
        machineOffline: ({ machine }) => `${machine} ne répond pas`,
        machineOfflineUnnamed: 'La machine ne répond pas',
        launch: {
            menuA11y: 'Démarrer un agent',
            conversationDescription: 'Parler à un agent à côté de cette session',
            reviewDescription: 'Relire les changements faits jusqu’ici',
            planDescription: 'Préparer les prochaines étapes',
            delegateDescription: 'Confier une tâche et la récupérer terminée',
            advancedDescription: 'Choisir les agents, les autorisations et le profil',
        },
        empty: {
            title: 'Mettez plus d’agents sur cette session',
            reason: ({ machine }) => `Lancez une conversation en parallèle, ou demandez une relecture ou un plan pendant que vous continuez. Ils tournent sur ${machine} et rendent compte ici.`,
            reasonUnnamed: 'Lancez une conversation en parallèle, ou demandez une relecture ou un plan pendant que vous continuez. Ils rendent compte ici.',
            moreWays: 'Demander une relecture, un plan ou une délégation',
        },
        unavailable: {
            notEnabled: 'Les agents ne peuvent pas démarrer sur ce Home.',
            machineOffline: ({ machine }) => `Démarrer des agents nécessite que ${machine} soit en ligne.`,
            machineOfflineUnnamed: 'Démarrer des agents nécessite que cette machine soit en ligne.',
            sessionInactive: 'Cette session est arrêtée. Reprenez-la pour démarrer des agents ici.',
            externalRunnerInactive: 'Cette session a été lancée hors de Happier. Les agents peuvent démarrer d’ici tant que Happier y est attaché.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const it: typeof en = {
    status: {
        queued: 'In coda',
        starting: 'Avvio',
        running: 'In esecuzione',
        waiting: 'In attesa',
        blocked: 'Bloccato',
        succeeded: 'Completato',
        failed: 'Non riuscito',
        timedOut: 'Tempo scaduto',
        cancelled: 'Interrotto',
        unknown: 'Sconosciuto',
    },
    attention: {
        permission: 'Richiede approvazione',
        userAction: 'Richiede la tua risposta',
        both: 'Richiede attenzione',
        bothDescription: 'Richiede approvazione e la tua risposta',
    },
    runKind: {
        conversation: 'Conversazione',
        review: 'Revisione',
        plan: 'Piano',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Team ${team} · ${count} ${count === 1 ? 'agente' : 'agenti'}`,
        teamActionsA11y: 'Azioni del team',
        openWork: 'Apri',
        needsYouCount: ({ count }) => `${count} hanno bisogno di te`,
        runningCount: ({ count }) => `${count} in esecuzione`,
        nothingRunning: 'Niente in esecuzione.',
        startAgent: 'Avvia un agente',
        machineOffline: ({ machine }) => `${machine} non risponde`,
        machineOfflineUnnamed: 'La macchina non risponde',
        launch: {
            menuA11y: 'Avvia un agente',
            conversationDescription: 'Parla con un agente accanto a questa sessione',
            reviewDescription: 'Controlla le modifiche fatte finora',
            planDescription: 'Pianifica i prossimi passi',
            delegateDescription: 'Affida un compito e ricevilo completato',
            advancedDescription: 'Scegli agenti, permessi e profilo',
        },
        empty: {
            title: 'Metti più agenti su questa sessione',
            reason: ({ machine }) => `Avvia una conversazione parallela, o chiedi una revisione o un piano mentre continui a lavorare. Girano su ${machine} e riferiscono qui.`,
            reasonUnnamed: 'Avvia una conversazione parallela, o chiedi una revisione o un piano mentre continui a lavorare. Riferiscono qui.',
            moreWays: 'Chiedi una revisione, un piano o una delega',
        },
        unavailable: {
            notEnabled: 'Gli agenti non possono avviarsi in questo Home.',
            machineOffline: ({ machine }) => `Per avviare agenti ${machine} deve essere online.`,
            machineOfflineUnnamed: 'Per avviare agenti questa macchina deve essere online.',
            sessionInactive: 'Questa sessione è stata fermata. Riprendila per avviare agenti qui.',
            externalRunnerInactive: 'Questa sessione è stata avviata fuori da Happier. Gli agenti possono avviarsi da qui finché Happier è collegato.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const ja: typeof en = {
    status: {
        queued: 'キュー待ち',
        starting: '開始中',
        running: '実行中',
        waiting: '待機中',
        blocked: 'ブロック中',
        succeeded: '完了',
        failed: '失敗',
        timedOut: 'タイムアウト',
        cancelled: '停止済み',
        unknown: '不明',
    },
    attention: {
        permission: '承認が必要',
        userAction: '回答が必要',
        both: '対応が必要',
        bothDescription: '承認と回答が必要です',
    },
    runKind: {
        conversation: '会話',
        review: 'レビュー',
        plan: '計画',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `チーム ${team} · エージェント ${count} 件`,
        teamActionsA11y: 'チームの操作',
        openWork: '開く',
        needsYouCount: ({ count }) => `${count} 件が対応待ち`,
        runningCount: ({ count }) => `${count} 件が実行中`,
        nothingRunning: '実行中のものはありません。',
        startAgent: 'エージェントを開始',
        machineOffline: ({ machine }) => `${machine} が応答していません`,
        machineOfflineUnnamed: 'マシンが応答していません',
        launch: {
            menuA11y: 'エージェントを開始',
            conversationDescription: 'このセッションの横でエージェントと話す',
            reviewDescription: 'ここまでの変更を確認する',
            planDescription: '次の手順を計画する',
            delegateDescription: 'タスクを任せて完了した状態で受け取る',
            advancedDescription: 'エージェント、権限、プロファイルを選ぶ',
        },
        empty: {
            title: 'このセッションにエージェントを追加',
            reason: ({ machine }) => `作業を続けながら、別の会話を始めたり、レビューや計画を頼んだりできます。${machine} で実行され、ここに報告します。`,
            reasonUnnamed: '作業を続けながら、別の会話を始めたり、レビューや計画を頼んだりできます。ここに報告します。',
            moreWays: 'レビュー、計画、委任を依頼する',
        },
        unavailable: {
            notEnabled: 'この Home ではエージェントを開始できません。',
            machineOffline: ({ machine }) => `エージェントを開始するには ${machine} がオンラインである必要があります。`,
            machineOfflineUnnamed: 'エージェントを開始するにはこのマシンがオンラインである必要があります。',
            sessionInactive: 'このセッションは停止しています。ここでエージェントを開始するには再開してください。',
            externalRunnerInactive: 'このセッションは Happier の外で開始されました。Happier が接続している間はここからエージェントを開始できます。',
        },
    },
    summaryA11y: ({ title, status }) => `${title}、${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}、${status}、${attention}`,
};

const pl: typeof en = {
    status: {
        queued: 'W kolejce',
        starting: 'Uruchamianie',
        running: 'W trakcie',
        waiting: 'Oczekiwanie',
        blocked: 'Zablokowane',
        succeeded: 'Ukończono',
        failed: 'Niepowodzenie',
        timedOut: 'Przekroczono czas',
        cancelled: 'Zatrzymane',
        unknown: 'Nieznany',
    },
    attention: {
        permission: 'Wymaga zatwierdzenia',
        userAction: 'Wymaga Twojej odpowiedzi',
        both: 'Wymaga uwagi',
        bothDescription: 'Wymaga zatwierdzenia i Twojej odpowiedzi',
    },
    runKind: {
        conversation: 'Rozmowa',
        review: 'Przegląd',
        plan: 'Plan',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Zespół ${team} · agenci: ${count}`,
        teamActionsA11y: 'Działania zespołu',
        openWork: 'Otwórz',
        needsYouCount: ({ count }) => `Czekają na ciebie: ${count}`,
        runningCount: ({ count }) => `Działa: ${count}`,
        nothingRunning: 'Nic nie działa.',
        startAgent: 'Uruchom agenta',
        machineOffline: ({ machine }) => `${machine} nie odpowiada`,
        machineOfflineUnnamed: 'Maszyna nie odpowiada',
        launch: {
            menuA11y: 'Uruchom agenta',
            conversationDescription: 'Porozmawiaj z agentem obok tej sesji',
            reviewDescription: 'Sprawdź dotychczasowe zmiany',
            planDescription: 'Zaplanuj kolejne kroki',
            delegateDescription: 'Przekaż zadanie i odbierz je gotowe',
            advancedDescription: 'Wybierz agentów, uprawnienia i profil',
        },
        empty: {
            title: 'Dodaj więcej agentów do tej sesji',
            reason: ({ machine }) => `Rozpocznij rozmowę obok albo poproś o przegląd lub plan, a sam pracuj dalej. Działają na ${machine} i raportują tutaj.`,
            reasonUnnamed: 'Rozpocznij rozmowę obok albo poproś o przegląd lub plan, a sam pracuj dalej. Raportują tutaj.',
            moreWays: 'Poproś o przegląd, plan lub delegowanie',
        },
        unavailable: {
            notEnabled: 'Agenci nie mogą startować w tym Home.',
            machineOffline: ({ machine }) => `Uruchamianie agentów wymaga, by ${machine} był online.`,
            machineOfflineUnnamed: 'Uruchamianie agentów wymaga, by ta maszyna była online.',
            sessionInactive: 'Ta sesja została zatrzymana. Wznów ją, aby uruchamiać tu agentów.',
            externalRunnerInactive: 'Ta sesja została uruchomiona poza Happier. Agentów można uruchamiać stąd, gdy Happier jest do niej podłączony.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const pt: typeof en = {
    status: {
        queued: 'Na fila',
        starting: 'A iniciar',
        running: 'Em execução',
        waiting: 'À espera',
        blocked: 'Bloqueado',
        succeeded: 'Concluído',
        failed: 'Falhou',
        timedOut: 'Tempo esgotado',
        cancelled: 'Parado',
        unknown: 'Desconhecido',
    },
    attention: {
        permission: 'Precisa de aprovação',
        userAction: 'Precisa da sua resposta',
        both: 'Precisa de atenção',
        bothDescription: 'Precisa de aprovação e da sua resposta',
    },
    runKind: {
        conversation: 'Conversa',
        review: 'Revisão',
        plan: 'Plano',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Equipe ${team} · ${count} ${count === 1 ? 'agente' : 'agentes'}`,
        teamActionsA11y: 'Ações da equipe',
        openWork: 'Abrir',
        needsYouCount: ({ count }) => `${count} precisam de você`,
        runningCount: ({ count }) => `${count} em execução`,
        nothingRunning: 'Nada em execução.',
        startAgent: 'Iniciar um agente',
        machineOffline: ({ machine }) => `${machine} não está respondendo`,
        machineOfflineUnnamed: 'A máquina não está respondendo',
        launch: {
            menuA11y: 'Iniciar um agente',
            conversationDescription: 'Converse com um agente ao lado desta sessão',
            reviewDescription: 'Revise as mudanças até agora',
            planDescription: 'Planeje os próximos passos',
            delegateDescription: 'Delegue uma tarefa e receba-a pronta',
            advancedDescription: 'Escolha agentes, permissões e perfil',
        },
        empty: {
            title: 'Coloque mais agentes nesta sessão',
            reason: ({ machine }) => `Comece uma conversa paralela, ou peça uma revisão ou um plano enquanto continua trabalhando. Eles rodam em ${machine} e reportam aqui.`,
            reasonUnnamed: 'Comece uma conversa paralela, ou peça uma revisão ou um plano enquanto continua trabalhando. Eles reportam aqui.',
            moreWays: 'Peça uma revisão, um plano ou uma delegação',
        },
        unavailable: {
            notEnabled: 'Agentes não podem iniciar neste Home.',
            machineOffline: ({ machine }) => `Iniciar agentes exige que ${machine} esteja online.`,
            machineOfflineUnnamed: 'Iniciar agentes exige que esta máquina esteja online.',
            sessionInactive: 'Esta sessão parou. Retome-a para iniciar agentes aqui.',
            externalRunnerInactive: 'Esta sessão foi iniciada fora do Happier. Agentes podem iniciar daqui enquanto o Happier estiver conectado.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const ru: typeof en = {
    status: {
        queued: 'В очереди',
        starting: 'Запускается',
        running: 'Выполняется',
        waiting: 'Ожидание',
        blocked: 'Заблокировано',
        succeeded: 'Завершено',
        failed: 'Ошибка',
        timedOut: 'Время истекло',
        cancelled: 'Остановлено',
        unknown: 'Неизвестно',
    },
    attention: {
        permission: 'Нужно подтверждение',
        userAction: 'Нужен ваш ответ',
        both: 'Требует внимания',
        bothDescription: 'Нужно подтверждение и ваш ответ',
    },
    runKind: {
        conversation: 'Беседа',
        review: 'Ревью',
        plan: 'План',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `Команда ${team} · агентов: ${count}`,
        teamActionsA11y: 'Действия команды',
        openWork: 'Открыть',
        needsYouCount: ({ count }) => `Ждут вас: ${count}`,
        runningCount: ({ count }) => `Работают: ${count}`,
        nothingRunning: 'Ничего не выполняется.',
        startAgent: 'Запустить агента',
        machineOffline: ({ machine }) => `${machine} не отвечает`,
        machineOfflineUnnamed: 'Машина не отвечает',
        launch: {
            menuA11y: 'Запустить агента',
            conversationDescription: 'Поговорить с агентом рядом с этой сессией',
            reviewDescription: 'Проверить изменения на данный момент',
            planDescription: 'Продумать следующие шаги',
            delegateDescription: 'Передать задачу и получить её готовой',
            advancedDescription: 'Выбрать агентов, разрешения и профиль',
        },
        empty: {
            title: 'Добавьте агентов в эту сессию',
            reason: ({ machine }) => `Начните параллельный разговор или попросите ревью или план, пока продолжаете работу. Они работают на ${machine} и отчитываются здесь.`,
            reasonUnnamed: 'Начните параллельный разговор или попросите ревью или план, пока продолжаете работу. Они отчитываются здесь.',
            moreWays: 'Попросить ревью, план или делегирование',
        },
        unavailable: {
            notEnabled: 'В этом Home агентов запускать нельзя.',
            machineOffline: ({ machine }) => `Чтобы запускать агентов, ${machine} должна быть в сети.`,
            machineOfflineUnnamed: 'Чтобы запускать агентов, эта машина должна быть в сети.',
            sessionInactive: 'Эта сессия остановлена. Возобновите её, чтобы запускать здесь агентов.',
            externalRunnerInactive: 'Эта сессия запущена вне Happier. Агентов можно запускать отсюда, пока Happier к ней подключён.',
        },
    },
    summaryA11y: ({ title, status }) => `${title}, ${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}, ${status}, ${attention}`,
};

const zhHans: typeof en = {
    status: {
        queued: '排队中',
        starting: '正在启动',
        running: '运行中',
        waiting: '等待中',
        blocked: '已阻塞',
        succeeded: '已完成',
        failed: '失败',
        timedOut: '已超时',
        cancelled: '已停止',
        unknown: '未知',
    },
    attention: {
        permission: '需要批准',
        userAction: '需要你的回答',
        both: '需要处理',
        bothDescription: '需要批准，也需要你的回答',
    },
    runKind: {
        conversation: '对话',
        review: '审查',
        plan: '计划',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `团队 ${team} · ${count} 个代理`,
        teamActionsA11y: '团队操作',
        openWork: '打开',
        needsYouCount: ({ count }) => `${count} 个需要你处理`,
        runningCount: ({ count }) => `${count} 个运行中`,
        nothingRunning: '没有正在运行的内容。',
        startAgent: '启动代理',
        machineOffline: ({ machine }) => `${machine} 没有响应`,
        machineOfflineUnnamed: '机器没有响应',
        launch: {
            menuA11y: '启动代理',
            conversationDescription: '在此会话旁与代理对话',
            reviewDescription: '检查目前为止的更改',
            planDescription: '规划接下来的步骤',
            delegateDescription: '交出任务并取回完成结果',
            advancedDescription: '选择代理、权限和配置文件',
        },
        empty: {
            title: '为此会话添加更多代理',
            reason: ({ machine }) => `在你继续工作时，开始一段旁路对话，或请代理审查或规划。它们在 ${machine} 上运行，并在这里汇报。`,
            reasonUnnamed: '在你继续工作时，开始一段旁路对话，或请代理审查或规划。它们会在这里汇报。',
            moreWays: '请求审查、规划或委派',
        },
        unavailable: {
            notEnabled: '此 Home 无法启动代理。',
            machineOffline: ({ machine }) => `启动代理需要 ${machine} 在线。`,
            machineOfflineUnnamed: '启动代理需要这台机器在线。',
            sessionInactive: '此会话已停止。恢复它即可在这里启动代理。',
            externalRunnerInactive: '此会话是在 Happier 之外启动的。Happier 连接期间可以从这里启动代理。',
        },
    },
    summaryA11y: ({ title, status }) => `${title}，${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}，${status}，${attention}`,
};

const zhHant: typeof en = {
    status: {
        queued: '排隊中',
        starting: '正在啟動',
        running: '執行中',
        waiting: '等待中',
        blocked: '已封鎖',
        succeeded: '已完成',
        failed: '失敗',
        timedOut: '已逾時',
        cancelled: '已停止',
        unknown: '未知',
    },
    attention: {
        permission: '需要核准',
        userAction: '需要你的回覆',
        both: '需要處理',
        bothDescription: '需要核准，也需要你的回覆',
    },
    runKind: {
        conversation: '對話',
        review: '審查',
        plan: '計畫',
    },
    /** The Agents pane: its "+", its states, its team groups and its live line (agents lab). */
    roster: {
        teamLabel: ({ team, count }) => `團隊 ${team} · ${count} 個代理`,
        teamActionsA11y: '團隊操作',
        openWork: '開啟',
        needsYouCount: ({ count }) => `${count} 個需要你處理`,
        runningCount: ({ count }) => `${count} 個執行中`,
        nothingRunning: '沒有正在執行的項目。',
        startAgent: '啟動代理',
        machineOffline: ({ machine }) => `${machine} 沒有回應`,
        machineOfflineUnnamed: '機器沒有回應',
        launch: {
            menuA11y: '啟動代理',
            conversationDescription: '在此工作階段旁與代理對話',
            reviewDescription: '檢查目前為止的變更',
            planDescription: '規劃接下來的步驟',
            delegateDescription: '交出任務並取回完成結果',
            advancedDescription: '選擇代理、權限和設定檔',
        },
        empty: {
            title: '為此工作階段加入更多代理',
            reason: ({ machine }) => `在你繼續工作時，開始一段旁支對話，或請代理審查或規劃。它們在 ${machine} 上執行，並在這裡回報。`,
            reasonUnnamed: '在你繼續工作時，開始一段旁支對話，或請代理審查或規劃。它們會在這裡回報。',
            moreWays: '請求審查、規劃或委派',
        },
        unavailable: {
            notEnabled: '此 Home 無法啟動代理。',
            machineOffline: ({ machine }) => `啟動代理需要 ${machine} 在線。`,
            machineOfflineUnnamed: '啟動代理需要這台機器在線。',
            sessionInactive: '此工作階段已停止。恢復它即可在這裡啟動代理。',
            externalRunnerInactive: '此工作階段是在 Happier 之外啟動的。Happier 連線期間可以從這裡啟動代理。',
        },
    },
    summaryA11y: ({ title, status }) => `${title}，${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}，${status}，${attention}`,
};

export const sessionAgentActivityTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
