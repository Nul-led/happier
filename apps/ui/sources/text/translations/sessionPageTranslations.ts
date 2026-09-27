/**
 * Page copy for the full pages about one session (info, following, remote grants, automations, new
 * run): purpose lines and section descriptions of the configuration-page anatomy.
 */
const english = {
    sessionPages: {
        info: {
            continueTitle: 'Continue',
            continueDescription: 'Start new work from where this session is.',
            organizeTitle: 'Organize',
            organizeDescription: 'Where this session shows up in your lists.',
            activityDescription: 'What the agent is doing, and whether you hear about it.',
            detailsTitle: 'Details',
            detailsDescription: 'Identifiers and history, for support and scripts.',
            environmentTitle: 'Environment',
            environmentDescription: 'The machine, folder and agent this session runs with.',
            agentStateDescription: 'Who is steering the agent and what it is waiting on.',
            relatedTitle: 'Related',
            relatedDescription: 'Other pages for this session.',
            developerTitle: 'Developer',
            developerDescription: 'Raw records for debugging, shown in developer mode.',
            leaveLabel: 'Stop, archive or delete',
            leaveFootnote: 'Stopping ends the running process. Archived sessions can be restored. Deleting removes the session and its messages for good.',
        },
        follow: {
            description: 'Choose whether this session notifies you and speaks through voice.',
        },
        permissions: {
            description: 'Tools you allowed from another device for this session. Revoke any you no longer want.',
        },
        automations: {
            description: 'Work that runs in this session on a schedule, an event, or when a turn finishes.',
        },
        newRun: {
            description: 'Start a sub-agent run from this session.',
            transcriptReadOnly: 'This is saved history. Reconnect to this Home to continue the conversation.',
            daemonReadOnly: 'This history comes from the agent process. Reconnect to this Home to continue the conversation.',
        },
    },
};

function translated(value: typeof english): typeof english {
    return value;
}

