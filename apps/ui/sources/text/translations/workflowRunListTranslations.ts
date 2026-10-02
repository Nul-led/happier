type Progress = Readonly<{ completed: number; total: number }>;

const en = {
    definitions: 'Definitions',
    stepsProgress: ({ completed, total }: Progress) => `${completed} of ${total} steps`,
    loopProgress: ({ completed, total }: Progress) => `${completed} of ${total} items`,
    startedByAgent: 'Started by an agent',
    startedByTrigger: 'Started by a trigger',
};

export const workflowRunListTranslations = {
    en,
    de: {
        definitions: 'Definitionen',
        stepsProgress: ({ completed, total }: Progress) => `${completed} von ${total} Schritten`,
        loopProgress: ({ completed, total }: Progress) => `${completed} von ${total} Elementen`,
        startedByAgent: 'Von einem Agenten gestartet',
        startedByTrigger: 'Durch einen Auslöser gestartet',
    },
    es: {
        definitions: 'Definiciones',
        stepsProgress: ({ completed, total }: Progress) => `${completed} de ${total} pasos`,
        loopProgress: ({ completed, total }: Progress) => `${completed} de ${total} elementos`,
        startedByAgent: 'Iniciado por un agente',
        startedByTrigger: 'Iniciado por un disparador',
    },
    fr: {
        definitions: 'Définitions',
        stepsProgress: ({ completed, total }: Progress) => `${completed} étapes sur ${total}`,
        loopProgress: ({ completed, total }: Progress) => `${completed} éléments sur ${total}`,
        startedByAgent: 'Démarré par un agent',
        startedByTrigger: 'Démarré par un déclencheur',
    },
    it: {
        definitions: 'Definizioni',
        stepsProgress: ({ completed, total }: Progress) => `${completed} di ${total} passaggi`,
        loopProgress: ({ completed, total }: Progress) => `${completed} di ${total} elementi`,
        startedByAgent: 'Avviato da un agente',
        startedByTrigger: 'Avviato da un trigger',
    },
    pt: {
        definitions: 'Definições',
        stepsProgress: ({ completed, total }: Progress) => `${completed} de ${total} etapas`,
        loopProgress: ({ completed, total }: Progress) => `${completed} de ${total} itens`,
        startedByAgent: 'Iniciado por um agente',
        startedByTrigger: 'Iniciado por um gatilho',
    },
    ca: {
        definitions: 'Definicions',
        stepsProgress: ({ completed, total }: Progress) => `${completed} de ${total} passos`,
        loopProgress: ({ completed, total }: Progress) => `${completed} de ${total} elements`,
        startedByAgent: 'Iniciat per un agent',
        startedByTrigger: 'Iniciat per un activador',
    },
    pl: {
        definitions: 'Definicje',
        stepsProgress: ({ completed, total }: Progress) => `${completed} z ${total} kroków`,
        loopProgress: ({ completed, total }: Progress) => `${completed} z ${total} elementów`,
        startedByAgent: 'Uruchomiono przez agenta',
        startedByTrigger: 'Uruchomiono przez wyzwalacz',
    },
    ru: {
        definitions: 'Определения',
        stepsProgress: ({ completed, total }: Progress) => `${completed} из ${total} шагов`,
        loopProgress: ({ completed, total }: Progress) => `${completed} из ${total} элементов`,
        startedByAgent: 'Запущено агентом',
        startedByTrigger: 'Запущено триггером',
    },
    ja: {
        definitions: '定義',
        stepsProgress: ({ completed, total }: Progress) => `${total} ステップ中 ${completed} 完了`,
        loopProgress: ({ completed, total }: Progress) => `${total} 項目中 ${completed} 完了`,
        startedByAgent: 'エージェントが開始',
        startedByTrigger: 'トリガーが開始',
    },
    zhHans: {
        definitions: '定义',
        stepsProgress: ({ completed, total }: Progress) => `${total} 个步骤中已完成 ${completed} 个`,
        loopProgress: ({ completed, total }: Progress) => `${total} 项中已完成 ${completed} 项`,
        startedByAgent: '由代理启动',
        startedByTrigger: '由触发器启动',
    },
    zhHant: {
        definitions: '定義',
        stepsProgress: ({ completed, total }: Progress) => `${total} 個步驟中已完成 ${completed} 個`,
        loopProgress: ({ completed, total }: Progress) => `${total} 項中已完成 ${completed} 項`,
        startedByAgent: '由代理啟動',
        startedByTrigger: '由觸發器啟動',
    },
} satisfies Record<string, typeof en>;
