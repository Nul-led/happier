const en = {
    offline: 'Offline',
    stale: "Couldn't refresh",
    lastUpdated: ({ ago }: { ago: string }) => `Last updated ${ago} ago`,
};

function translated(value: typeof en): typeof en { return value; }

/**
 * The one copy owner for "how current is this Home's Session list here".
 *
 * Every Lane 07 surface — rows, Activity, Inbox, notifications, widgets, the pet, the desktop
 * overlay and Live Activities — reads the same fact through `buildSessionContextFacts`, so the
 * words live here rather than in each surface (Lane 07.4 §8).
 */
export const sessionHomeFreshnessTranslations = {
    en,
    de: translated({
        offline: 'Offline',
        stale: 'Aktualisierung fehlgeschlagen',
        lastUpdated: ({ ago }) => `Zuletzt aktualisiert vor ${ago}`,
    }),
    fr: translated({
        offline: 'Hors ligne',
        stale: 'Actualisation impossible',
        lastUpdated: ({ ago }) => `Mis à jour il y a ${ago}`,
    }),
    es: translated({
        offline: 'Sin conexión',
        stale: 'No se pudo actualizar',
        lastUpdated: ({ ago }) => `Actualizado hace ${ago}`,
    }),
    it: translated({
        offline: 'Offline',
        stale: 'Aggiornamento non riuscito',
        lastUpdated: ({ ago }) => `Aggiornato ${ago} fa`,
    }),
    pt: translated({
        offline: 'Sem ligação',
        stale: 'Não foi possível atualizar',
        lastUpdated: ({ ago }) => `Atualizado há ${ago}`,
    }),
    ca: translated({
        offline: 'Sense connexió',
        stale: 'No s’ha pogut actualitzar',
        lastUpdated: ({ ago }) => `Actualitzat fa ${ago}`,
    }),
    pl: translated({
        offline: 'Offline',
        stale: 'Nie udało się odświeżyć',
        lastUpdated: ({ ago }) => `Ostatnia aktualizacja ${ago} temu`,
    }),
    ru: translated({
        offline: 'Не в сети',
        stale: 'Не удалось обновить',
        lastUpdated: ({ ago }) => `Обновлено ${ago} назад`,
    }),
    ja: translated({
        offline: 'オフライン',
        stale: '更新できませんでした',
        lastUpdated: ({ ago }) => `${ago}前に更新`,
    }),
    'zh-Hans': translated({
        offline: '离线',
        stale: '无法刷新',
        lastUpdated: ({ ago }) => `${ago}前更新`,
    }),
    'zh-Hant': translated({
        offline: '離線',
        stale: '無法重新整理',
        lastUpdated: ({ ago }) => `${ago}前更新`,
    }),
};
