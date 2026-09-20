const en = {
    "follow": "Follow",
    "unfollow": "Unfollow",
    "following": "Following",
    "notifications": "Notifications",
    "unavailableTitle": "Following is not available",
    "unavailableDescription": "This Home does not offer session following.",
    "editor": {
        "title": "Follow this session",
        "subtitle": "Get the updates that matter to you.",
        "ownerSubtitle": "You own this session, so its updates always reach you.",
        "externalAttachedOnly": "Background sync is off, so updates may arrive only while this session is attached."
    },
    "level": {
        "none": "No notifications",
        "important": "Important updates",
        "all_messages": "Every new message"
    },
    "voice": {
        "title": "Include in Voice",
        "subtitle": "Voice can keep this session in context.",
        "waitingRuntime": "Waiting for the Voice runtime to connect.",
        "unsupported": "This runtime does not support including followed sessions in Voice.",
        "providerWithheld": "This Voice mode cannot include stored Session updates.",
        "waitingEncrypted": "Unlock this session to include it in Voice.",
        "initialSnapshotPending": "On your next Voice turn, include a brief current snapshot."
    },
    "footer": "Following never changes who can access this session.",
    "settingsLink": "Notification settings…",
    "assignedExplanation": "Following because you were assigned",
    "wakeEventExplanation": "Followed context changed, so Happier woke this Agent with the update.",
    "accessLost": "You no longer have access to this session.",
    "offline": "You're offline. Reconnect to change following.",
    "archived": "Following is paused while this session is archived.",
    "sources": {
        "title": "Session updates",
        "waitingRuntime": "Waiting for the destination Session to reconnect.",
        "unsupported": "Update or reconnect the CLI on the destination machine to receive updates.",
        "pausedArchived": "Updates are paused while the source or destination is archived.",
        "add": "Follow in another Session…",
        "addSource": "Send updates from another session…",
        "row": ({ title }: { title: string }) => `Updates from “${title}”`,
        "nextTurn": "Next turn",
        "wakeOnHumanChange": "Wake when a person adds a message",
        "stop": "Stop updates",
        "stopForSource": ({ title }: { title: string }) => `Stop updates from “${title}”`,
        "includeNextTurn": "Include updates with the destination's next turn.",
        "sourceKeyPreparing": "Preparing encrypted access…",
        "sourceKeyWaiting": "Waiting for encrypted access.",
        "sourceKeyUnavailable": "This computer can't provide encrypted access.",
        "sourceSessionKeyUnavailable": "This session's encrypted access is not available here.",
        "catchUpPending": "Catch-up pending"
    },
    "preferences": {
        "title": "Automatically follow",
        "assigned": "Sessions assigned to me",
        "direct": "Sessions shared directly",
        "team": "Sessions shared through Teams",
        "group": "Sessions shared through Groups",
        "help": "Applies to new assignments and newly accessible sessions. Existing choices stay unchanged."
    }
};

type SessionFollowTranslations = typeof en;

export const sessionFollowTranslations: Record<
    'en' | 'ca' | 'de' | 'es' | 'fr' | 'it' | 'ja' | 'pl' | 'pt' | 'ru' | 'zh-Hans' | 'zh-Hant',
    SessionFollowTranslations
