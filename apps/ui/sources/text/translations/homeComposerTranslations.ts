/**
 * The Home composer's suggestions. Each suggestion names where it came from; `day` is already a
 * localized weekday or relative day ("Friday", "yesterday") from `Intl`.
 */
type HomeComposerTranslation = Readonly<{
    suggestionsLabel: string;
    summarizeProjectSince: (params: Readonly<{ project: string; day: string }>) => string;
    summarizeProjectToday: (params: Readonly<{ project: string }>) => string;
    sessionsSince: (params: Readonly<{ count: number; day: string }>) => string;
    sessionsToday: (params: Readonly<{ count: number }>) => string;
}>;

export const homeComposerTranslations = {
    en: {
        suggestionsLabel: 'Suggestions',
        summarizeProjectSince: ({ project, day }) => `Summarize what changed in ${project} since ${day}`,
        summarizeProjectToday: ({ project }) => `Summarize what changed in ${project} today`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 session since ${day}` : `${count} sessions since ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 session today' : `${count} sessions today`),
    },
    ru: {
        suggestionsLabel: 'Подсказки',
        summarizeProjectSince: ({ project, day }) => `Кратко опиши, что изменилось в ${project} с момента: ${day}`,
        summarizeProjectToday: ({ project }) => `Кратко опиши, что изменилось в ${project} сегодня`,
        sessionsSince: ({ count, day }) => `Сессий с момента «${day}»: ${count}`,
        sessionsToday: ({ count }) => `Сессий сегодня: ${count}`,
    },
    pl: {
        suggestionsLabel: 'Sugestie',
        summarizeProjectSince: ({ project, day }) => `Podsumuj, co zmieniło się w ${project} od: ${day}`,
        summarizeProjectToday: ({ project }) => `Podsumuj, co zmieniło się dziś w ${project}`,
        sessionsSince: ({ count, day }) => `Sesje od: ${day} · ${count}`,
        sessionsToday: ({ count }) => `Sesje dzisiaj · ${count}`,
    },
    es: {
        suggestionsLabel: 'Sugerencias',
        summarizeProjectSince: ({ project, day }) => `Resume qué cambió en ${project} desde ${day}`,
        summarizeProjectToday: ({ project }) => `Resume qué cambió hoy en ${project}`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 sesión desde ${day}` : `${count} sesiones desde ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 sesión hoy' : `${count} sesiones hoy`),
    },
    fr: {
        suggestionsLabel: 'Suggestions',
        summarizeProjectSince: ({ project, day }) => `Résume ce qui a changé dans ${project} depuis ${day}`,
        summarizeProjectToday: ({ project }) => `Résume ce qui a changé aujourd’hui dans ${project}`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 session depuis ${day}` : `${count} sessions depuis ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 session aujourd’hui' : `${count} sessions aujourd’hui`),
    },
    it: {
        suggestionsLabel: 'Suggerimenti',
        summarizeProjectSince: ({ project, day }) => `Riassumi cosa è cambiato in ${project} da ${day}`,
        summarizeProjectToday: ({ project }) => `Riassumi cosa è cambiato oggi in ${project}`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 sessione da ${day}` : `${count} sessioni da ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 sessione oggi' : `${count} sessioni oggi`),
    },
    pt: {
        suggestionsLabel: 'Sugestões',
        summarizeProjectSince: ({ project, day }) => `Resuma o que mudou em ${project} desde ${day}`,
        summarizeProjectToday: ({ project }) => `Resuma o que mudou hoje em ${project}`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 sessão desde ${day}` : `${count} sessões desde ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 sessão hoje' : `${count} sessões hoje`),
    },
    ca: {
        suggestionsLabel: 'Suggeriments',
        summarizeProjectSince: ({ project, day }) => `Resumeix què ha canviat a ${project} des de ${day}`,
        summarizeProjectToday: ({ project }) => `Resumeix què ha canviat avui a ${project}`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 sessió des de ${day}` : `${count} sessions des de ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 sessió avui' : `${count} sessions avui`),
    },
    de: {
        suggestionsLabel: 'Vorschläge',
        summarizeProjectSince: ({ project, day }) => `Fasse zusammen, was sich in ${project} seit ${day} geändert hat`,
        summarizeProjectToday: ({ project }) => `Fasse zusammen, was sich heute in ${project} geändert hat`,
        sessionsSince: ({ count, day }) => (count === 1 ? `1 Sitzung seit ${day}` : `${count} Sitzungen seit ${day}`),
        sessionsToday: ({ count }) => (count === 1 ? '1 Sitzung heute' : `${count} Sitzungen heute`),
    },
    'zh-Hant': {
        suggestionsLabel: '建議',
        summarizeProjectSince: ({ project, day }) => `總結 ${project} 自${day}以來的變更`,
        summarizeProjectToday: ({ project }) => `總結 ${project} 今天的變更`,
        sessionsSince: ({ count, day }) => `自${day}以來 ${count} 個工作階段`,
        sessionsToday: ({ count }) => `今天 ${count} 個工作階段`,
    },
    'zh-Hans': {
        suggestionsLabel: '建议',
        summarizeProjectSince: ({ project, day }) => `总结 ${project} 自${day}以来的变更`,
        summarizeProjectToday: ({ project }) => `总结 ${project} 今天的变更`,
        sessionsSince: ({ count, day }) => `自${day}以来 ${count} 个会话`,
        sessionsToday: ({ count }) => `今天 ${count} 个会话`,
    },
    ja: {
        suggestionsLabel: '提案',
        summarizeProjectSince: ({ project, day }) => `${day}以降の ${project} の変更をまとめて`,
        summarizeProjectToday: ({ project }) => `今日の ${project} の変更をまとめて`,
        sessionsSince: ({ count, day }) => `${day}以降 ${count} 件のセッション`,
        sessionsToday: ({ count }) => `今日 ${count} 件のセッション`,
    },
} satisfies Readonly<Record<string, HomeComposerTranslation>>;
