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
        succeeded: 'Done',
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
        succeeded: 'Fet',
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
        succeeded: 'Fertig',
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
        succeeded: 'Listo',
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
        succeeded: 'Gotowe',
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
        succeeded: 'Готово',
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
    summaryA11y: ({ title, status }) => `${title}，${status}`,
    summaryAttentionA11y: ({ title, status, attention }) => `${title}，${status}，${attention}`,
};

export const sessionAgentActivityTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
