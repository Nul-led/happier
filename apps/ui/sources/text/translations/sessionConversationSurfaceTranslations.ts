/**
 * Copy for a Session's conversation surfaces: a human conversation opened in Details (or on its
 * phone route), and the Agent conversation that Ask Agent drafts and then runs beside it.
 *
 * One module so the conversation states, the context chip and the run origin say the same words on every
 * surface that shows them, in every locale.
 */
const en = {
    discussion: {
        loadingTitle: 'Opening this conversation…',
        offlineTitle: 'This conversation isn’t available offline',
        offlineReason: 'Reconnect and it opens where you left off.',
        errorTitle: 'Couldn’t open this conversation',
        lockedTitle: 'Can’t open this conversation on this device yet',
        lockedReason: 'It’s end-to-end encrypted, and this device’s encryption setup doesn’t match this session’s.',
        revokedTitle: 'You no longer have access to this conversation',
        revokedReason: 'This session isn’t shared with you anymore. Messages you wrote stay with the session.',
        unavailableTitle: 'Conversations aren’t available here',
        closeTab: 'Close tab',
    },
    draft: {
        leadTitle: 'Ask an agent about this',
        leadBody: 'It runs as its own conversation beside the session, with these messages as context. Nothing starts until you send.',
    },
    context: {
        fromConversation: ({ title, count }: { title: string; count: number }) =>
            `From ${title} · ${count === 1 ? '1 message' : `${count} messages`}`,
        fromUntitled: ({ count }: { count: number }) =>
            `From a conversation · ${count === 1 ? '1 message' : `${count} messages`}`,
    },
    origin: {
        fromConversation: ({ title }: { title: string }) => `from ${title}`,
        fromUntitled: 'from a conversation',
    },
    run: {
        details: 'Run details',
        loadingTitle: 'Opening this agent conversation…',
        errorTitle: 'Couldn’t open this agent conversation',
    },
};

const ca: typeof en = {
    discussion: {
        loadingTitle: 'Obrint aquesta conversa…',
        offlineTitle: 'Aquesta conversa no està disponible sense connexió',
        offlineReason: 'Torna a connectar-te i s’obrirà on la vas deixar.',
        errorTitle: 'No s’ha pogut obrir aquesta conversa',
        lockedTitle: 'Encara no es pot obrir aquesta conversa en aquest dispositiu',
        lockedReason: 'Està xifrada d’extrem a extrem, i la configuració de xifratge d’aquest dispositiu no coincideix amb la de la sessió.',
        revokedTitle: 'Ja no tens accés a aquesta conversa',
        revokedReason: 'Aquesta sessió ja no es comparteix amb tu. Els missatges que vas escriure es queden a la sessió.',
        unavailableTitle: 'Les converses no estan disponibles aquí',
        closeTab: 'Tanca la pestanya',
    },
    draft: {
        leadTitle: 'Pregunta-ho a un agent',
        leadBody: 'S’executa com una conversa pròpia al costat de la sessió, amb aquests missatges com a context. No comença res fins que no l’enviïs.',
    },
    context: {
        fromConversation: ({ title, count }) => `De ${title} · ${count === 1 ? '1 missatge' : `${count} missatges`}`,
        fromUntitled: ({ count }) => `D’una conversa · ${count === 1 ? '1 missatge' : `${count} missatges`}`,
    },
    origin: {
        fromConversation: ({ title }) => `de ${title}`,
        fromUntitled: 'd’una conversa',
    },
    run: {
        details: 'Detalls de l’execució',
        loadingTitle: 'Obrint aquesta conversa amb l’agent…',
        errorTitle: 'No s’ha pogut obrir aquesta conversa amb l’agent',
    },
};

