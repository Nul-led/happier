type ActionConfirmationTranslations = Readonly<{
    requestedByAgent: string;
    homeTarget: (params: Readonly<{ serverId: string }>) => string;
    sessionTarget: (params: Readonly<{ sessionId: string }>) => string;
    oneShotConsequence: string;
    homeUnavailable: string;
}>;

export const actionConfirmationTranslations = {
    en: {
        requestedByAgent: 'Action requested by the session Agent',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Target session: ${sessionId}`,
        oneShotConsequence: 'Approval applies only to this request. It does not grant future Action or native permissions.',
        homeUnavailable: 'This approval belongs to a Home that is unavailable on this device. Reconnect that Home to decide it.',
    },
    de: {
        requestedByAgent: 'Vom Session-Agent angeforderte Aktion',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Ziel-Session: ${sessionId}`,
        oneShotConsequence: 'Die Freigabe gilt nur für diese Anfrage. Sie erteilt keine zukünftigen Action- oder nativen Berechtigungen.',
        homeUnavailable: 'Diese Freigabe gehört zu einem Home, das auf diesem Gerät nicht verfügbar ist. Verbinde dieses Home erneut, um zu entscheiden.',
    },
    fr: {
        requestedByAgent: 'Action demandée par l’agent de la session',
        homeTarget: ({ serverId }) => `Home : ${serverId}`,
        sessionTarget: ({ sessionId }) => `Session cible : ${sessionId}`,
        oneShotConsequence: 'L’approbation ne vaut que pour cette demande. Elle n’accorde aucune autorisation future, Action ou native.',
        homeUnavailable: 'Cette approbation appartient à un Home indisponible sur cet appareil. Reconnectez ce Home pour prendre une décision.',
    },
    ru: {
        requestedByAgent: 'Действие запрошено агентом сеанса',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Целевой сеанс: ${sessionId}`,
        oneShotConsequence: 'Одобрение действует только для этого запроса и не даёт будущих разрешений Action или системных разрешений.',
        homeUnavailable: 'Это одобрение относится к Home, недоступному на этом устройстве. Подключите Home повторно, чтобы принять решение.',
    },
    pl: {
        requestedByAgent: 'Działanie żądane przez agenta sesji',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Sesja docelowa: ${sessionId}`,
        oneShotConsequence: 'Zatwierdzenie dotyczy tylko tego żądania. Nie przyznaje przyszłych uprawnień Action ani uprawnień natywnych.',
        homeUnavailable: 'To zatwierdzenie należy do Home niedostępnego na tym urządzeniu. Połącz ten Home ponownie, aby podjąć decyzję.',
    },
    es: {
        requestedByAgent: 'Acción solicitada por el agente de la sesión',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Sesión de destino: ${sessionId}`,
        oneShotConsequence: 'La aprobación se aplica solo a esta solicitud. No concede permisos futuros de Action ni permisos nativos.',
        homeUnavailable: 'Esta aprobación pertenece a un Home que no está disponible en este dispositivo. Vuelve a conectar ese Home para decidir.',
    },
    it: {
        requestedByAgent: 'Azione richiesta dall’agente della sessione',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Sessione di destinazione: ${sessionId}`,
        oneShotConsequence: 'L’approvazione vale solo per questa richiesta. Non concede autorizzazioni future per Action né permessi nativi.',
        homeUnavailable: 'Questa approvazione appartiene a un Home non disponibile su questo dispositivo. Riconnetti quel Home per decidere.',
    },
    pt: {
        requestedByAgent: 'Ação solicitada pelo agente da sessão',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Sessão de destino: ${sessionId}`,
        oneShotConsequence: 'A aprovação vale apenas para este pedido. Não concede permissões futuras de Action nem permissões nativas.',
        homeUnavailable: 'Esta aprovação pertence a um Home indisponível neste dispositivo. Volte a ligar esse Home para decidir.',
    },
    ca: {
        requestedByAgent: 'Acció sol·licitada per l’agent de la sessió',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `Sessió de destinació: ${sessionId}`,
        oneShotConsequence: 'L’aprovació només s’aplica a aquesta sol·licitud. No concedeix permisos futurs d’Action ni permisos natius.',
        homeUnavailable: 'Aquesta aprovació pertany a un Home que no està disponible en aquest dispositiu. Torna a connectar aquest Home per decidir.',
    },
    'zh-Hans': {
        requestedByAgent: '会话代理请求的操作',
        homeTarget: ({ serverId }) => `Home：${serverId}`,
        sessionTarget: ({ sessionId }) => `目标会话：${sessionId}`,
        oneShotConsequence: '批准仅适用于此请求，不会授予未来的 Action 权限或原生权限。',
        homeUnavailable: '此批准属于本设备上不可用的 Home。请重新连接该 Home 后再作决定。',
    },
    'zh-Hant': {
        requestedByAgent: '工作階段代理程式要求的動作',
        homeTarget: ({ serverId }) => `Home：${serverId}`,
        sessionTarget: ({ sessionId }) => `目標工作階段：${sessionId}`,
        oneShotConsequence: '核准只適用於這項要求，不會授予未來的 Action 權限或原生權限。',
        homeUnavailable: '此核准屬於本裝置上無法使用的 Home。請重新連接該 Home 後再作決定。',
    },
    ja: {
        requestedByAgent: 'セッションのエージェントが要求したアクション',
        homeTarget: ({ serverId }) => `Home: ${serverId}`,
        sessionTarget: ({ sessionId }) => `対象セッション: ${sessionId}`,
        oneShotConsequence: '承認はこのリクエストにのみ適用されます。今後の Action 権限やネイティブ権限は付与されません。',
        homeUnavailable: 'この承認は、このデバイスでは利用できない Home に属しています。判断するには、その Home を再接続してください。',
    },
} as const satisfies Record<string, ActionConfirmationTranslations>;