export const sessionPageTranslations = {
    en: english,
    ca: translated({
        sessionPages: {
            info: {
                continueTitle: 'Continua',
                continueDescription: 'Comença feina nova des d’on és aquesta sessió.',
                organizeTitle: 'Organitza',
                organizeDescription: 'On apareix aquesta sessió a les teves llistes.',
                activityDescription: 'Què fa l’agent i si te n’assabentes.',
                detailsTitle: 'Detalls',
                detailsDescription: 'Identificadors i historial, per a suport i scripts.',
                environmentTitle: 'Entorn',
                environmentDescription: 'La màquina, la carpeta i l’agent amb què s’executa aquesta sessió.',
                agentStateDescription: 'Qui dirigeix l’agent i què està esperant.',
                relatedTitle: 'Relacionat',
                relatedDescription: 'Altres pàgines d’aquesta sessió.',
                developerTitle: 'Desenvolupador',
                developerDescription: 'Registres en brut per depurar, visibles en mode desenvolupador.',
                leaveLabel: 'Atura, arxiva o elimina',
                leaveFootnote: 'Aturar acaba el procés en execució. Les sessions arxivades es poden restaurar. Eliminar esborra la sessió i els seus missatges per sempre.',
            },
            follow: {
                description: 'Tria si aquesta sessió t’avisa i si parla per veu.',
            },
            permissions: {
                description: 'Eines que has permès des d’un altre dispositiu per a aquesta sessió. Revoca les que ja no vulguis.',
            },
            automations: {
                description: 'Feina que s’executa en aquesta sessió segons un horari, un esdeveniment o quan acaba un torn.',
            },
            newRun: {
                description: 'Inicia una execució d’un subagent des d’aquesta sessió.',
                transcriptReadOnly: 'Aquest és un historial desat. Torna a connectar-te a aquest Home per continuar la conversa.',
                daemonReadOnly: 'Aquest historial prové del procés de l’agent. Torna a connectar-te a aquest Home per continuar la conversa.',
            },
        },
    }),
    de: translated({
        sessionPages: {
            info: {
                continueTitle: 'Fortsetzen',
                continueDescription: 'Starte neue Arbeit vom aktuellen Stand dieser Sitzung.',
                organizeTitle: 'Organisieren',
                organizeDescription: 'Wo diese Sitzung in deinen Listen erscheint.',
                activityDescription: 'Was der Agent gerade tut und ob du davon erfährst.',
                detailsTitle: 'Details',
                detailsDescription: 'Kennungen und Verlauf, für Support und Skripte.',
                environmentTitle: 'Umgebung',
                environmentDescription: 'Die Maschine, der Ordner und der Agent dieser Sitzung.',
                agentStateDescription: 'Wer den Agenten steuert und worauf er wartet.',
                relatedTitle: 'Verwandt',
                relatedDescription: 'Weitere Seiten zu dieser Sitzung.',
                developerTitle: 'Entwickler',
                developerDescription: 'Rohdaten zur Fehlersuche, im Entwicklermodus sichtbar.',
                leaveLabel: 'Stoppen, archivieren oder löschen',
                leaveFootnote: 'Stoppen beendet den laufenden Prozess. Archivierte Sitzungen lassen sich wiederherstellen. Löschen entfernt die Sitzung und ihre Nachrichten endgültig.',
            },
            follow: {
                description: 'Lege fest, ob diese Sitzung dich benachrichtigt und per Sprache spricht.',
            },
            permissions: {
                description: 'Werkzeuge, die du von einem anderen Gerät für diese Sitzung erlaubt hast. Widerrufe, was du nicht mehr möchtest.',
            },
            automations: {
                description: 'Arbeit, die in dieser Sitzung nach Zeitplan, bei einem Ereignis oder nach einem Zug läuft.',
            },
            newRun: {
                description: 'Starte aus dieser Sitzung einen Lauf eines Sub-Agenten.',
                transcriptReadOnly: 'Dies ist ein gespeicherter Verlauf. Verbinde dich erneut mit diesem Home, um die Unterhaltung fortzusetzen.',
                daemonReadOnly: 'Dieser Verlauf stammt aus dem Agent-Prozess. Verbinde dich erneut mit diesem Home, um die Unterhaltung fortzusetzen.',
            },
        },
    }),
    es: translated({
        sessionPages: {
            info: {
                continueTitle: 'Continuar',
                continueDescription: 'Empieza trabajo nuevo desde donde está esta sesión.',
                organizeTitle: 'Organizar',
                organizeDescription: 'Dónde aparece esta sesión en tus listas.',
                activityDescription: 'Qué hace el agente y si te enteras.',
                detailsTitle: 'Detalles',
                detailsDescription: 'Identificadores e historial, para soporte y scripts.',
                environmentTitle: 'Entorno',
                environmentDescription: 'La máquina, la carpeta y el agente con los que se ejecuta esta sesión.',
                agentStateDescription: 'Quién dirige el agente y qué está esperando.',
                relatedTitle: 'Relacionado',
                relatedDescription: 'Otras páginas de esta sesión.',
                developerTitle: 'Desarrollador',
                developerDescription: 'Registros sin procesar para depurar, visibles en modo desarrollador.',
                leaveLabel: 'Detener, archivar o eliminar',
                leaveFootnote: 'Detener termina el proceso en ejecución. Las sesiones archivadas se pueden restaurar. Eliminar borra la sesión y sus mensajes para siempre.',
            },
            follow: {
                description: 'Elige si esta sesión te avisa y si habla por voz.',
            },
            permissions: {
                description: 'Herramientas que permitiste desde otro dispositivo para esta sesión. Revoca las que ya no quieras.',
            },
            automations: {
                description: 'Trabajo que se ejecuta en esta sesión según un horario, un evento o al terminar un turno.',
            },
            newRun: {
                description: 'Inicia una ejecución de un subagente desde esta sesión.',
                transcriptReadOnly: 'Este es un historial guardado. Vuelve a conectarte a este Home para continuar la conversación.',
                daemonReadOnly: 'Este historial procede del proceso del agente. Vuelve a conectarte a este Home para continuar la conversación.',
            },
        },
    }),
    fr: translated({
        sessionPages: {
            info: {
                continueTitle: 'Continuer',
                continueDescription: 'Démarrez un nouveau travail là où en est cette session.',
                organizeTitle: 'Organiser',
                organizeDescription: 'Où cette session apparaît dans vos listes.',
                activityDescription: 'Ce que fait l’agent, et si vous en êtes averti.',
                detailsTitle: 'Détails',
                detailsDescription: 'Identifiants et historique, pour le support et les scripts.',
                environmentTitle: 'Environnement',
                environmentDescription: 'La machine, le dossier et l’agent de cette session.',
                agentStateDescription: 'Qui pilote l’agent et ce qu’il attend.',
                relatedTitle: 'Associé',
                relatedDescription: 'Autres pages de cette session.',
                developerTitle: 'Développeur',
                developerDescription: 'Données brutes pour le débogage, affichées en mode développeur.',
                leaveLabel: 'Arrêter, archiver ou supprimer',
                leaveFootnote: 'Arrêter met fin au processus en cours. Les sessions archivées peuvent être restaurées. Supprimer efface la session et ses messages définitivement.',
            },
            follow: {
                description: 'Choisissez si cette session vous notifie et parle par la voix.',
            },
            permissions: {
                description: 'Outils que vous avez autorisés depuis un autre appareil pour cette session. Révoquez ceux dont vous ne voulez plus.',
            },
            automations: {
                description: 'Travail exécuté dans cette session selon un horaire, un événement ou à la fin d’un tour.',
            },
            newRun: {
                description: 'Lancez l’exécution d’un sous-agent depuis cette session.',
                transcriptReadOnly: 'Ceci est un historique enregistré. Reconnectez-vous à ce Home pour poursuivre la conversation.',
                daemonReadOnly: 'Cet historique provient du processus de l’agent. Reconnectez-vous à ce Home pour poursuivre la conversation.',
            },
        },
    }),
    it: translated({
        sessionPages: {
            info: {
                continueTitle: 'Continua',
                continueDescription: 'Avvia nuovo lavoro dal punto in cui si trova questa sessione.',
                organizeTitle: 'Organizza',
                organizeDescription: 'Dove compare questa sessione nei tuoi elenchi.',
                activityDescription: 'Cosa sta facendo l’agente e se ne vieni avvisato.',
                detailsTitle: 'Dettagli',
                detailsDescription: 'Identificatori e cronologia, per supporto e script.',
                environmentTitle: 'Ambiente',
                environmentDescription: 'La macchina, la cartella e l’agente con cui gira questa sessione.',
                agentStateDescription: 'Chi guida l’agente e cosa sta aspettando.',
                relatedTitle: 'Correlati',
                relatedDescription: 'Altre pagine di questa sessione.',
                developerTitle: 'Sviluppatore',
                developerDescription: 'Dati grezzi per il debug, visibili in modalità sviluppatore.',
                leaveLabel: 'Ferma, archivia o elimina',
                leaveFootnote: 'Fermare termina il processo in esecuzione. Le sessioni archiviate si possono ripristinare. Eliminare rimuove la sessione e i suoi messaggi per sempre.',
            },
            follow: {
                description: 'Scegli se questa sessione ti avvisa e parla tramite voce.',
            },
            permissions: {
                description: 'Strumenti che hai consentito da un altro dispositivo per questa sessione. Revoca quelli che non vuoi più.',
            },
            automations: {
                description: 'Lavoro eseguito in questa sessione secondo un programma, un evento o al termine di un turno.',
            },
            newRun: {
                description: 'Avvia un’esecuzione di un sub-agente da questa sessione.',
                transcriptReadOnly: 'Questa è una cronologia salvata. Riconnettiti a questo Home per continuare la conversazione.',
                daemonReadOnly: 'Questa cronologia proviene dal processo dell’Agent. Riconnettiti a questo Home per continuare la conversazione.',
            },
        },
    }),
    ja: translated({
        sessionPages: {
            info: {
                continueTitle: '続ける',
                continueDescription: 'このセッションの現在の状態から新しい作業を始めます。',
                organizeTitle: '整理',
                organizeDescription: 'このセッションがリストのどこに表示されるか。',
                activityDescription: 'エージェントが何をしているか、そして通知を受け取るかどうか。',
                detailsTitle: '詳細',
                detailsDescription: 'サポートやスクリプト用の識別子と履歴。',
                environmentTitle: '環境',
                environmentDescription: 'このセッションを実行するマシン、フォルダー、エージェント。',
                agentStateDescription: '誰がエージェントを操作しているか、何を待っているか。',
                relatedTitle: '関連',
                relatedDescription: 'このセッションの他のページ。',
                developerTitle: '開発者',
                developerDescription: 'デバッグ用の生データ。開発者モードで表示されます。',
                leaveLabel: '停止、アーカイブ、削除',
                leaveFootnote: '停止すると実行中のプロセスが終了します。アーカイブしたセッションは復元できます。削除するとセッションとそのメッセージは完全に消去されます。',
            },
            follow: {
                description: 'このセッションから通知を受け取るか、音声で読み上げるかを選びます。',
            },
            permissions: {
                description: '別のデバイスからこのセッションに許可したツール。不要になったものは取り消せます。',
            },
            automations: {
                description: 'スケジュール、イベント、またはターン終了時にこのセッションで実行される作業。',
            },
            newRun: {
                description: 'このセッションからサブエージェントの実行を開始します。',
                transcriptReadOnly: 'これは保存された履歴です。この Home に再接続して会話を続けてください。',
                daemonReadOnly: 'この履歴は Agent プロセスから取得されました。この Home に再接続して会話を続けてください。',
            },
        },
    }),
    pl: translated({
        sessionPages: {
            info: {
                continueTitle: 'Kontynuuj',
                continueDescription: 'Zacznij nową pracę od miejsca, w którym jest ta sesja.',
                organizeTitle: 'Porządkuj',
                organizeDescription: 'Gdzie ta sesja pojawia się na Twoich listach.',
                activityDescription: 'Co robi agent i czy się o tym dowiesz.',
                detailsTitle: 'Szczegóły',
                detailsDescription: 'Identyfikatory i historia, dla wsparcia i skryptów.',
                environmentTitle: 'Środowisko',
                environmentDescription: 'Maszyna, folder i agent, z którymi działa ta sesja.',
                agentStateDescription: 'Kto steruje agentem i na co on czeka.',
                relatedTitle: 'Powiązane',
                relatedDescription: 'Inne strony tej sesji.',
                developerTitle: 'Deweloper',
                developerDescription: 'Surowe dane do debugowania, widoczne w trybie dewelopera.',
                leaveLabel: 'Zatrzymaj, zarchiwizuj lub usuń',
                leaveFootnote: 'Zatrzymanie kończy działający proces. Zarchiwizowane sesje można przywrócić. Usunięcie trwale kasuje sesję i jej wiadomości.',
            },
            follow: {
                description: 'Wybierz, czy ta sesja ma Cię powiadamiać i mówić głosem.',
            },
            permissions: {
                description: 'Narzędzia dozwolone z innego urządzenia dla tej sesji. Odwołaj te, których już nie chcesz.',
            },
            automations: {
                description: 'Praca uruchamiana w tej sesji według harmonogramu, zdarzenia lub po zakończeniu tury.',
            },
            newRun: {
                description: 'Uruchom sub-agenta z tej sesji.',
                transcriptReadOnly: 'To jest zapisana historia. Połącz się ponownie z tym Home, aby kontynuować rozmowę.',
                daemonReadOnly: 'Ta historia pochodzi z procesu agenta. Połącz się ponownie z tym Home, aby kontynuować rozmowę.',
            },
        },
    }),
    pt: translated({
        sessionPages: {
            info: {
                continueTitle: 'Continuar',
                continueDescription: 'Comece um novo trabalho a partir de onde esta sessão está.',
                organizeTitle: 'Organizar',
                organizeDescription: 'Onde esta sessão aparece nas suas listas.',
                activityDescription: 'O que o agente está fazendo e se você fica sabendo.',
                detailsTitle: 'Detalhes',
                detailsDescription: 'Identificadores e histórico, para suporte e scripts.',
                environmentTitle: 'Ambiente',
                environmentDescription: 'A máquina, a pasta e o agente com que esta sessão é executada.',
                agentStateDescription: 'Quem conduz o agente e o que ele está aguardando.',
                relatedTitle: 'Relacionado',
                relatedDescription: 'Outras páginas desta sessão.',
                developerTitle: 'Desenvolvedor',
                developerDescription: 'Dados brutos para depuração, exibidos no modo desenvolvedor.',
                leaveLabel: 'Parar, arquivar ou excluir',
                leaveFootnote: 'Parar encerra o processo em execução. Sessões arquivadas podem ser restauradas. Excluir apaga a sessão e suas mensagens para sempre.',
            },
            follow: {
                description: 'Escolha se esta sessão notifica você e fala por voz.',
            },
            permissions: {
                description: 'Ferramentas que você permitiu de outro dispositivo para esta sessão. Revogue as que não quiser mais.',
            },
            automations: {
                description: 'Trabalho executado nesta sessão por agenda, evento ou ao final de um turno.',
            },
            newRun: {
                description: 'Inicie uma execução de um subagente a partir desta sessão.',
                transcriptReadOnly: 'Este é um histórico guardado. Volte a ligar-se a este Home para continuar a conversa.',
                daemonReadOnly: 'Este histórico vem do processo do Agent. Volte a ligar-se a este Home para continuar a conversa.',
            },
        },
    }),
    ru: translated({
        sessionPages: {
            info: {
                continueTitle: 'Продолжить',
                continueDescription: 'Начните новую работу с того места, где сейчас эта сессия.',
                organizeTitle: 'Упорядочить',
                organizeDescription: 'Где эта сессия показывается в ваших списках.',
                activityDescription: 'Что делает агент и узнаете ли вы об этом.',
                detailsTitle: 'Подробности',
                detailsDescription: 'Идентификаторы и история для поддержки и скриптов.',
                environmentTitle: 'Окружение',
                environmentDescription: 'Машина, папка и агент, с которыми работает эта сессия.',
                agentStateDescription: 'Кто управляет агентом и чего он ждёт.',
                relatedTitle: 'Связанное',
                relatedDescription: 'Другие страницы этой сессии.',
                developerTitle: 'Разработчик',
                developerDescription: 'Необработанные данные для отладки, видны в режиме разработчика.',
                leaveLabel: 'Остановить, архивировать или удалить',
                leaveFootnote: 'Остановка завершает запущенный процесс. Архивные сессии можно восстановить. Удаление навсегда стирает сессию и её сообщения.',
            },
            follow: {
                description: 'Выберите, будет ли эта сессия уведомлять вас и говорить голосом.',
            },
            permissions: {
                description: 'Инструменты, разрешённые для этой сессии с другого устройства. Отзовите ненужные.',
            },
            automations: {
                description: 'Работа, которая выполняется в этой сессии по расписанию, по событию или после хода.',
            },
            newRun: {
                description: 'Запустите суб-агента из этой сессии.',
                transcriptReadOnly: 'Это сохранённая история. Подключитесь к этому Home снова, чтобы продолжить разговор.',
                daemonReadOnly: 'Эта история получена из процесса агента. Подключитесь к этому Home снова, чтобы продолжить разговор.',
            },
        },
    }),
    'zh-Hans': translated({
        sessionPages: {
            info: {
                continueTitle: '继续',
                continueDescription: '从此会话的当前进度开始新的工作。',
                organizeTitle: '整理',
                organizeDescription: '此会话在你的列表中出现的位置。',
                activityDescription: '代理正在做什么，以及你是否会收到通知。',
                detailsTitle: '详情',
                detailsDescription: '用于支持和脚本的标识符与历史。',
                environmentTitle: '环境',
                environmentDescription: '此会话运行所用的机器、文件夹和代理。',
                agentStateDescription: '谁在操控代理，以及它在等待什么。',
                relatedTitle: '相关',
                relatedDescription: '此会话的其他页面。',
                developerTitle: '开发者',
                developerDescription: '用于调试的原始数据，在开发者模式下显示。',
                leaveLabel: '停止、归档或删除',
                leaveFootnote: '停止会结束正在运行的进程。归档的会话可以恢复。删除会永久移除会话及其消息。',
            },
            follow: {
                description: '选择此会话是否通知你以及是否通过语音播报。',
            },
            permissions: {
                description: '你从其他设备为此会话允许的工具。撤销不再需要的授权。',
            },
            automations: {
                description: '按计划、事件或在回合结束时在此会话中运行的工作。',
            },
            newRun: {
                description: '从此会话启动一个子代理运行。',
                transcriptReadOnly: '这是已保存的历史记录。重新连接到此 Home 以继续对话。',
                daemonReadOnly: '此历史记录来自 Agent 进程。重新连接到此 Home 以继续对话。',
            },
        },
    }),
    'zh-Hant': translated({
        sessionPages: {
            info: {
                continueTitle: '繼續',
                continueDescription: '從此工作階段目前的進度開始新的工作。',
                organizeTitle: '整理',
                organizeDescription: '此工作階段在你的清單中出現的位置。',
                activityDescription: '代理正在做什麼，以及你是否會收到通知。',
                detailsTitle: '詳細資料',
                detailsDescription: '供支援與腳本使用的識別碼與歷程。',
                environmentTitle: '環境',
                environmentDescription: '此工作階段執行所用的機器、資料夾與代理。',
                agentStateDescription: '誰在操控代理，以及它在等待什麼。',
                relatedTitle: '相關',
                relatedDescription: '此工作階段的其他頁面。',
                developerTitle: '開發者',
                developerDescription: '用於除錯的原始資料，在開發者模式下顯示。',
                leaveLabel: '停止、封存或刪除',
                leaveFootnote: '停止會結束正在執行的程序。封存的工作階段可以還原。刪除會永久移除工作階段及其訊息。',
            },
            follow: {
                description: '選擇此工作階段是否通知你，以及是否透過語音播報。',
            },
            permissions: {
                description: '你從其他裝置為此工作階段允許的工具。撤銷不再需要的授權。',
            },
            automations: {
                description: '依排程、事件或在回合結束時於此工作階段中執行的工作。',
            },
            newRun: {
                description: '從此工作階段啟動子代理執行。',
                transcriptReadOnly: '這是已儲存的歷程。重新連線到此 Home 以繼續對話。',
                daemonReadOnly: '此歷程來自 Agent 程序。重新連線到此 Home 以繼續對話。',
            },
        },
    }),
};