const de: typeof en = {
    discussion: {
        loadingTitle: 'Unterhaltung wird geöffnet…',
        offlineTitle: 'Diese Unterhaltung ist offline nicht verfügbar',
        offlineReason: 'Verbinde dich erneut, dann geht es dort weiter, wo du warst.',
        errorTitle: 'Unterhaltung konnte nicht geöffnet werden',
        lockedTitle: 'Diese Unterhaltung lässt sich auf diesem Gerät noch nicht öffnen',
        lockedReason: 'Sie ist Ende-zu-Ende-verschlüsselt, und die Verschlüsselung dieses Geräts passt nicht zu der dieser Sitzung.',
        revokedTitle: 'Du hast keinen Zugriff mehr auf diese Unterhaltung',
        revokedReason: 'Diese Sitzung wird nicht mehr mit dir geteilt. Deine Nachrichten bleiben in der Sitzung.',
        unavailableTitle: 'Unterhaltungen sind hier nicht verfügbar',
        closeTab: 'Tab schließen',
    },
    draft: {
        leadTitle: 'Einen Agenten dazu fragen',
        leadBody: 'Er läuft als eigene Unterhaltung neben der Sitzung, mit diesen Nachrichten als Kontext. Nichts startet, bevor du sendest.',
    },
    context: {
        fromConversation: ({ title, count }) => `Aus ${title} · ${count === 1 ? '1 Nachricht' : `${count} Nachrichten`}`,
        fromUntitled: ({ count }) => `Aus einer Unterhaltung · ${count === 1 ? '1 Nachricht' : `${count} Nachrichten`}`,
    },
    origin: {
        fromConversation: ({ title }) => `aus ${title}`,
        fromUntitled: 'aus einer Unterhaltung',
    },
    run: {
        details: 'Ausführungsdetails',
        loadingTitle: 'Agenten-Unterhaltung wird geöffnet…',
        errorTitle: 'Agenten-Unterhaltung konnte nicht geöffnet werden',
    },
};

const es: typeof en = {
    discussion: {
        loadingTitle: 'Abriendo esta conversación…',
        offlineTitle: 'Esta conversación no está disponible sin conexión',
        offlineReason: 'Vuelve a conectarte y se abrirá donde la dejaste.',
        errorTitle: 'No se pudo abrir esta conversación',
        lockedTitle: 'Todavía no se puede abrir esta conversación en este dispositivo',
        lockedReason: 'Está cifrada de extremo a extremo y la configuración de cifrado de este dispositivo no coincide con la de la sesión.',
        revokedTitle: 'Ya no tienes acceso a esta conversación',
        revokedReason: 'Esta sesión ya no se comparte contigo. Los mensajes que escribiste se quedan en la sesión.',
        unavailableTitle: 'Las conversaciones no están disponibles aquí',
        closeTab: 'Cerrar pestaña',
    },
    draft: {
        leadTitle: 'Pregúntale a un agente',
        leadBody: 'Se ejecuta como una conversación propia junto a la sesión, con estos mensajes como contexto. No empieza nada hasta que lo envíes.',
    },
    context: {
        fromConversation: ({ title, count }) => `De ${title} · ${count === 1 ? '1 mensaje' : `${count} mensajes`}`,
        fromUntitled: ({ count }) => `De una conversación · ${count === 1 ? '1 mensaje' : `${count} mensajes`}`,
    },
    origin: {
        fromConversation: ({ title }) => `de ${title}`,
        fromUntitled: 'de una conversación',
    },
    run: {
        details: 'Detalles de la ejecución',
        loadingTitle: 'Abriendo esta conversación con el agente…',
        errorTitle: 'No se pudo abrir esta conversación con el agente',
    },
};

