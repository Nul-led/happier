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
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
