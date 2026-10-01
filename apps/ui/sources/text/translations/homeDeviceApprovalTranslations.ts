type HomeDeviceApprovalTranslation = Readonly<{
    title: string;
    deviceFallback: string;
    homeLabel: (params: Readonly<{ home: string }>) => string;
    expiresLabel: (params: Readonly<{ expiry: string }>) => string;
    requestDetails: string;
    requestDetailsHint: string;
    fingerprintLabel: string;
    requestDetailsHelp: string;
    approve: string;
    reject: string;
    loadError: string;
    /** Why the load failed, when one or more Homes did not answer: `homes` is their names. */
    loadErrorUnreachable: (params: Readonly<{ homes: string }>) => string;
    /** Why the load failed, when one or more Homes answered with an error. */
    loadErrorFailed: (params: Readonly<{ homes: string }>) => string;
    decisionError: string;
    decisionRecovery: string;
    approved: string;
    rejected: string;
    expired: string;
    stopWaiting: string;
}>;

export const homeDeviceApprovalTranslations = {
    en: {
        title: 'Device approvals', deviceFallback: 'New device',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Expires: ${expiry}`,
        requestDetails: 'Request details', requestDetailsHint: 'Show the request key identifier',
        fingerprintLabel: 'Request-key fingerprint', requestDetailsHelp: 'This identifies the request key. It is not a code you need to compare.',
        approve: 'Approve', reject: 'Reject', loadError: "Couldn't load device approvals.",
        loadErrorUnreachable: ({ homes }) => `${homes} didn’t answer.`, loadErrorFailed: ({ homes }) => `${homes} answered with an error.`,
        decisionError: "Couldn't update this request.", decisionRecovery: 'Choose Approve or Reject to try again.',
        approved: 'Device approved', rejected: 'Device rejected', expired: 'Expired', stopWaiting: 'Stop waiting',
    },
    de: {
        title: 'Gerätefreigaben', deviceFallback: 'Neues Gerät',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Läuft ab: ${expiry}`,
        requestDetails: 'Anfragedetails', requestDetailsHint: 'Kennung des Anfrageschlüssels anzeigen',
        fingerprintLabel: 'Fingerabdruck des Anfrageschlüssels', requestDetailsHelp: 'Dies kennzeichnet den Anfrageschlüssel. Es ist kein Code, den du vergleichen musst.',
        approve: 'Genehmigen', reject: 'Ablehnen', loadError: 'Gerätefreigaben konnten nicht geladen werden.',
        loadErrorUnreachable: ({ homes }) => `${homes} hat nicht geantwortet.`, loadErrorFailed: ({ homes }) => `${homes} hat mit einem Fehler geantwortet.`,
        decisionError: 'Diese Anfrage konnte nicht aktualisiert werden.', decisionRecovery: 'Wähle erneut Genehmigen oder Ablehnen.',
        approved: 'Gerät genehmigt', rejected: 'Gerät abgelehnt', expired: 'Abgelaufen', stopWaiting: 'Nicht mehr warten',
    },
    ru: {
        title: 'Одобрение устройств', deviceFallback: 'Новое устройство',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Истекает: ${expiry}`,
        requestDetails: 'Сведения о запросе', requestDetailsHint: 'Показать идентификатор ключа запроса',
        fingerprintLabel: 'Отпечаток ключа запроса', requestDetailsHelp: 'Это идентификатор ключа запроса, а не код, который нужно сверять.',
        approve: 'Одобрить', reject: 'Отклонить', loadError: 'Не удалось загрузить запросы на одобрение устройств.',
        loadErrorUnreachable: ({ homes }) => `${homes} не отвечает.`, loadErrorFailed: ({ homes }) => `${homes} ответил ошибкой.`,
        decisionError: 'Не удалось обновить этот запрос.', decisionRecovery: 'Выберите «Одобрить» или «Отклонить», чтобы повторить попытку.',
        approved: 'Устройство одобрено', rejected: 'Устройство отклонено', expired: 'Срок истёк', stopWaiting: 'Перестать ждать',
    },
    pl: {
        title: 'Zatwierdzanie urządzeń', deviceFallback: 'Nowe urządzenie',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Wygasa: ${expiry}`,
        requestDetails: 'Szczegóły żądania', requestDetailsHint: 'Pokaż identyfikator klucza żądania',
        fingerprintLabel: 'Odcisk klucza żądania', requestDetailsHelp: 'To identyfikator klucza żądania, a nie kod wymagający porównania.',
        approve: 'Zatwierdź', reject: 'Odrzuć', loadError: 'Nie udało się wczytać próśb o zatwierdzenie urządzeń.',
        loadErrorUnreachable: ({ homes }) => `${homes} nie odpowiada.`, loadErrorFailed: ({ homes }) => `${homes} odpowiedział błędem.`,
        decisionError: 'Nie udało się zaktualizować tego żądania.', decisionRecovery: 'Wybierz ponownie Zatwierdź lub Odrzuć.',
        approved: 'Urządzenie zatwierdzone', rejected: 'Urządzenie odrzucone', expired: 'Wygasło', stopWaiting: 'Przestań czekać',
    },
    es: {
        title: 'Aprobaciones de dispositivos', deviceFallback: 'Dispositivo nuevo',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Caduca: ${expiry}`,
        requestDetails: 'Detalles de la solicitud', requestDetailsHint: 'Mostrar el identificador de la clave de solicitud',
        fingerprintLabel: 'Huella de la clave de solicitud', requestDetailsHelp: 'Esto identifica la clave de solicitud. No es un código que tengas que comparar.',
        approve: 'Aprobar', reject: 'Rechazar', loadError: 'No se han podido cargar las aprobaciones de dispositivos.',
        loadErrorUnreachable: ({ homes }) => `${homes} no ha respondido.`, loadErrorFailed: ({ homes }) => `${homes} ha respondido con un error.`,
        decisionError: 'No se ha podido actualizar esta solicitud.', decisionRecovery: 'Elige Aprobar o Rechazar para volver a intentarlo.',
        approved: 'Dispositivo aprobado', rejected: 'Dispositivo rechazado', expired: 'Caducada', stopWaiting: 'Dejar de esperar',
    },
    fr: {
        title: 'Approbations d’appareils', deviceFallback: 'Nouvel appareil',
        homeLabel: ({ home }) => `Home : ${home}`, expiresLabel: ({ expiry }) => `Expire : ${expiry}`,
        requestDetails: 'Détails de la demande', requestDetailsHint: 'Afficher l’identifiant de la clé de demande',
        fingerprintLabel: 'Empreinte de la clé de demande', requestDetailsHelp: 'Ceci identifie la clé de demande. Ce n’est pas un code à comparer.',
        approve: 'Approuver', reject: 'Rejeter', loadError: 'Impossible de charger les approbations d’appareils.',
        loadErrorUnreachable: ({ homes }) => `${homes} n’a pas répondu.`, loadErrorFailed: ({ homes }) => `${homes} a répondu par une erreur.`,
        decisionError: 'Impossible de mettre à jour cette demande.', decisionRecovery: 'Choisis Approuver ou Rejeter pour réessayer.',
        approved: 'Appareil approuvé', rejected: 'Appareil rejeté', expired: 'Expirée', stopWaiting: 'Ne plus attendre',
    },
    it: {
        title: 'Approvazioni dei dispositivi', deviceFallback: 'Nuovo dispositivo',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Scade: ${expiry}`,
        requestDetails: 'Dettagli della richiesta', requestDetailsHint: 'Mostra l’identificatore della chiave di richiesta',
        fingerprintLabel: 'Impronta della chiave di richiesta', requestDetailsHelp: 'Identifica la chiave della richiesta. Non è un codice da confrontare.',
        approve: 'Approva', reject: 'Rifiuta', loadError: 'Impossibile caricare le approvazioni dei dispositivi.',
        loadErrorUnreachable: ({ homes }) => `${homes} non ha risposto.`, loadErrorFailed: ({ homes }) => `${homes} ha risposto con un errore.`,
        decisionError: 'Impossibile aggiornare questa richiesta.', decisionRecovery: 'Scegli Approva o Rifiuta per riprovare.',
        approved: 'Dispositivo approvato', rejected: 'Dispositivo rifiutato', expired: 'Scaduta', stopWaiting: 'Smetti di attendere',
    },
    pt: {
        title: 'Aprovações de dispositivos', deviceFallback: 'Novo dispositivo',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Expira: ${expiry}`,
        requestDetails: 'Detalhes do pedido', requestDetailsHint: 'Mostrar o identificador da chave do pedido',
        fingerprintLabel: 'Impressão digital da chave do pedido', requestDetailsHelp: 'Isto identifica a chave do pedido. Não é um código que precises de comparar.',
        approve: 'Aprovar', reject: 'Rejeitar', loadError: 'Não foi possível carregar as aprovações de dispositivos.',
        loadErrorUnreachable: ({ homes }) => `${homes} não respondeu.`, loadErrorFailed: ({ homes }) => `${homes} respondeu com um erro.`,
        decisionError: 'Não foi possível atualizar este pedido.', decisionRecovery: 'Escolhe Aprovar ou Rejeitar para tentar novamente.',
        approved: 'Dispositivo aprovado', rejected: 'Dispositivo rejeitado', expired: 'Expirado', stopWaiting: 'Deixar de esperar',
    },
    ca: {
        title: 'Aprovacions de dispositius', deviceFallback: 'Dispositiu nou',
        homeLabel: ({ home }) => `Home: ${home}`, expiresLabel: ({ expiry }) => `Caduca: ${expiry}`,
        requestDetails: 'Detalls de la sol·licitud', requestDetailsHint: 'Mostra l’identificador de la clau de sol·licitud',
        fingerprintLabel: 'Empremta de la clau de sol·licitud', requestDetailsHelp: 'Això identifica la clau de sol·licitud. No és un codi que hagis de comparar.',
        approve: 'Aprova', reject: 'Rebutja', loadError: 'No s’han pogut carregar les aprovacions de dispositius.',
        loadErrorUnreachable: ({ homes }) => `${homes} no ha respost.`, loadErrorFailed: ({ homes }) => `${homes} ha respost amb un error.`,
        decisionError: 'No s’ha pogut actualitzar aquesta sol·licitud.', decisionRecovery: 'Tria Aprova o Rebutja per tornar-ho a provar.',
        approved: 'Dispositiu aprovat', rejected: 'Dispositiu rebutjat', expired: 'Caducada', stopWaiting: 'Deixa d’esperar',
    },
    ja: {
        title: 'デバイスの承認', deviceFallback: '新しいデバイス',
        homeLabel: ({ home }) => `Home：${home}`, expiresLabel: ({ expiry }) => `有効期限：${expiry}`,
        requestDetails: 'リクエストの詳細', requestDetailsHint: 'リクエストキーの識別子を表示',
        fingerprintLabel: 'リクエストキーのフィンガープリント', requestDetailsHelp: 'これはリクエストキーの識別子です。照合する必要のあるコードではありません。',
        approve: '承認', reject: '拒否', loadError: 'デバイスの承認リクエストを読み込めませんでした。',
        loadErrorUnreachable: ({ homes }) => `${homes} から応答がありません。`, loadErrorFailed: ({ homes }) => `${homes} がエラーを返しました。`,
        decisionError: 'このリクエストを更新できませんでした。', decisionRecovery: 'もう一度［承認］または［拒否］を選んでください。',
        approved: 'デバイスを承認しました', rejected: 'デバイスを拒否しました', expired: '期限切れ', stopWaiting: '待機を停止',
    },
    'zh-Hans': {
        title: '设备批准', deviceFallback: '新设备',
        homeLabel: ({ home }) => `Home：${home}`, expiresLabel: ({ expiry }) => `到期时间：${expiry}`,
        requestDetails: '请求详情', requestDetailsHint: '显示请求密钥标识符',
        fingerprintLabel: '请求密钥指纹', requestDetailsHelp: '这是请求密钥的标识符，不是需要对比的代码。',
        approve: '批准', reject: '拒绝', loadError: '无法加载设备批准请求。',
        loadErrorUnreachable: ({ homes }) => `${homes} 没有响应。`, loadErrorFailed: ({ homes }) => `${homes} 返回了错误。`,
        decisionError: '无法更新此请求。', decisionRecovery: '请选择“批准”或“拒绝”后重试。',
        approved: '设备已批准', rejected: '设备已拒绝', expired: '已过期', stopWaiting: '停止等待',
    },
    'zh-Hant': {
        title: '裝置核准', deviceFallback: '新裝置',
        homeLabel: ({ home }) => `Home：${home}`, expiresLabel: ({ expiry }) => `到期時間：${expiry}`,
        requestDetails: '請求詳細資料', requestDetailsHint: '顯示請求金鑰識別碼',
        fingerprintLabel: '請求金鑰指紋', requestDetailsHelp: '這是請求金鑰的識別碼，不是需要比對的代碼。',
        approve: '核准', reject: '拒絕', loadError: '無法載入裝置核准請求。',
        loadErrorUnreachable: ({ homes }) => `${homes} 沒有回應。`, loadErrorFailed: ({ homes }) => `${homes} 傳回了錯誤。`,
        decisionError: '無法更新此請求。', decisionRecovery: '請選擇「核准」或「拒絕」後再試一次。',
        approved: '裝置已核准', rejected: '裝置已拒絕', expired: '已過期', stopWaiting: '停止等待',
    },
} as const satisfies Record<string, HomeDeviceApprovalTranslation>;