const fr: typeof en = {
    discussion: {
        loadingTitle: 'Ouverture de cette conversation…',
        offlineTitle: 'Cette conversation n’est pas disponible hors ligne',
        offlineReason: 'Reconnectez-vous et elle rouvrira là où vous l’avez laissée.',
        errorTitle: 'Impossible d’ouvrir cette conversation',
        lockedTitle: 'Impossible d’ouvrir cette conversation sur cet appareil pour le moment',
        lockedReason: 'Elle est chiffrée de bout en bout, et la configuration de chiffrement de cet appareil ne correspond pas à celle de la session.',
        revokedTitle: 'Vous n’avez plus accès à cette conversation',
        revokedReason: 'Cette session n’est plus partagée avec vous. Les messages que vous avez écrits restent dans la session.',
        unavailableTitle: 'Les conversations ne sont pas disponibles ici',
        closeTab: 'Fermer l’onglet',
    },
    draft: {
        leadTitle: 'Demander à un agent',
        leadBody: 'Il s’exécute dans sa propre conversation à côté de la session, avec ces messages comme contexte. Rien ne démarre avant l’envoi.',
    },
    context: {
        fromConversation: ({ title, count }) => `De ${title} · ${count === 1 ? '1 message' : `${count} messages`}`,
        fromUntitled: ({ count }) => `D’une conversation · ${count === 1 ? '1 message' : `${count} messages`}`,
    },
    origin: {
        fromConversation: ({ title }) => `de ${title}`,
        fromUntitled: 'd’une conversation',
    },
    run: {
        details: 'Détails de l’exécution',
        loadingTitle: 'Ouverture de cette conversation avec l’agent…',
        errorTitle: 'Impossible d’ouvrir cette conversation avec l’agent',
    },
};

