/**
 * Page copy for the Automations pages (collection, detail, run, settings, editor): purpose lines,
 * section titles and section descriptions of the configuration-page anatomy.
 */
const english = {
    automationPages: {
        index: {
            description: 'Work that starts on its own: on a schedule, from an Event, or when a Session turn finishes.',
        },
        settings: {
            description: 'How much automation work each machine takes on, and how long finished runs are kept.',
            capacityTitle: 'Capacity',
            capacityDescription: 'Applies to every machine that runs automations.',
            historyTitle: 'Run history',
            historyDescription: 'Finished runs you can still open from an automation.',
        },
        detail: {
            description: 'Starts work on its own whenever one of its triggers fires.',
            triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 trigger' : `${count} triggers`),
            overviewDescription: 'What it runs, and how to start or change it.',
            runNowSubtitle: 'Start a run now, without waiting for a trigger.',
            editSubtitle: 'Change its name, what it runs and its triggers.',
            machineAssignmentsDescription: 'Machines that can pick up this automation’s runs.',
        },
        run: {
            description: 'What started this run, where it ran and what it produced.',
            statusTitle: 'Status',
            statusDescription: 'Where this run is now, and what you can still do with it.',
            causeTitle: 'What started it',
            causeDescription: 'The trigger and event that admitted this run. They never change afterwards.',
        },
        gate: {
            serverTitle: 'Automations are off on this Home',
            serverBody: 'This Home’s administrators have turned automations off. Ask one of them to turn them back on.',
            openFeatures: 'Open Features settings',
            unknownTitle: 'Can\'t check automations right now',
            unknownBody: 'Happier couldn\'t reach this Home to check whether automations are on. Check again when it\'s back online.',
            unsupportedTitle: 'This Home doesn\'t support automations yet',
            unsupportedBody: 'Its server predates automations. Update the Home\'s server to use them.',
            unsupportedContextTitle: 'Automations aren\'t available here',
            unsupportedContextBody: 'The Homes you\'re viewing don\'t all support automations.',
        },
        editor: {
            description: 'Name it, choose what it runs, then add the triggers that start it.',
        },
    },
};

function translated(value: typeof english): typeof english {
    return value;
}

/** Slavic plural forms: one, few (2–4 except 12–14), many. */
function slavicPlural(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (count === 1) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
}