> = {
    en,
    'ca': {
        "follow": "Segueix",
        "unfollow": "Deixa de seguir",
        "following": "Seguint",
        "notifications": "Notificacions",
        "unavailableTitle": "El seguiment no està disponible",
        "unavailableDescription": "Aquesta Home no ofereix el seguiment de sessions.",
        "editor": {
            "title": "Segueix aquesta sessió",
            "subtitle": "Rep les actualitzacions que t’importen.",
            "ownerSubtitle": "Ets propietari d’aquesta sessió, així que sempre en rebràs les novetats.",
            "externalAttachedOnly": "La sincronització en segon pla està desactivada, així que les actualitzacions poden arribar només mentre aquesta sessió estigui connectada."
        },
        "level": {
            "none": "Sense notificacions",
            "important": "Actualitzacions importants",
            "all_messages": "Cada missatge nou"
        },
        "voice": {
            "title": "Inclou a Voice",
            "subtitle": "Voice pot mantenir aquesta sessió en context.",
            "waitingRuntime": "Esperant que Voice es connecti.",
            "unsupported": "Aquest entorn no admet incloure sessions seguides a Voice.",
            "providerWithheld": "Aquest mode de Voice no pot incloure actualitzacions de sessions desades.",
            "waitingEncrypted": "Desbloqueja aquesta sessió per incloure-la a Voice.",
            "initialSnapshotPending": "Al proper torn de Voice, inclou un resum breu de l’estat actual."
        },
        "footer": "Seguir no canvia mai qui pot accedir a aquesta sessió.",
        "settingsLink": "Configuració de notificacions…",
        "assignedExplanation": "La segueixes perquè te l’han assignat",
        "wakeEventExplanation": "El context seguit ha canviat, així que Happier ha despertat aquest agent amb l’actualització.",
        "accessLost": "Ja no tens accés a aquesta sessió.",
        "offline": "No tens connexió. Torna a connectar-te per canviar el seguiment.",
        "archived": "El seguiment està pausat mentre la sessió està arxivada.",
        "sources": {
            "title": "Actualitzacions de Sessions",
            "waitingRuntime": "Esperant que la Sessió de destinació es torni a connectar.",
            "unsupported": "Actualitza o torna a connectar la CLI de la màquina de destinació per rebre actualitzacions.",
            "pausedArchived": "Les actualitzacions estan en pausa mentre la font o la destinació estiguin arxivades.",
            "add": "Segueix en una altra sessió…",
            "addSource": "Envia actualitzacions des d’una altra sessió…",
            "row": ({ title }) => `Actualitzacions de «${title}»`,
            "nextTurn": "Proper torn",
            "wakeOnHumanChange": "Activa quan una persona afegeixi un missatge",
            "stop": "Atura les actualitzacions",
            "stopForSource": ({ title }) => `Atura les actualitzacions de «${title}»`,
            "includeNextTurn": "Inclou les actualitzacions al proper torn de la destinació.",
            "sourceKeyPreparing": "Preparant l’accés xifrat…",
            "sourceKeyWaiting": "Esperant l’accés xifrat.",
            "sourceKeyUnavailable": "Aquest ordinador no pot proporcionar accés xifrat.",
            "sourceSessionKeyUnavailable": "L’accés xifrat d’aquesta sessió no està disponible aquí.",
            "catchUpPending": "Actualitzacions pendents"
        },
        "preferences": {
            "title": "Segueix automàticament",
            "assigned": "Sessions assignades a mi",
            "direct": "Sessions compartides directament",
            "team": "Sessions compartides a través d’equips",
            "group": "Sessions compartides a través de grups",
            "help": "S’aplica a noves assignacions i sessions accessibles per primer cop. Les opcions existents no canvien."
        }
    },
    'de': {
        "follow": "Folgen",
        "unfollow": "Nicht mehr folgen",
        "following": "Gefolgt",
        "notifications": "Benachrichtigungen",
        "unavailableTitle": "Folgen ist nicht verfügbar",
        "unavailableDescription": "Dieses Home bietet kein Session-Following an.",
        "editor": {
            "title": "Dieser Sitzung folgen",
            "subtitle": "Erhalte die Updates, die dir wichtig sind.",
            "ownerSubtitle": "Dir gehört diese Sitzung, daher erreichen dich ihre Updates immer.",
            "externalAttachedOnly": "Die Hintergrundsynchronisierung ist aus, daher kommen Updates möglicherweise nur an, während diese Sitzung verbunden ist."
        },
        "level": {
            "none": "Keine Benachrichtigungen",
            "important": "Wichtige Updates",
            "all_messages": "Jede neue Nachricht"
        },
        "voice": {
            "title": "In Voice einbeziehen",
            "subtitle": "Voice kann diese Sitzung im Kontext behalten.",
            "waitingRuntime": "Warte auf die Verbindung mit Voice.",
            "unsupported": "Diese Laufzeit unterstützt gefolgte Sitzungen in Voice nicht.",
            "providerWithheld": "Dieser Voice-Modus kann keine gespeicherten Sitzungsupdates einbeziehen.",
            "waitingEncrypted": "Entsperre diese Sitzung, um sie in Voice einzubeziehen.",
            "initialSnapshotPending": "Beim nächsten Voice-Beitrag eine kurze Zusammenfassung des aktuellen Stands einbeziehen."
        },
        "footer": "Folgen ändert niemals, wer auf diese Sitzung zugreifen kann.",
        "settingsLink": "Benachrichtigungseinstellungen…",
        "assignedExplanation": "Du folgst, weil dir die Sitzung zugewiesen wurde",
        "wakeEventExplanation": "Der verfolgte Kontext hat sich geändert, deshalb hat Happier diesen Agenten mit der Aktualisierung geweckt.",
        "accessLost": "Du hast keinen Zugriff mehr auf diese Sitzung.",
        "offline": "Du bist offline. Verbinde dich erneut, um das Folgen zu ändern.",
        "archived": "Das Folgen ist pausiert, solange diese Sitzung archiviert ist.",
        "sources": {
            "title": "Session-Updates",
            "waitingRuntime": "Warten auf die erneute Verbindung der Ziel-Session.",
            "unsupported": "Aktualisiere die CLI auf dem Zielrechner oder verbinde sie neu, um Updates zu empfangen.",
            "pausedArchived": "Updates sind pausiert, solange die Quelle oder das Ziel archiviert ist.",
            "add": "In einer anderen Sitzung folgen…",
            "addSource": "Updates aus einer anderen Sitzung senden…",
            "row": ({ title }) => `Updates von „${title}“`,
            "nextTurn": "Nächster Zug",
            "wakeOnHumanChange": "Aufwecken, wenn eine Person eine Nachricht hinzufügt",
            "stop": "Updates stoppen",
            "stopForSource": ({ title }) => `Updates von „${title}“ stoppen`,
            "includeNextTurn": "Aktualisierungen beim nächsten Zug des Ziels einbeziehen.",
            "sourceKeyPreparing": "Verschlüsselten Zugriff vorbereiten…",
            "sourceKeyWaiting": "Warten auf verschlüsselten Zugriff.",
            "sourceKeyUnavailable": "Dieser Computer kann keinen verschlüsselten Zugriff bereitstellen.",
            "sourceSessionKeyUnavailable": "Der verschlüsselte Zugriff dieser Session ist hier nicht verfügbar.",
            "catchUpPending": "Nachholen ausstehend"
        },
        "preferences": {
            "title": "Automatisch folgen",
            "assigned": "Mir zugewiesene Sitzungen",
            "direct": "Direkt geteilte Sitzungen",
            "team": "Über Teams geteilte Sitzungen",
            "group": "Über Gruppen geteilte Sitzungen",
            "help": "Gilt für neue Zuweisungen und neu zugängliche Sitzungen. Bestehende Einstellungen bleiben unverändert."
        }
    },
    'es': {
        "follow": "Seguir",
        "unfollow": "Dejar de seguir",
        "following": "Siguiendo",
        "notifications": "Notificaciones",
        "unavailableTitle": "El seguimiento no está disponible",
        "unavailableDescription": "Este Home no ofrece el seguimiento de sesiones.",
        "editor": {
            "title": "Seguir esta sesión",
            "subtitle": "Recibe las novedades que te importan.",
            "ownerSubtitle": "Esta sesión es tuya, así que siempre recibirás sus novedades.",
            "externalAttachedOnly": "La sincronización en segundo plano está desactivada, así que las actualizaciones pueden llegar solo mientras esta sesión esté conectada."
        },
        "level": {
            "none": "Sin notificaciones",
            "important": "Novedades importantes",
            "all_messages": "Cada mensaje nuevo"
        },
        "voice": {
            "title": "Incluir en Voice",
            "subtitle": "Voice puede mantener esta sesión en contexto.",
            "waitingRuntime": "Esperando a que Voice se conecte.",
            "unsupported": "Este entorno no permite incluir sesiones seguidas en Voice.",
            "providerWithheld": "Este modo de Voice no puede incluir novedades de sesiones guardadas.",
            "waitingEncrypted": "Desbloquea esta sesión para incluirla en Voice.",
            "initialSnapshotPending": "En tu próximo turno de Voice, incluye un breve resumen del estado actual."
        },
        "footer": "Seguir nunca cambia quién puede acceder a esta sesión.",
        "settingsLink": "Ajustes de notificaciones…",
        "assignedExplanation": "La sigues porque se te asignó",
        "wakeEventExplanation": "El contexto seguido ha cambiado, así que Happier despertó a este agente con la actualización.",
        "accessLost": "Ya no tienes acceso a esta sesión.",
        "offline": "No tienes conexión. Vuelve a conectarte para cambiar el seguimiento.",
        "archived": "El seguimiento está en pausa mientras esta sesión está archivada.",
        "sources": {
            "title": "Actualizaciones de sesiones",
            "waitingRuntime": "Esperando a que la sesión de destino vuelva a conectarse.",
            "unsupported": "Actualiza o vuelve a conectar la CLI de la máquina de destino para recibir actualizaciones.",
            "pausedArchived": "Las actualizaciones están en pausa mientras el origen o el destino estén archivados.",
            "add": "Seguir en otra sesión…",
            "addSource": "Enviar novedades desde otra sesión…",
            "row": ({ title }) => `Novedades de «${title}»`,
            "nextTurn": "Próximo turno",
            "wakeOnHumanChange": "Activar cuando una persona añada un mensaje",
            "stop": "Detener novedades",
            "stopForSource": ({ title }) => `Detener novedades de «${title}»`,
            "includeNextTurn": "Incluye las novedades en el próximo turno del destino.",
            "sourceKeyPreparing": "Preparando el acceso cifrado…",
            "sourceKeyWaiting": "Esperando el acceso cifrado.",
            "sourceKeyUnavailable": "Este equipo no puede proporcionar acceso cifrado.",
            "sourceSessionKeyUnavailable": "El acceso cifrado de esta sesión no está disponible aquí.",
            "catchUpPending": "Actualización pendiente"
        },
        "preferences": {
            "title": "Seguir automáticamente",
            "assigned": "Sesiones asignadas a mí",
            "direct": "Sesiones compartidas directamente",
            "team": "Sesiones compartidas mediante equipos",
            "group": "Sesiones compartidas mediante grupos",
            "help": "Se aplica a nuevas asignaciones y sesiones recién accesibles. Las opciones existentes no cambian."
        }
    },
    'fr': {
        "follow": "Suivre",
        "unfollow": "Ne plus suivre",
        "following": "Suivi",
        "notifications": "Notifications",
        "unavailableTitle": "Le suivi n’est pas disponible",
        "unavailableDescription": "Ce Home ne propose pas le suivi de sessions.",
        "editor": {
            "title": "Suivre cette session",
            "subtitle": "Recevez les nouvelles qui comptent pour vous.",
            "ownerSubtitle": "Cette session vous appartient, ses mises à jour vous parviennent toujours.",
            "externalAttachedOnly": "La synchronisation en arrière-plan est désactivée : les mises à jour peuvent n’arriver que pendant que cette session est attachée."
        },
        "level": {
            "none": "Aucune notification",
            "important": "Mises à jour importantes",
            "all_messages": "Chaque nouveau message"
        },
        "voice": {
            "title": "Inclure dans Voice",
            "subtitle": "Voice peut garder cette session en contexte.",
            "waitingRuntime": "En attente de la connexion de Voice.",
            "unsupported": "Cet environnement ne permet pas d’inclure les sessions suivies dans Voice.",
            "providerWithheld": "Ce mode Voice ne peut pas inclure les mises à jour de sessions enregistrées.",
            "waitingEncrypted": "Déverrouillez cette session pour l’inclure dans Voice.",
            "initialSnapshotPending": "Lors de votre prochain tour Voice, inclure un bref résumé de l’état actuel."
        },
        "footer": "Le suivi ne change jamais qui peut accéder à cette session.",
        "settingsLink": "Paramètres de notification…",
        "assignedExplanation": "Vous suivez cette session car elle vous a été attribuée",
        "wakeEventExplanation": "Le contexte suivi a changé, donc Happier a réveillé cet agent avec la mise à jour.",
        "accessLost": "Vous n’avez plus accès à cette session.",
        "offline": "Vous êtes hors ligne. Reconnectez-vous pour modifier le suivi.",
        "archived": "Le suivi est suspendu tant que cette session est archivée.",
        "sources": {
            "title": "Mises à jour des sessions",
            "waitingRuntime": "En attente de la reconnexion de la session de destination.",
            "unsupported": "Mets à jour ou reconnecte le CLI sur la machine de destination pour recevoir les mises à jour.",
            "pausedArchived": "Les mises à jour sont en pause tant que la source ou la destination est archivée.",
            "add": "Suivre dans une autre session…",
            "addSource": "Envoyer les mises à jour d’une autre session…",
            "row": ({ title }) => `Mises à jour de « ${title} »`,
            "nextTurn": "Prochain tour",
            "wakeOnHumanChange": "Réveiller quand une personne ajoute un message",
            "stop": "Arrêter les mises à jour",
            "stopForSource": ({ title }) => `Arrêter les mises à jour de «${title}»`,
            "includeNextTurn": "Inclure les mises à jour au prochain tour de la destination.",
            "sourceKeyPreparing": "Préparation de l’accès chiffré…",
            "sourceKeyWaiting": "En attente de l’accès chiffré.",
            "sourceKeyUnavailable": "Cet ordinateur ne peut pas fournir d’accès chiffré.",
            "sourceSessionKeyUnavailable": "L’accès chiffré de cette session n’est pas disponible ici.",
            "catchUpPending": "Rattrapage en attente"
        },
        "preferences": {
            "title": "Suivre automatiquement",
            "assigned": "Sessions qui me sont attribuées",
            "direct": "Sessions partagées directement",
            "team": "Sessions partagées via des équipes",
            "group": "Sessions partagées via des groupes",
            "help": "S’applique aux nouvelles attributions et aux sessions nouvellement accessibles. Les choix existants restent inchangés."
        }
    },
    'it': {
        "follow": "Segui",
        "unfollow": "Smetti di seguire",
        "following": "Seguita",
        "notifications": "Notifiche",
        "unavailableTitle": "Il following non è disponibile",
        "unavailableDescription": "Questo Home non offre il following delle sessioni.",
        "editor": {
            "title": "Segui questa sessione",
            "subtitle": "Ricevi gli aggiornamenti che ti interessano.",
            "ownerSubtitle": "Questa sessione è tua, quindi i suoi aggiornamenti ti raggiungono sempre.",
            "externalAttachedOnly": "La sincronizzazione in background è disattivata, quindi gli aggiornamenti potrebbero arrivare solo mentre questa sessione è collegata."
        },
        "level": {
            "none": "Nessuna notifica",
            "important": "Aggiornamenti importanti",
            "all_messages": "Ogni nuovo messaggio"
        },
        "voice": {
            "title": "Includi in Voice",
            "subtitle": "Voice può mantenere questa sessione nel contesto.",
            "waitingRuntime": "In attesa che Voice si connetta.",
            "unsupported": "Questo ambiente non supporta le sessioni seguite in Voice.",
            "providerWithheld": "Questa modalità Voice non può includere gli aggiornamenti delle sessioni salvate.",
            "waitingEncrypted": "Sblocca questa sessione per includerla in Voice.",
            "initialSnapshotPending": "Al prossimo turno di Voice, includi un breve riepilogo dello stato attuale."
        },
        "footer": "Seguire non cambia mai chi può accedere a questa sessione.",
        "settingsLink": "Impostazioni notifiche…",
        "assignedExplanation": "Segui questa sessione perché ti è stata assegnata",
        "wakeEventExplanation": "Il contesto seguito è cambiato, quindi Happier ha risvegliato questo agente con l’aggiornamento.",
        "accessLost": "Non hai più accesso a questa sessione.",
        "offline": "Sei offline. Riconnettiti per modificare il seguito.",
        "archived": "Il seguito è sospeso mentre questa sessione è archiviata.",
        "sources": {
            "title": "Aggiornamenti delle sessioni",
            "waitingRuntime": "In attesa che la sessione di destinazione si riconnetta.",
            "unsupported": "Aggiorna o riconnetti la CLI sulla macchina di destinazione per ricevere gli aggiornamenti.",
            "pausedArchived": "Gli aggiornamenti sono in pausa mentre la sorgente o la destinazione è archiviata.",
            "add": "Segui in un'altra sessione…",
            "addSource": "Invia aggiornamenti da un’altra sessione…",
            "row": ({ title }) => `Aggiornamenti da “${title}”`,
            "nextTurn": "Prossimo turno",
            "wakeOnHumanChange": "Riattiva quando una persona aggiunge un messaggio",
            "stop": "Interrompi gli aggiornamenti",
            "stopForSource": ({ title }) => `Interrompi gli aggiornamenti da «${title}»`,
            "includeNextTurn": "Includi gli aggiornamenti nel prossimo turno della destinazione.",
            "sourceKeyPreparing": "Preparazione dell’accesso crittografato…",
            "sourceKeyWaiting": "In attesa dell’accesso crittografato.",
            "sourceKeyUnavailable": "Questo computer non può fornire l’accesso crittografato.",
            "sourceSessionKeyUnavailable": "L’accesso crittografato di questa sessione non è disponibile qui.",
            "catchUpPending": "Recupero in sospeso"
        },
        "preferences": {
            "title": "Segui automaticamente",
            "assigned": "Sessioni assegnate a me",
            "direct": "Sessioni condivise direttamente",
            "team": "Sessioni condivise tramite team",
            "group": "Sessioni condivise tramite gruppi",
            "help": "Si applica alle nuove assegnazioni e alle sessioni appena accessibili. Le scelte esistenti restano invariate."
        }
    },
    'ja': {
        "follow": "フォロー",
        "unfollow": "フォローを解除",
        "following": "フォロー中",
        "notifications": "通知",
        "unavailableTitle": "フォローは利用できません",
        "unavailableDescription": "この Home はセッションのフォローに対応していません。",
        "editor": {
            "title": "このセッションをフォロー",
            "subtitle": "大切な更新を受け取ります。",
            "ownerSubtitle": "このセッションはあなたのものなので、更新は常に届きます。",
            "externalAttachedOnly": "バックグラウンド同期がオフのため、このセッションが接続されている間のみ更新が届く場合があります。"
        },
        "level": {
            "none": "通知なし",
            "important": "重要な更新",
            "all_messages": "新しいメッセージすべて"
        },
        "voice": {
            "title": "Voiceに含める",
            "subtitle": "Voiceでこのセッションの状況を把握できます。",
            "waitingRuntime": "Voiceの接続を待っています。",
            "unsupported": "このランタイムはフォロー中のセッションをVoiceに含める機能に対応していません。",
            "providerWithheld": "このVoiceモードでは保存されたセッションの更新を含めることはできません。",
            "waitingEncrypted": "このセッションのロックを解除してVoiceに含めてください。",
            "initialSnapshotPending": "次のVoiceのターンで、現在の状況の短い要約を含めます。"
        },
        "footer": "フォローしても、このセッションにアクセスできる人は変わりません。",
        "settingsLink": "通知設定…",
        "assignedExplanation": "担当に割り当てられたためフォロー中",
        "wakeEventExplanation": "フォロー中のコンテキストが変わったため、Happier がこのエージェントを更新とともに起動しました。",
        "accessLost": "このセッションへのアクセス権がなくなりました。",
        "offline": "オフラインです。再接続してフォロー設定を変更してください。",
        "archived": "このセッションのアーカイブ中はフォローが一時停止します。",
        "sources": {
            "title": "セッションの更新",
            "waitingRuntime": "宛先セッションの再接続を待っています。",
            "unsupported": "更新を受信するには、宛先マシンの CLI を更新するか再接続してください。",
            "pausedArchived": "送信元または宛先がアーカイブされている間、更新は一時停止されます。",
            "add": "別のセッションでフォロー…",
            "addSource": "別のセッションから更新を送信…",
            "row": ({ title }) => `「${title}」からの更新`,
            "nextTurn": "次のターン",
            "wakeOnHumanChange": "人がメッセージを追加したら起動",
            "stop": "更新を停止",
            "stopForSource": ({ title }) => `「${title}」からの更新を停止`,
            "includeNextTurn": "宛先の次のターンに更新を含めます。",
            "sourceKeyPreparing": "暗号化アクセスを準備しています…",
            "sourceKeyWaiting": "暗号化アクセスを待っています。",
            "sourceKeyUnavailable": "このコンピューターでは暗号化アクセスを提供できません。",
            "sourceSessionKeyUnavailable": "このセッションの暗号化アクセスはここでは利用できません。",
            "catchUpPending": "追いつき処理を待機中"
        },
        "preferences": {
            "title": "自動でフォロー",
            "assigned": "自分に割り当てられたセッション",
            "direct": "直接共有されたセッション",
            "team": "チームを通じて共有されたセッション",
            "group": "グループを通じて共有されたセッション",
            "help": "新しい割り当てと新たにアクセス可能になったセッションに適用されます。既存の設定は変わりません。"
        }
    },
    'pl': {
        "follow": "Obserwuj",
        "unfollow": "Przestań obserwować",
        "following": "Obserwowana",
        "notifications": "Powiadomienia",
        "unavailableTitle": "Obserwowanie jest niedostępne",
        "unavailableDescription": "Ten Home nie obsługuje obserwowania sesji.",
        "editor": {
            "title": "Obserwuj tę sesję",
            "subtitle": "Otrzymuj aktualizacje, które są dla Ciebie ważne.",
            "ownerSubtitle": "Ta sesja należy do Ciebie, więc jej aktualizacje zawsze do Ciebie docierają.",
            "externalAttachedOnly": "Synchronizacja w tle jest wyłączona, więc aktualizacje mogą docierać tylko wtedy, gdy ta sesja jest podłączona."
        },
        "level": {
            "none": "Bez powiadomień",
            "important": "Ważne aktualizacje",
            "all_messages": "Każda nowa wiadomość"
        },
        "voice": {
            "title": "Uwzględnij w Voice",
            "subtitle": "Voice może zachować kontekst tej sesji.",
            "waitingRuntime": "Oczekiwanie na połączenie Voice.",
            "unsupported": "To środowisko nie obsługuje uwzględniania obserwowanych sesji w Voice.",
            "providerWithheld": "Ten tryb Voice nie może uwzględniać zapisanych aktualizacji sesji.",
            "waitingEncrypted": "Odblokuj tę sesję, aby uwzględnić ją w Voice.",
            "initialSnapshotPending": "W następnej turze Voice uwzględnij krótkie podsumowanie bieżącego stanu."
        },
        "footer": "Obserwowanie nigdy nie zmienia dostępu do tej sesji.",
        "settingsLink": "Ustawienia powiadomień…",
        "assignedExplanation": "Obserwujesz, ponieważ przypisano Ci tę sesję",
        "wakeEventExplanation": "Śledzony kontekst się zmienił, więc Happier wybudził tego agenta wraz z aktualizacją.",
        "accessLost": "Nie masz już dostępu do tej sesji.",
        "offline": "Jesteś offline. Połącz się ponownie, aby zmienić obserwowanie.",
        "archived": "Obserwowanie jest wstrzymane, gdy sesja jest zarchiwizowana.",
        "sources": {
            "title": "Aktualizacje sesji",
            "waitingRuntime": "Oczekiwanie na ponowne połączenie sesji docelowej.",
            "unsupported": "Zaktualizuj lub połącz ponownie CLI na maszynie docelowej, aby odbierać aktualizacje.",
            "pausedArchived": "Aktualizacje są wstrzymane, gdy źródło lub cel są zarchiwizowane.",
            "add": "Obserwuj w innej sesji…",
            "addSource": "Wysyłaj aktualizacje z innej sesji…",
            "row": ({ title }) => `Aktualizacje z „${title}”`,
            "nextTurn": "Następna tura",
            "wakeOnHumanChange": "Wybudź, gdy osoba doda wiadomość",
            "stop": "Zatrzymaj aktualizacje",
            "stopForSource": ({ title }) => `Zatrzymaj aktualizacje z „${title}”`,
            "includeNextTurn": "Uwzględnij aktualizacje w następnej turze sesji docelowej.",
            "sourceKeyPreparing": "Przygotowywanie szyfrowanego dostępu…",
            "sourceKeyWaiting": "Oczekiwanie na szyfrowany dostęp.",
            "sourceKeyUnavailable": "Ten komputer nie może zapewnić szyfrowanego dostępu.",
            "sourceSessionKeyUnavailable": "Szyfrowany dostęp do tej sesji jest tu niedostępny.",
            "catchUpPending": "Oczekuje na nadrobienie"
        },
        "preferences": {
            "title": "Obserwuj automatycznie",
            "assigned": "Sesje przypisane do mnie",
            "direct": "Sesje udostępnione bezpośrednio",
            "team": "Sesje udostępnione przez zespoły",
            "group": "Sesje udostępnione przez grupy",
            "help": "Dotyczy nowych przypisań i nowo dostępnych sesji. Istniejące wybory pozostają bez zmian."
        }
    },
    'pt': {
        "follow": "Seguir",
        "unfollow": "Deixar de seguir",
        "following": "A seguir",
        "notifications": "Notificações",
        "unavailableTitle": "Seguir não está disponível",
        "unavailableDescription": "Esta Home não oferece o seguimento de sessões.",
        "editor": {
            "title": "Seguir esta sessão",
            "subtitle": "Recebe as atualizações que te interessam.",
            "ownerSubtitle": "Esta sessão é tua, por isso as atualizações chegam-te sempre.",
            "externalAttachedOnly": "A sincronização em segundo plano está desativada, por isso as atualizações podem chegar apenas enquanto esta sessão estiver ligada."
        },
        "level": {
            "none": "Sem notificações",
            "important": "Atualizações importantes",
            "all_messages": "Cada nova mensagem"
        },
        "voice": {
            "title": "Incluir no Voice",
            "subtitle": "O Voice pode manter esta sessão em contexto.",
            "waitingRuntime": "À espera da ligação do Voice.",
            "unsupported": "Este ambiente não permite incluir sessões seguidas no Voice.",
            "providerWithheld": "Este modo Voice não pode incluir atualizações de sessões guardadas.",
            "waitingEncrypted": "Desbloqueia esta sessão para a incluir no Voice.",
            "initialSnapshotPending": "No próximo turno do Voice, inclui um breve resumo do estado atual."
        },
        "footer": "Seguir nunca altera quem pode aceder a esta sessão.",
        "settingsLink": "Definições de notificações…",
        "assignedExplanation": "Estás a seguir porque a sessão te foi atribuída",
        "wakeEventExplanation": "O contexto seguido mudou, por isso o Happier acordou este agente com a atualização.",
        "accessLost": "Já não tens acesso a esta sessão.",
        "offline": "Estás offline. Volta a ligar-te para alterar o seguimento.",
        "archived": "O seguimento está em pausa enquanto esta sessão está arquivada.",
        "sources": {
            "title": "Atualizações de sessões",
            "waitingRuntime": "A aguardar que a sessão de destino volte a ligar-se.",
            "unsupported": "Atualize ou volte a ligar a CLI na máquina de destino para receber atualizações.",
            "pausedArchived": "As atualizações ficam em pausa enquanto a origem ou o destino estiver arquivado.",
            "add": "Seguir noutra sessão…",
            "addSource": "Enviar atualizações de outra sessão…",
            "row": ({ title }) => `Atualizações de “${title}”`,
            "nextTurn": "Próximo turno",
            "wakeOnHumanChange": "Ativar quando uma pessoa adicionar uma mensagem",
            "stop": "Parar atualizações",
            "stopForSource": ({ title }) => `Parar atualizações de «${title}»`,
            "includeNextTurn": "Inclui as atualizações no próximo turno do destino.",
            "sourceKeyPreparing": "A preparar o acesso encriptado…",
            "sourceKeyWaiting": "A aguardar acesso encriptado.",
            "sourceKeyUnavailable": "Este computador não consegue fornecer acesso encriptado.",
            "sourceSessionKeyUnavailable": "O acesso encriptado desta sessão não está disponível aqui.",
            "catchUpPending": "Atualização pendente"
        },
        "preferences": {
            "title": "Seguir automaticamente",
            "assigned": "Sessões atribuídas a mim",
            "direct": "Sessões partilhadas diretamente",
            "team": "Sessões partilhadas através de equipas",
            "group": "Sessões partilhadas através de grupos",
            "help": "Aplica-se a novas atribuições e sessões recentemente acessíveis. As escolhas existentes não mudam."
        }
    },
    'ru': {
        "follow": "Подписаться",
        "unfollow": "Отписаться",
        "following": "Вы подписаны",
        "notifications": "Уведомления",
        "unavailableTitle": "Отслеживание недоступно",
        "unavailableDescription": "Этот Home не поддерживает отслеживание сессий.",
        "editor": {
            "title": "Подписаться на эту сессию",
            "subtitle": "Получайте важные для вас обновления.",
            "ownerSubtitle": "Эта сессия принадлежит вам, поэтому её обновления всегда доходят до вас.",
            "externalAttachedOnly": "Фоновая синхронизация выключена, поэтому обновления могут приходить только пока эта сессия подключена."
        },
        "level": {
            "none": "Без уведомлений",
            "important": "Важные обновления",
            "all_messages": "Каждое новое сообщение"
        },
        "voice": {
            "title": "Включить в Voice",
            "subtitle": "Voice сможет учитывать контекст этой сессии.",
            "waitingRuntime": "Ожидание подключения Voice.",
            "unsupported": "Эта среда не поддерживает включение отслеживаемых сессий в Voice.",
            "providerWithheld": "Этот режим Voice не может включать сохранённые обновления сессий.",
            "waitingEncrypted": "Разблокируйте сессию, чтобы включить её в Voice.",
            "initialSnapshotPending": "На следующем ходу Voice включить краткое описание текущего состояния."
        },
        "footer": "Подписка не меняет права доступа к этой сессии.",
        "settingsLink": "Настройки уведомлений…",
        "assignedExplanation": "Вы подписаны, потому что сессия назначена вам",
        "wakeEventExplanation": "Отслеживаемый контекст изменился, поэтому Happier разбудил этого агента с обновлением.",
        "accessLost": "У вас больше нет доступа к этой сессии.",
        "offline": "Вы не в сети. Подключитесь, чтобы изменить подписку.",
        "archived": "Подписка приостановлена, пока сессия в архиве.",
        "sources": {
            "title": "Обновления сессий",
            "waitingRuntime": "Ожидание повторного подключения целевой сессии.",
            "unsupported": "Обновите или переподключите CLI на целевой машине, чтобы получать обновления.",
            "pausedArchived": "Обновления приостановлены, пока исходная или целевая сессия находится в архиве.",
            "add": "Следить в другой сессии…",
            "addSource": "Отправлять обновления из другой сессии…",
            "row": ({ title }) => `Обновления из «${title}»`,
            "nextTurn": "Следующий ход",
            "wakeOnHumanChange": "Запускать, когда человек добавляет сообщение",
            "stop": "Остановить обновления",
            "stopForSource": ({ title }) => `Остановить обновления из «${title}»`,
            "includeNextTurn": "Добавить обновления в следующий ход целевой сессии.",
            "sourceKeyPreparing": "Подготовка зашифрованного доступа…",
            "sourceKeyWaiting": "Ожидание зашифрованного доступа.",
            "sourceKeyUnavailable": "Этот компьютер не может предоставить зашифрованный доступ.",
            "sourceSessionKeyUnavailable": "Зашифрованный доступ к этой сессии здесь недоступен.",
            "catchUpPending": "Ожидается синхронизация"
        },
        "preferences": {
            "title": "Подписываться автоматически",
            "assigned": "Назначенные мне сессии",
            "direct": "Сессии с прямым доступом",
            "team": "Сессии, доступные через команды",
            "group": "Сессии, доступные через группы",
            "help": "Применяется к новым назначениям и недавно доступным сессиям. Существующие настройки не меняются."
        }
    },
    'zh-Hans': {
        "follow": "关注",
        "unfollow": "取消关注",
        "following": "已关注",
        "notifications": "通知",
        "unavailableTitle": "无法关注",
        "unavailableDescription": "此 Home 不支持关注会话。",
        "editor": {
            "title": "关注此会话",
            "subtitle": "接收对你重要的更新。",
            "ownerSubtitle": "这个会话属于你，因此它的更新始终会送达。",
            "externalAttachedOnly": "后台同步已关闭，因此只有在此会话处于连接状态时才可能收到更新。"
        },
        "level": {
            "none": "不通知",
            "important": "重要更新",
            "all_messages": "每条新消息"
        },
        "voice": {
            "title": "纳入 Voice",
            "subtitle": "Voice 可以保留此会话的上下文。",
            "waitingRuntime": "正在等待 Voice 连接。",
            "unsupported": "此运行环境不支持将已关注的会话纳入 Voice。",
            "providerWithheld": "此 Voice 模式无法包含已存储的会话更新。",
            "waitingEncrypted": "解锁此会话以将其纳入 Voice。",
            "initialSnapshotPending": "在下一轮 Voice 对话中，提供简短的当前状态摘要。"
        },
        "footer": "关注不会改变谁可以访问此会话。",
        "settingsLink": "通知设置…",
        "assignedExplanation": "因分配给你而关注",
        "wakeEventExplanation": "关注的上下文发生变化，因此 Happier 用该更新唤醒了此智能体。",
        "accessLost": "你已无权访问此会话。",
        "offline": "你已离线。请重新连接以更改关注设置。",
        "archived": "此会话归档期间，关注将暂停。",
        "sources": {
            "title": "会话更新",
            "waitingRuntime": "正在等待目标会话重新连接。",
            "unsupported": "请更新或重新连接目标机器上的 CLI 以接收更新。",
            "pausedArchived": "源会话或目标会话归档期间，更新会暂停。",
            "add": "在其他会话中关注…",
            "addSource": "从另一个会话发送更新…",
            "row": ({ title }) => `来自“${title}”的更新`,
            "nextTurn": "下一轮",
            "wakeOnHumanChange": "有人添加消息时唤醒",
            "stop": "停止更新",
            "stopForSource": ({ title }) => `停止来自“${title}”的更新`,
            "includeNextTurn": "在目标会话的下一轮中包含更新。",
            "sourceKeyPreparing": "正在准备加密访问…",
            "sourceKeyWaiting": "正在等待加密访问。",
            "sourceKeyUnavailable": "此计算机无法提供加密访问。",
            "sourceSessionKeyUnavailable": "此会话的加密访问在此处不可用。",
            "catchUpPending": "待补充更新"
        },
        "preferences": {
            "title": "自动关注",
            "assigned": "分配给我的会话",
            "direct": "直接共享的会话",
            "team": "通过团队共享的会话",
            "group": "通过群组共享的会话",
            "help": "适用于新的分配和新获得访问权限的会话。现有选择保持不变。"
        }
    },
    'zh-Hant': {
        "follow": "關注",
        "unfollow": "取消關注",
        "following": "已關注",
        "notifications": "通知",
        "unavailableTitle": "無法追蹤",
        "unavailableDescription": "此 Home 不支援追蹤工作階段。",
        "editor": {
            "title": "關注此工作階段",
            "subtitle": "接收對你重要的更新。",
            "ownerSubtitle": "這個工作階段屬於你，因此它的更新一定會送達。",
            "externalAttachedOnly": "背景同步已關閉，因此只有在此工作階段處於連線狀態時才可能收到更新。"
        },
        "level": {
            "none": "不通知",
            "important": "重要更新",
            "all_messages": "每則新訊息"
        },
        "voice": {
            "title": "納入 Voice",
            "subtitle": "Voice 可以保留此工作階段的脈絡。",
            "waitingRuntime": "正在等待 Voice 連線。",
            "unsupported": "此執行環境不支援將已關注的工作階段納入 Voice。",
            "providerWithheld": "此 Voice 模式無法包含已儲存的工作階段更新。",
            "waitingEncrypted": "解鎖此工作階段以將其納入 Voice。",
            "initialSnapshotPending": "在下一輪 Voice 對話中，提供簡短的目前狀態摘要。"
        },
        "footer": "關注不會改變誰可以存取此工作階段。",
        "settingsLink": "通知設定…",
        "assignedExplanation": "因指派給你而關注",
        "wakeEventExplanation": "追蹤的內容有變動，因此 Happier 以該更新喚醒了此代理程式。",
        "accessLost": "你已無權存取此工作階段。",
        "offline": "你已離線。請重新連線以變更關注設定。",
        "archived": "此工作階段封存期間，關注將暫停。",
        "sources": {
            "title": "工作階段更新",
            "waitingRuntime": "正在等待目標工作階段重新連線。",
            "unsupported": "請更新或重新連線目標機器上的 CLI 以接收更新。",
            "pausedArchived": "來源或目標工作階段封存期間，更新會暫停。",
            "add": "在其他工作階段中關注…",
            "addSource": "從另一個工作階段傳送更新…",
            "row": ({ title }) => `來自「${title}」的更新`,
            "nextTurn": "下一輪",
            "wakeOnHumanChange": "有人新增訊息時喚醒",
            "stop": "停止更新",
            "stopForSource": ({ title }) => `停止來自「${title}」的更新`,
            "includeNextTurn": "在目標工作階段的下一輪中包含更新。",
            "sourceKeyPreparing": "正在準備加密存取…",
            "sourceKeyWaiting": "正在等待加密存取。",
            "sourceKeyUnavailable": "此電腦無法提供加密存取。",
            "sourceSessionKeyUnavailable": "此工作階段的加密存取在此無法使用。",
            "catchUpPending": "待補充更新"
        },
        "preferences": {
            "title": "自動關注",
            "assigned": "指派給我的工作階段",
            "direct": "直接共用的工作階段",
            "team": "透過團隊共用的工作階段",
            "group": "透過群組共用的工作階段",
            "help": "適用於新的指派及新取得存取權的工作階段。現有選擇保持不變。"
        }
    },
};