const it: typeof en = {
    discussion: {
        loadingTitle: 'Apertura della conversazione…',
        offlineTitle: 'Questa conversazione non è disponibile offline',
        offlineReason: 'Riconnettiti e si riaprirà da dove l’hai lasciata.',
        errorTitle: 'Impossibile aprire questa conversazione',
        lockedTitle: 'Non è ancora possibile aprire questa conversazione su questo dispositivo',
        lockedReason: 'È crittografata end-to-end e la configurazione di crittografia di questo dispositivo non corrisponde a quella della sessione.',
        revokedTitle: 'Non hai più accesso a questa conversazione',
        revokedReason: 'Questa sessione non è più condivisa con te. I messaggi che hai scritto restano nella sessione.',
        unavailableTitle: 'Le conversazioni non sono disponibili qui',
        closeTab: 'Chiudi scheda',
    },
    draft: {
        leadTitle: 'Chiedi a un agente',
        leadBody: 'Viene eseguito come conversazione a sé accanto alla sessione, con questi messaggi come contesto. Non parte nulla finché non invii.',
    },
    context: {
        fromConversation: ({ title, count }) => `Da ${title} · ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
        fromUntitled: ({ count }) => `Da una conversazione · ${count === 1 ? '1 messaggio' : `${count} messaggi`}`,
    },
    origin: {
        fromConversation: ({ title }) => `da ${title}`,
        fromUntitled: 'da una conversazione',
    },
    run: {
        details: 'Dettagli dell’esecuzione',
        loadingTitle: 'Apertura della conversazione con l’agente…',
        errorTitle: 'Impossibile aprire questa conversazione con l’agente',
    },
};

const ja: typeof en = {
    discussion: {
        loadingTitle: '会話を開いています…',
        offlineTitle: 'この会話はオフラインでは利用できません',
        offlineReason: '再接続すると、前回の続きから開きます。',
        errorTitle: '会話を開けませんでした',
        lockedTitle: 'このデバイスではまだこの会話を開けません',
        lockedReason: 'エンドツーエンドで暗号化されており、このデバイスの暗号化設定がセッションと一致しません。',
        revokedTitle: 'この会話へのアクセス権がなくなりました',
        revokedReason: 'このセッションはもう共有されていません。あなたが書いたメッセージはセッションに残ります。',
        unavailableTitle: 'ここでは会話を利用できません',
        closeTab: 'タブを閉じる',
    },
    draft: {
        leadTitle: 'エージェントに聞く',
        leadBody: 'セッションの横で独立した会話として実行され、これらのメッセージが文脈になります。送信するまで何も始まりません。',
    },
    context: {
        fromConversation: ({ title, count }) => `${title}から · ${count}件のメッセージ`,
        fromUntitled: ({ count }) => `会話から · ${count}件のメッセージ`,
    },
    origin: {
        fromConversation: ({ title }) => `${title}から`,
        fromUntitled: '会話から',
    },
    run: {
        details: '実行の詳細',
        loadingTitle: 'エージェントとの会話を開いています…',
        errorTitle: 'エージェントとの会話を開けませんでした',
    },
};

const pl: typeof en = {
    discussion: {
        loadingTitle: 'Otwieranie rozmowy…',
        offlineTitle: 'Ta rozmowa nie jest dostępna offline',
        offlineReason: 'Połącz się ponownie, a otworzy się tam, gdzie skończyłeś.',
        errorTitle: 'Nie udało się otworzyć tej rozmowy',
        lockedTitle: 'Tej rozmowy nie można jeszcze otworzyć na tym urządzeniu',
        lockedReason: 'Jest szyfrowana end-to-end, a ustawienia szyfrowania tego urządzenia nie pasują do ustawień sesji.',
        revokedTitle: 'Nie masz już dostępu do tej rozmowy',
        revokedReason: 'Ta sesja nie jest już Ci udostępniona. Napisane przez Ciebie wiadomości zostają w sesji.',
        unavailableTitle: 'Rozmowy nie są tu dostępne',
        closeTab: 'Zamknij kartę',
    },
    draft: {
        leadTitle: 'Zapytaj agenta',
        leadBody: 'Działa jako osobna rozmowa obok sesji, z tymi wiadomościami jako kontekstem. Nic się nie uruchomi, dopóki nie wyślesz.',
    },
    context: {
        fromConversation: ({ title, count }) => `Z ${title} · wiadomości: ${count}`,
        fromUntitled: ({ count }) => `Z rozmowy · wiadomości: ${count}`,
    },
    origin: {
        fromConversation: ({ title }) => `z ${title}`,
        fromUntitled: 'z rozmowy',
    },
    run: {
        details: 'Szczegóły uruchomienia',
        loadingTitle: 'Otwieranie rozmowy z agentem…',
        errorTitle: 'Nie udało się otworzyć rozmowy z agentem',
    },
};

const pt: typeof en = {
    discussion: {
        loadingTitle: 'Abrindo esta conversa…',
        offlineTitle: 'Esta conversa não está disponível offline',
        offlineReason: 'Reconecte-se e ela abrirá de onde você parou.',
        errorTitle: 'Não foi possível abrir esta conversa',
        lockedTitle: 'Ainda não é possível abrir esta conversa neste dispositivo',
        lockedReason: 'Ela é criptografada de ponta a ponta, e a configuração de criptografia deste dispositivo não corresponde à da sessão.',
        revokedTitle: 'Você não tem mais acesso a esta conversa',
        revokedReason: 'Esta sessão não é mais compartilhada com você. As mensagens que você escreveu continuam na sessão.',
        unavailableTitle: 'As conversas não estão disponíveis aqui',
        closeTab: 'Fechar aba',
    },
    draft: {
        leadTitle: 'Pergunte a um agente',
        leadBody: 'Ele roda como uma conversa própria ao lado da sessão, com estas mensagens como contexto. Nada começa até você enviar.',
    },
    context: {
        fromConversation: ({ title, count }) => `De ${title} · ${count === 1 ? '1 mensagem' : `${count} mensagens`}`,
        fromUntitled: ({ count }) => `De uma conversa · ${count === 1 ? '1 mensagem' : `${count} mensagens`}`,
    },
    origin: {
        fromConversation: ({ title }) => `de ${title}`,
        fromUntitled: 'de uma conversa',
    },
    run: {
        details: 'Detalhes da execução',
        loadingTitle: 'Abrindo esta conversa com o agente…',
        errorTitle: 'Não foi possível abrir esta conversa com o agente',
    },
};

const ru: typeof en = {
    discussion: {
        loadingTitle: 'Открываем беседу…',
        offlineTitle: 'Эта беседа недоступна офлайн',
        offlineReason: 'Подключитесь снова — она откроется там, где вы остановились.',
        errorTitle: 'Не удалось открыть беседу',
        lockedTitle: 'Эту беседу пока нельзя открыть на этом устройстве',
        lockedReason: 'Она защищена сквозным шифрованием, а настройки шифрования этого устройства не совпадают с настройками сеанса.',
        revokedTitle: 'У вас больше нет доступа к этой беседе',
        revokedReason: 'Этот сеанс вам больше не открыт. Ваши сообщения остаются в сеансе.',
        unavailableTitle: 'Беседы здесь недоступны',
        closeTab: 'Закрыть вкладку',
    },
    draft: {
        leadTitle: 'Спросить агента',
        leadBody: 'Он работает как отдельная беседа рядом с сеансом, а эти сообщения служат контекстом. Ничего не начнётся, пока вы не отправите.',
    },
    context: {
        fromConversation: ({ title, count }) => `Из «${title}» · сообщений: ${count}`,
        fromUntitled: ({ count }) => `Из беседы · сообщений: ${count}`,
    },
    origin: {
        fromConversation: ({ title }) => `из «${title}»`,
        fromUntitled: 'из беседы',
    },
    run: {
        details: 'Подробности запуска',
        loadingTitle: 'Открываем беседу с агентом…',
        errorTitle: 'Не удалось открыть беседу с агентом',
    },
};

const zhHans: typeof en = {
    discussion: {
        loadingTitle: '正在打开此对话…',
        offlineTitle: '此对话无法离线查看',
        offlineReason: '重新连接后，会从你离开的地方打开。',
        errorTitle: '无法打开此对话',
        lockedTitle: '暂时无法在此设备上打开此对话',
        lockedReason: '它经过端到端加密，而此设备的加密设置与该会话不一致。',
        revokedTitle: '你已无法访问此对话',
        revokedReason: '此会话已不再与你共享。你写的消息会保留在会话中。',
        unavailableTitle: '此处无法使用对话',
        closeTab: '关闭标签页',
    },
    draft: {
        leadTitle: '询问智能体',
        leadBody: '它会作为独立的对话在会话旁运行，并以这些消息为上下文。发送之前不会开始。',
    },
    context: {
        fromConversation: ({ title, count }) => `来自 ${title} · ${count} 条消息`,
        fromUntitled: ({ count }) => `来自一个对话 · ${count} 条消息`,
    },
    origin: {
        fromConversation: ({ title }) => `来自 ${title}`,
        fromUntitled: '来自一个对话',
    },
    run: {
        details: '运行详情',
        loadingTitle: '正在打开与智能体的对话…',
        errorTitle: '无法打开与智能体的对话',
    },
};

const zhHant: typeof en = {
    discussion: {
        loadingTitle: '正在開啟此對話…',
        offlineTitle: '此對話無法離線檢視',
        offlineReason: '重新連線後，會從你離開的地方開啟。',
        errorTitle: '無法開啟此對話',
        lockedTitle: '暫時無法在此裝置上開啟此對話',
        lockedReason: '它經過端對端加密，而此裝置的加密設定與該工作階段不一致。',
        revokedTitle: '你已無法存取此對話',
        revokedReason: '此工作階段已不再與你共用。你寫的訊息會保留在工作階段中。',
        unavailableTitle: '此處無法使用對話',
        closeTab: '關閉分頁',
    },
    draft: {
        leadTitle: '詢問代理程式',
        leadBody: '它會以獨立的對話在工作階段旁執行，並以這些訊息作為上下文。傳送之前不會開始。',
    },
    context: {
        fromConversation: ({ title, count }) => `來自 ${title} · ${count} 則訊息`,
        fromUntitled: ({ count }) => `來自一個對話 · ${count} 則訊息`,
    },
    origin: {
        fromConversation: ({ title }) => `來自 ${title}`,
        fromUntitled: '來自一個對話',
    },
    run: {
        details: '執行詳細資料',
        loadingTitle: '正在開啟與代理程式的對話…',
        errorTitle: '無法開啟與代理程式的對話',
    },
};

export const sessionConversationSurfaceTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