export const automationPageTranslations = {
    en: english,
    ca: translated({
        automationPages: {
            index: {
                description: 'Feina que comença sola: amb una programació, des d’un Event o quan acaba un torn d’una sessió.',
            },
            settings: {
                description: 'Quanta feina d’automatització accepta cada màquina i quant de temps es conserven les execucions acabades.',
                capacityTitle: 'Capacitat',
                capacityDescription: 'S’aplica a totes les màquines que executen automatitzacions.',
                historyTitle: 'Historial d’execucions',
                historyDescription: 'Execucions acabades que encara pots obrir des d’una automatització.',
            },
            detail: {
                description: 'Comença feina sola sempre que s’activa un dels seus activadors.',
                triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 activador' : `${count} activadors`),
                overviewDescription: 'Què executa i com iniciar-la o canviar-la.',
                runNowSubtitle: 'Inicia una execució ara, sense esperar cap activador.',
                editSubtitle: 'Canvia’n el nom, què executa i els activadors.',
                machineAssignmentsDescription: 'Màquines que poden agafar les execucions d’aquesta automatització.',
            },
            run: {
                description: 'Què ha iniciat aquesta execució, on s’ha executat i què ha produït.',
                statusTitle: 'Estat',
                statusDescription: 'On és ara aquesta execució i què encara hi pots fer.',
                causeTitle: 'Què l’ha iniciat',
                causeDescription: 'L’activador i l’event que van admetre aquesta execució. No canvien mai després.',
            },
            gate: {
                serverTitle: 'Les automatitzacions estan desactivades en aquest Home',
                serverBody: 'Els administradors d’aquest Home han desactivat les automatitzacions. Demana a un d’ells que les torni a activar.',
                openFeatures: 'Obre la configuració de funcions',
                unknownTitle: 'No es poden comprovar les automatitzacions ara mateix',
                unknownBody: 'Happier no ha pogut contactar amb aquest Home per comprovar si les automatitzacions estan activades. Torna-ho a comprovar quan torni a estar en línia.',
                unsupportedTitle: 'Aquest Home encara no admet automatitzacions',
                unsupportedBody: 'El seu servidor és anterior a les automatitzacions. Actualitza el servidor del Home per utilitzar-les.',
                unsupportedContextTitle: 'Les automatitzacions no estan disponibles aquí',
                unsupportedContextBody: 'No tots els Homes que estàs veient admeten automatitzacions.',
            },
            editor: {
                description: 'Posa-li nom, tria què executa i afegeix els activadors que la inicien.',
            },
        },
    }),
    de: translated({
        automationPages: {
            index: {
                description: 'Arbeit, die von selbst startet: nach Zeitplan, durch ein Event oder wenn ein Sitzungsschritt endet.',
            },
            settings: {
                description: 'Wie viel Automationsarbeit jede Maschine übernimmt und wie lange abgeschlossene Ausführungen erhalten bleiben.',
                capacityTitle: 'Kapazität',
                capacityDescription: 'Gilt für jede Maschine, die Automationen ausführt.',
                historyTitle: 'Ausführungsverlauf',
                historyDescription: 'Abgeschlossene Ausführungen, die du noch über eine Automation öffnen kannst.',
            },
            detail: {
                description: 'Startet von selbst Arbeit, sobald einer ihrer Auslöser greift.',
                triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 Auslöser' : `${count} Auslöser`),
                overviewDescription: 'Was sie ausführt und wie du sie startest oder änderst.',
                runNowSubtitle: 'Jetzt eine Ausführung starten, ohne auf einen Auslöser zu warten.',
                editSubtitle: 'Namen, Ausführung und Auslöser ändern.',
                machineAssignmentsDescription: 'Maschinen, die Ausführungen dieser Automation übernehmen können.',
            },
            run: {
                description: 'Was diese Ausführung gestartet hat, wo sie lief und was sie erzeugt hat.',
                statusTitle: 'Status',
                statusDescription: 'Wo diese Ausführung gerade steht und was du noch damit tun kannst.',
                causeTitle: 'Was sie gestartet hat',
                causeDescription: 'Der Auslöser und das Event, die diese Ausführung zugelassen haben. Sie ändern sich danach nie.',
            },
            gate: {
                serverTitle: 'Automationen sind in diesem Home ausgeschaltet',
                serverBody: 'Die Administratoren dieses Homes haben Automationen ausgeschaltet. Bitte eine dieser Personen, sie wieder einzuschalten.',
                openFeatures: 'Funktionseinstellungen öffnen',
                unknownTitle: 'Automationen können gerade nicht geprüft werden',
                unknownBody: 'Happier konnte dieses Home nicht erreichen, um zu prüfen, ob Automationen eingeschaltet sind. Prüfe es erneut, sobald es wieder online ist.',
                unsupportedTitle: 'Dieses Home unterstützt noch keine Automationen',
                unsupportedBody: 'Sein Server ist älter als Automationen. Aktualisiere den Server des Homes, um sie zu nutzen.',
                unsupportedContextTitle: 'Automationen sind hier nicht verfügbar',
                unsupportedContextBody: 'Nicht alle Homes, die du ansiehst, unterstützen Automationen.',
            },
            editor: {
                description: 'Gib ihr einen Namen, wähle, was sie ausführt, und füge die Auslöser hinzu, die sie starten.',
            },
        },
    }),
    es: translated({
        automationPages: {
            index: {
                description: 'Trabajo que empieza solo: con una programación, desde un Event o cuando termina un turno de una sesión.',
            },
            settings: {
                description: 'Cuánto trabajo de automatización acepta cada máquina y cuánto tiempo se conservan las ejecuciones terminadas.',
                capacityTitle: 'Capacidad',
                capacityDescription: 'Se aplica a todas las máquinas que ejecutan automatizaciones.',
                historyTitle: 'Historial de ejecuciones',
                historyDescription: 'Ejecuciones terminadas que aún puedes abrir desde una automatización.',
            },
            detail: {
                description: 'Empieza trabajo por sí sola cada vez que se activa uno de sus activadores.',
                triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 activador' : `${count} activadores`),
                overviewDescription: 'Qué ejecuta y cómo iniciarla o cambiarla.',
                runNowSubtitle: 'Inicia una ejecución ahora, sin esperar a un activador.',
                editSubtitle: 'Cambia su nombre, lo que ejecuta y sus activadores.',
                machineAssignmentsDescription: 'Máquinas que pueden tomar las ejecuciones de esta automatización.',
            },
            run: {
                description: 'Qué inició esta ejecución, dónde se ejecutó y qué produjo.',
                statusTitle: 'Estado',
                statusDescription: 'Dónde está ahora esta ejecución y qué puedes hacer todavía con ella.',
                causeTitle: 'Qué la inició',
                causeDescription: 'El activador y el event que admitieron esta ejecución. Nunca cambian después.',
            },
            gate: {
                serverTitle: 'Las automatizaciones están desactivadas en este Home',
                serverBody: 'Los administradores de este Home han desactivado las automatizaciones. Pide a uno de ellos que las vuelva a activar.',
                openFeatures: 'Abrir ajustes de funciones',
                unknownTitle: 'No se pueden comprobar las automatizaciones ahora',
                unknownBody: 'Happier no pudo contactar con este Home para comprobar si las automatizaciones están activadas. Vuelve a comprobarlo cuando esté en línea.',
                unsupportedTitle: 'Este Home aún no admite automatizaciones',
                unsupportedBody: 'Su servidor es anterior a las automatizaciones. Actualiza el servidor del Home para usarlas.',
                unsupportedContextTitle: 'Las automatizaciones no están disponibles aquí',
                unsupportedContextBody: 'No todos los Homes que estás viendo admiten automatizaciones.',
            },
            editor: {
                description: 'Ponle nombre, elige qué ejecuta y añade los activadores que la inician.',
            },
        },
    }),
    fr: translated({
        automationPages: {
            index: {
                description: 'Du travail qui démarre seul : selon un planning, depuis un Event ou à la fin d’un tour de session.',
            },
            settings: {
                description: 'La quantité de travail d’automatisation que chaque machine accepte, et la durée de conservation des exécutions terminées.',
                capacityTitle: 'Capacité',
                capacityDescription: 'S’applique à chaque machine qui exécute des automatisations.',
                historyTitle: 'Historique des exécutions',
                historyDescription: 'Les exécutions terminées que vous pouvez encore ouvrir depuis une automatisation.',
            },
            detail: {
                description: 'Démarre du travail seule dès qu’un de ses déclencheurs se produit.',
                triggerCount: ({ count }: { count: number }) => (count <= 1 ? `${count} déclencheur` : `${count} déclencheurs`),
                overviewDescription: 'Ce qu’elle exécute, et comment la lancer ou la modifier.',
                runNowSubtitle: 'Lancer une exécution maintenant, sans attendre un déclencheur.',
                editSubtitle: 'Modifier son nom, ce qu’elle exécute et ses déclencheurs.',
                machineAssignmentsDescription: 'Les machines qui peuvent prendre les exécutions de cette automatisation.',
            },
            run: {
                description: 'Ce qui a démarré cette exécution, où elle a tourné et ce qu’elle a produit.',
                statusTitle: 'État',
                statusDescription: 'Où en est cette exécution, et ce que vous pouvez encore en faire.',
                causeTitle: 'Ce qui l’a démarrée',
                causeDescription: 'Le déclencheur et l’événement qui ont admis cette exécution. Ils ne changent jamais ensuite.',
            },
            gate: {
                serverTitle: 'Les automatisations sont désactivées sur ce Home',
                serverBody: 'Les administrateurs de ce Home ont désactivé les automatisations. Demandez à l’un d’eux de les réactiver.',
                openFeatures: 'Ouvrir les réglages des fonctionnalités',
                unknownTitle: 'Impossible de vérifier les automatisations pour l’instant',
                unknownBody: 'Happier n’a pas pu joindre cette Home pour vérifier si les automatisations sont activées. Vérifiez à nouveau quand elle sera de retour en ligne.',
                unsupportedTitle: 'Cette Home ne prend pas encore en charge les automatisations',
                unsupportedBody: 'Son serveur est antérieur aux automatisations. Mettez à jour le serveur de la Home pour les utiliser.',
                unsupportedContextTitle: 'Les automatisations ne sont pas disponibles ici',
                unsupportedContextBody: 'Les Homes que vous consultez ne prennent pas toutes en charge les automatisations.',
            },
            editor: {
                description: 'Nommez-la, choisissez ce qu’elle exécute, puis ajoutez les déclencheurs qui la lancent.',
            },
        },
    }),
    it: translated({
        automationPages: {
            index: {
                description: 'Lavoro che parte da solo: secondo una pianificazione, da un Event o quando termina un turno di una sessione.',
            },
            settings: {
                description: 'Quanto lavoro di automazione accetta ogni macchina e per quanto tempo vengono conservate le esecuzioni terminate.',
                capacityTitle: 'Capacità',
                capacityDescription: 'Vale per ogni macchina che esegue automazioni.',
                historyTitle: 'Cronologia esecuzioni',
                historyDescription: 'Esecuzioni terminate che puoi ancora aprire da un’automazione.',
            },
            detail: {
                description: 'Avvia lavoro da sola ogni volta che scatta uno dei suoi trigger.',
                triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 trigger' : `${count} trigger`),
                overviewDescription: 'Cosa esegue e come avviarla o modificarla.',
                runNowSubtitle: 'Avvia un’esecuzione ora, senza aspettare un trigger.',
                editSubtitle: 'Cambia nome, cosa esegue e i trigger.',
                machineAssignmentsDescription: 'Macchine che possono prendere le esecuzioni di questa automazione.',
            },
            run: {
                description: 'Cosa ha avviato questa esecuzione, dove è stata eseguita e cosa ha prodotto.',
                statusTitle: 'Stato',
                statusDescription: 'A che punto è questa esecuzione e cosa puoi ancora farne.',
                causeTitle: 'Cosa l’ha avviata',
                causeDescription: 'Il trigger e l’evento che hanno ammesso questa esecuzione. Non cambiano mai dopo.',
            },
            gate: {
                serverTitle: 'Le automazioni sono disattivate in questo Home',
                serverBody: 'Gli amministratori di questo Home hanno disattivato le automazioni. Chiedi a uno di loro di riattivarle.',
                openFeatures: 'Apri le impostazioni delle funzionalità',
                unknownTitle: 'Impossibile verificare le automazioni in questo momento',
                unknownBody: 'Happier non è riuscito a raggiungere questo Home per verificare se le automazioni sono attive. Verifica di nuovo quando torna online.',
                unsupportedTitle: 'Questo Home non supporta ancora le automazioni',
                unsupportedBody: 'Il suo server è precedente alle automazioni. Aggiorna il server del Home per usarle.',
                unsupportedContextTitle: 'Le automazioni non sono disponibili qui',
                unsupportedContextBody: 'Non tutti gli Home che stai visualizzando supportano le automazioni.',
            },
            editor: {
                description: 'Dalle un nome, scegli cosa esegue, poi aggiungi i trigger che la avviano.',
            },
        },
    }),
    ja: translated({
        automationPages: {
            index: {
                description: 'スケジュール、Event、またはセッションのターン終了で自動的に始まる作業です。',
            },
            settings: {
                description: '各マシンが引き受ける自動化の作業量と、完了した実行を保持する期間です。',
                capacityTitle: '処理能力',
                capacityDescription: '自動化を実行するすべてのマシンに適用されます。',
                historyTitle: '実行履歴',
                historyDescription: '自動化からまだ開ける完了済みの実行です。',
            },
            detail: {
                description: 'トリガーのいずれかが発生すると、自動的に作業を始めます。',
                triggerCount: ({ count }: { count: number }) => `${count} 件のトリガー`,
                overviewDescription: '実行する内容と、開始・変更の方法です。',
                runNowSubtitle: 'トリガーを待たずに今すぐ実行を開始します。',
                editSubtitle: '名前、実行する内容、トリガーを変更します。',
                machineAssignmentsDescription: 'この自動化の実行を引き受けられるマシンです。',
            },
            run: {
                description: 'この実行を開始したもの、実行場所、生成したものです。',
                statusTitle: '状態',
                statusDescription: 'この実行の現在の状況と、まだできる操作です。',
                causeTitle: '開始のきっかけ',
                causeDescription: 'この実行を受け付けたトリガーとイベントです。後から変わることはありません。',
            },
            gate: {
                serverTitle: 'このHomeでは自動化がオフになっています',
                serverBody: 'このHomeの管理者が自動化をオフにしました。管理者に再びオンにするよう依頼してください。',
                openFeatures: '機能の設定を開く',
                unknownTitle: '現在オートメーションを確認できません',
                unknownBody: 'オートメーションが有効か確認するためにこの Home に接続できませんでした。オンラインに戻ったらもう一度確認してください。',
                unsupportedTitle: 'この Home はまだオートメーションに対応していません',
                unsupportedBody: 'サーバーがオートメーションより古いバージョンです。利用するには Home のサーバーを更新してください。',
                unsupportedContextTitle: 'ここではオートメーションを利用できません',
                unsupportedContextBody: '表示中の Home の一部がオートメーションに対応していません。',
            },
            editor: {
                description: '名前を付け、実行する内容を選び、開始するトリガーを追加します。',
            },
        },
    }),
    pl: translated({
        automationPages: {
            index: {
                description: 'Praca, która startuje sama: według harmonogramu, z Eventu albo po zakończeniu tury sesji.',
            },
            settings: {
                description: 'Ile pracy automatyzacji przyjmuje każda maszyna i jak długo przechowywane są zakończone uruchomienia.',
                capacityTitle: 'Pojemność',
                capacityDescription: 'Dotyczy każdej maszyny, która uruchamia automatyzacje.',
                historyTitle: 'Historia uruchomień',
                historyDescription: 'Zakończone uruchomienia, które nadal możesz otworzyć z automatyzacji.',
            },
            detail: {
                description: 'Sama zaczyna pracę, gdy zadziała którykolwiek z jej wyzwalaczy.',
                triggerCount: ({ count }: { count: number }) => `${count} ${slavicPlural(count, 'wyzwalacz', 'wyzwalacze', 'wyzwalaczy')}`,
                overviewDescription: 'Co uruchamia oraz jak ją uruchomić lub zmienić.',
                runNowSubtitle: 'Uruchom teraz, bez czekania na wyzwalacz.',
                editSubtitle: 'Zmień nazwę, to, co uruchamia, i wyzwalacze.',
                machineAssignmentsDescription: 'Maszyny, które mogą przejmować uruchomienia tej automatyzacji.',
            },
            run: {
                description: 'Co rozpoczęło to uruchomienie, gdzie działało i co wytworzyło.',
                statusTitle: 'Stan',
                statusDescription: 'Na jakim etapie jest to uruchomienie i co jeszcze możesz z nim zrobić.',
                causeTitle: 'Co je rozpoczęło',
                causeDescription: 'Wyzwalacz i zdarzenie, które dopuściły to uruchomienie. Później się nie zmieniają.',
            },
            gate: {
                serverTitle: 'Automatyzacje są wyłączone w tym Home',
                serverBody: 'Administratorzy tego Home wyłączyli automatyzacje. Poproś jednego z nich o ich ponowne włączenie.',
                openFeatures: 'Otwórz ustawienia funkcji',
                unknownTitle: 'Nie można teraz sprawdzić automatyzacji',
                unknownBody: 'Happier nie mógł połączyć się z tym Home, aby sprawdzić, czy automatyzacje są włączone. Sprawdź ponownie, gdy wróci do sieci.',
                unsupportedTitle: 'Ten Home nie obsługuje jeszcze automatyzacji',
                unsupportedBody: 'Jego serwer jest starszy niż automatyzacje. Zaktualizuj serwer Home, aby z nich korzystać.',
                unsupportedContextTitle: 'Automatyzacje nie są tu dostępne',
                unsupportedContextBody: 'Nie wszystkie przeglądane Home obsługują automatyzacje.',
            },
            editor: {
                description: 'Nazwij ją, wybierz, co uruchamia, a potem dodaj wyzwalacze, które ją startują.',
            },
        },
    }),
    pt: translated({
        automationPages: {
            index: {
                description: 'Trabalho que começa sozinho: por agendamento, a partir de um Event ou quando termina um turno de uma sessão.',
            },
            settings: {
                description: 'Quanto trabalho de automação cada máquina aceita e por quanto tempo as execuções concluídas são mantidas.',
                capacityTitle: 'Capacidade',
                capacityDescription: 'Vale para todas as máquinas que executam automações.',
                historyTitle: 'Histórico de execuções',
                historyDescription: 'Execuções concluídas que você ainda pode abrir a partir de uma automação.',
            },
            detail: {
                description: 'Começa trabalho sozinha sempre que um de seus acionadores dispara.',
                triggerCount: ({ count }: { count: number }) => (count === 1 ? '1 acionador' : `${count} acionadores`),
                overviewDescription: 'O que ela executa e como iniciá-la ou alterá-la.',
                runNowSubtitle: 'Inicie uma execução agora, sem esperar um acionador.',
                editSubtitle: 'Altere o nome, o que ela executa e os acionadores.',
                machineAssignmentsDescription: 'Máquinas que podem assumir as execuções desta automação.',
            },
            run: {
                description: 'O que iniciou esta execução, onde ela rodou e o que produziu.',
                statusTitle: 'Status',
                statusDescription: 'Em que ponto esta execução está e o que você ainda pode fazer com ela.',
                causeTitle: 'O que a iniciou',
                causeDescription: 'O acionador e o evento que admitiram esta execução. Eles nunca mudam depois.',
            },
            gate: {
                serverTitle: 'As automações estão desativadas nesta Home',
                serverBody: 'Os administradores desta Home desativaram as automações. Peça a um deles para ativá-las novamente.',
                openFeatures: 'Abrir configurações de recursos',
                unknownTitle: 'Não é possível verificar as automações agora',
                unknownBody: 'O Happier não conseguiu contactar esta Home para verificar se as automações estão ativadas. Verifique novamente quando ela voltar a ficar online.',
                unsupportedTitle: 'Esta Home ainda não suporta automações',
                unsupportedBody: 'O servidor dela é anterior às automações. Atualize o servidor da Home para usá-las.',
                unsupportedContextTitle: 'As automações não estão disponíveis aqui',
                unsupportedContextBody: 'Nem todas as Homes que você está vendo suportam automações.',
            },
            editor: {
                description: 'Dê um nome, escolha o que ela executa e adicione os acionadores que a iniciam.',
            },
        },
    }),
    ru: translated({
        automationPages: {
            index: {
                description: 'Работа, которая запускается сама: по расписанию, из Event или когда завершается ход сессии.',
            },
            settings: {
                description: 'Сколько работы автоматизаций берёт каждая машина и как долго хранятся завершённые запуски.',
                capacityTitle: 'Нагрузка',
                capacityDescription: 'Действует для каждой машины, которая выполняет автоматизации.',
                historyTitle: 'История запусков',
                historyDescription: 'Завершённые запуски, которые ещё можно открыть из автоматизации.',
            },
            detail: {
                description: 'Сама запускает работу, когда срабатывает любой из её триггеров.',
                triggerCount: ({ count }: { count: number }) => `${count} ${slavicPlural(count, 'триггер', 'триггера', 'триггеров')}`,
                overviewDescription: 'Что она запускает и как её запустить или изменить.',
                runNowSubtitle: 'Запустить сейчас, не дожидаясь триггера.',
                editSubtitle: 'Изменить название, что она запускает, и триггеры.',
                machineAssignmentsDescription: 'Машины, которые могут брать запуски этой автоматизации.',
            },
            run: {
                description: 'Что начало этот запуск, где он выполнялся и что создал.',
                statusTitle: 'Состояние',
                statusDescription: 'На каком этапе этот запуск и что с ним ещё можно сделать.',
                causeTitle: 'Что его начало',
                causeDescription: 'Триггер и событие, которые допустили этот запуск. Позже они не меняются.',
            },
            gate: {
                serverTitle: 'Автоматизации отключены в этом Home',
                serverBody: 'Администраторы этого Home отключили автоматизации. Попросите одного из них включить их снова.',
                openFeatures: 'Открыть настройки функций',
                unknownTitle: 'Сейчас не удаётся проверить автоматизации',
                unknownBody: 'Happier не смог связаться с этим Home, чтобы проверить, включены ли автоматизации. Проверьте снова, когда он снова будет в сети.',
                unsupportedTitle: 'Этот Home пока не поддерживает автоматизации',
                unsupportedBody: 'Его сервер старше, чем автоматизации. Обновите сервер Home, чтобы пользоваться ими.',
                unsupportedContextTitle: 'Автоматизации здесь недоступны',
                unsupportedContextBody: 'Не все просматриваемые Home поддерживают автоматизации.',
            },
            editor: {
                description: 'Назовите её, выберите, что она запускает, и добавьте триггеры, которые её запускают.',
            },
        },
    }),
    'zh-Hans': translated({
        automationPages: {
            index: {
                description: '自动开始的工作：按计划、由 Event 触发，或在会话的一轮结束时开始。',
            },
            settings: {
                description: '每台机器承接多少自动化工作，以及已完成的运行保留多久。',
                capacityTitle: '容量',
                capacityDescription: '适用于每台运行自动化的机器。',
                historyTitle: '运行历史',
                historyDescription: '仍可从自动化中打开的已完成运行。',
            },
            detail: {
                description: '只要任一触发器触发，就会自动开始工作。',
                triggerCount: ({ count }: { count: number }) => `${count} 个触发器`,
                overviewDescription: '它运行什么，以及如何启动或更改它。',
                runNowSubtitle: '立即开始一次运行，无需等待触发器。',
                editSubtitle: '更改名称、运行内容和触发器。',
                machineAssignmentsDescription: '可以承接此自动化运行的机器。',
            },
            run: {
                description: '是什么启动了这次运行、在哪里运行，以及产生了什么。',
                statusTitle: '状态',
                statusDescription: '这次运行现在的进展，以及你还能对它做什么。',
                causeTitle: '启动原因',
                causeDescription: '准许这次运行的触发器和事件。之后不会改变。',
            },
            gate: {
                serverTitle: '此 Home 已关闭自动化',
                serverBody: '此 Home 的管理员已关闭自动化。请联系其中一位管理员重新开启。',
                openFeatures: '打开功能设置',
                unknownTitle: '暂时无法检查自动化',
                unknownBody: 'Happier 无法连接到此 Home 以检查自动化是否已开启。请在它恢复在线后再次检查。',
                unsupportedTitle: '此 Home 尚不支持自动化',
                unsupportedBody: '它的服务器版本早于自动化功能。请更新 Home 的服务器以使用自动化。',
                unsupportedContextTitle: '此处无法使用自动化',
                unsupportedContextBody: '你正在查看的 Home 并非都支持自动化。',
            },
            editor: {
                description: '为它命名，选择它运行的内容，然后添加启动它的触发器。',
            },
        },
    }),
    'zh-Hant': translated({
        automationPages: {
            index: {
                description: '自動開始的工作：依排程、由 Event 觸發，或在工作階段的一輪結束時開始。',
            },
            settings: {
                description: '每台機器承接多少自動化工作，以及已完成的執行保留多久。',
                capacityTitle: '容量',
                capacityDescription: '適用於每台執行自動化的機器。',
                historyTitle: '執行歷史',
                historyDescription: '仍可從自動化中開啟的已完成執行。',
            },
            detail: {
                description: '只要任一觸發器觸發，就會自動開始工作。',
                triggerCount: ({ count }: { count: number }) => `${count} 個觸發器`,
                overviewDescription: '它執行什麼，以及如何啟動或變更它。',
                runNowSubtitle: '立即開始一次執行，無需等待觸發器。',
                editSubtitle: '變更名稱、執行內容和觸發器。',
                machineAssignmentsDescription: '可以承接此自動化執行的機器。',
            },
            run: {
                description: '是什麼啟動了這次執行、在哪裡執行，以及產生了什麼。',
                statusTitle: '狀態',
                statusDescription: '這次執行現在的進度，以及你還能對它做什麼。',
                causeTitle: '啟動原因',
                causeDescription: '准許這次執行的觸發器和事件。之後不會改變。',
            },
            gate: {
                serverTitle: '此 Home 已關閉自動化',
                serverBody: '此 Home 的管理員已關閉自動化。請聯絡其中一位管理員重新開啟。',
                openFeatures: '開啟功能設定',
                unknownTitle: '暫時無法檢查自動化',
                unknownBody: 'Happier 無法連線到此 Home 以檢查自動化是否已開啟。請在它恢復上線後再次檢查。',
                unsupportedTitle: '此 Home 尚不支援自動化',
                unsupportedBody: '它的伺服器版本早於自動化功能。請更新 Home 的伺服器以使用自動化。',
                unsupportedContextTitle: '此處無法使用自動化',
                unsupportedContextBody: '你正在檢視的 Home 並非都支援自動化。',
            },
            editor: {
                description: '為它命名，選擇它執行的內容，然後新增啟動它的觸發器。',
            },
        },
    }),
};
