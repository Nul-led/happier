/**
 * The shared status vocabulary's bucket labels (INT §3.1 #4, §5.3): Needs you · Working · Finished ·
 * Idle · Offline. Read through `describeWorkStatusBucket` (`components/work/status`), so every surface
 * that groups work by status — Boards' By status, the Work tab, the Sessions list's status groups —
 * names the buckets the same way; a Sessions row needing attention is announced with `needs_you`.
 */
type WorkStatusTranslations = Readonly<{
    buckets: Readonly<{
        needs_you: string;
        working: string;
        finished: string;
        idle: string;
        offline: string;
    }>;
}>;

const en: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Needs you',
        working: 'Working',
        finished: 'Finished',
        idle: 'Idle',
        offline: 'Offline',
    },
};

const ca: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Et necessita',
        working: 'Treballant',
        finished: 'Acabat',
        idle: 'En repòs',
        offline: 'Sense connexió',
    },
};

const de: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Braucht dich',
        working: 'In Arbeit',
        finished: 'Fertig',
        idle: 'Inaktiv',
        offline: 'Offline',
    },
};

const es: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Te necesita',
        working: 'Trabajando',
        finished: 'Terminado',
        idle: 'Inactivo',
        offline: 'Sin conexión',
    },
};

const fr: WorkStatusTranslations = {
    buckets: {
        needs_you: 'A besoin de vous',
        working: 'En cours',
        finished: 'Terminé',
        idle: 'Inactif',
        offline: 'Hors ligne',
    },
};

const it: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Ha bisogno di te',
        working: 'In corso',
        finished: 'Concluso',
        idle: 'Inattivo',
        offline: 'Offline',
    },
};

const ja: WorkStatusTranslations = {
    buckets: {
        needs_you: '対応待ち',
        working: '作業中',
        finished: '完了',
        idle: 'アイドル',
        offline: 'オフライン',
    },
};

const pl: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Czeka na Ciebie',
        working: 'W toku',
        finished: 'Zakończone',
        idle: 'Bezczynne',
        offline: 'Offline',
    },
};

const pt: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Precisa de você',
        working: 'Trabalhando',
        finished: 'Concluído',
        idle: 'Ocioso',
        offline: 'Offline',
    },
};

const ru: WorkStatusTranslations = {
    buckets: {
        needs_you: 'Ждут вас',
        working: 'В работе',
        finished: 'Завершено',
        idle: 'Простаивает',
        offline: 'Не в сети',
    },
};

const zhHans: WorkStatusTranslations = {
    buckets: {
        needs_you: '需要你',
        working: '进行中',
        finished: '已完成',
        idle: '空闲',
        offline: '离线',
    },
};

const zhHant: WorkStatusTranslations = {
    buckets: {
        needs_you: '需要你',
        working: '進行中',
        finished: '已完成',
        idle: '閒置',
        offline: '離線',
    },
};

export const workStatusTranslations = {
    en: { ...en, task: { stopped: 'Stopped', linkFailed: "The session was created, but its task link wasn’t saved. Retry to link the same session." } },
    ca: { ...ca, task: { stopped: 'Aturada', linkFailed: 'La sessió s’ha creat, però no s’ha desat l’enllaç amb la tasca. Torna-ho a provar per enllaçar la mateixa sessió.' } },
    de: { ...de, task: { stopped: 'Gestoppt', linkFailed: 'Die Sitzung wurde erstellt, aber die Aufgabenverknüpfung wurde nicht gespeichert. Versuche erneut, dieselbe Sitzung zu verknüpfen.' } },
    es: { ...es, task: { stopped: 'Detenida', linkFailed: 'La sesión se creó, pero no se guardó su enlace con la tarea. Reintenta para enlazar la misma sesión.' } },
    fr: { ...fr, task: { stopped: 'Arrêtée', linkFailed: 'La session a été créée, mais son lien avec la tâche n’a pas été enregistré. Réessayez pour lier la même session.' } },
    it: { ...it, task: { stopped: 'Interrotta', linkFailed: 'La sessione è stata creata, ma il collegamento all’attività non è stato salvato. Riprova per collegare la stessa sessione.' } },
    ja: { ...ja, task: { stopped: '停止', linkFailed: 'セッションは作成されましたが、タスクへのリンクは保存されませんでした。再試行すると同じセッションをリンクします。' } },
    pl: { ...pl, task: { stopped: 'Zatrzymana', linkFailed: 'Sesja została utworzona, ale jej powiązanie z zadaniem nie zostało zapisane. Spróbuj ponownie powiązać tę samą sesję.' } },
    pt: { ...pt, task: { stopped: 'Parada', linkFailed: 'A sessão foi criada, mas o vínculo com a tarefa não foi salvo. Tente novamente para vincular a mesma sessão.' } },
    ru: { ...ru, task: { stopped: 'Остановлена', linkFailed: 'Сессия создана, но связь с задачей не сохранена. Повторите попытку, чтобы связать ту же сессию.' } },
    zhHans: { ...zhHans, task: { stopped: '已停止', linkFailed: '会话已创建，但未保存与任务的关联。重试将关联同一个会话。' } },
    zhHant: { ...zhHant, task: { stopped: '已停止', linkFailed: '工作階段已建立，但未儲存與任務的關聯。重試將關聯同一個工作階段。' } },
};
