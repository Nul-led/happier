/**
 * Names of the built-in workflows (FIN 08) as the protocol catalog keys them
 * (`workflows.builtins.*`). Mounted as `workflows.builtins` by `workflowTranslations.ts`.
 */

const en = {
    runsInsideSession: 'Runs inside a session',
    keepGoing: { title: 'Keep going until done' },
    reviewAndConverge: { title: 'Review & converge' },
    planWithAPanel: { title: 'Plan with a panel', description: 'Several agents plan side by side, then the plan waits for your review.' },
    openAPullRequest: { title: 'Open a pull request', description: 'Asks for a second opinion, then opens a pull request. If the second opinion disagrees, it waits for you.' },
};

type WorkflowBuiltinTranslations = typeof en;

const de: WorkflowBuiltinTranslations = {
    runsInsideSession: 'Läuft in einer Sitzung',
    keepGoing: { title: 'Weitermachen bis fertig' },
    reviewAndConverge: { title: 'Prüfen & angleichen' },
    planWithAPanel: { title: 'Mit einem Gremium planen', description: 'Mehrere Agenten planen nebeneinander, dann wartet der Plan auf deine Prüfung.' },
    openAPullRequest: { title: 'Pull-Request öffnen', description: 'Holt eine zweite Meinung ein und öffnet dann einen Pull-Request. Wenn die zweite Meinung widerspricht, wartet er auf dich.' },
};

const es: WorkflowBuiltinTranslations = {
    runsInsideSession: 'Se ejecuta dentro de una sesión',
    keepGoing: { title: 'Seguir hasta terminar' },
    reviewAndConverge: { title: 'Revisar y converger' },
    planWithAPanel: { title: 'Planificar con un panel', description: 'Varios agentes planifican en paralelo y el plan espera tu revisión.' },
    openAPullRequest: { title: 'Abrir una pull request', description: 'Pide una segunda opinión y luego abre una pull request. Si la segunda opinión no está de acuerdo, te espera.' },
};

const fr: WorkflowBuiltinTranslations = {
    runsInsideSession: 'S’exécute dans une session',
    keepGoing: { title: 'Continuer jusqu’au bout' },
    reviewAndConverge: { title: 'Relire et converger' },
    planWithAPanel: { title: 'Planifier avec un panel', description: 'Plusieurs agents planifient côte à côte, puis le plan attend votre relecture.' },
    openAPullRequest: { title: 'Ouvrir une pull request', description: 'Demande un second avis, puis ouvre une pull request. Si le second avis n’est pas d’accord, il vous attend.' },
};

const it: WorkflowBuiltinTranslations = {
    runsInsideSession: 'Viene eseguito in una sessione',
    keepGoing: { title: 'Continua fino alla fine' },
    reviewAndConverge: { title: 'Revisiona e converge' },
    planWithAPanel: { title: 'Pianifica con un panel', description: 'Più agenti pianificano affiancati, poi il piano attende la tua revisione.' },
    openAPullRequest: { title: 'Apri una pull request', description: 'Chiede un secondo parere, poi apre una pull request. Se il secondo parere non è d’accordo, ti aspetta.' },
};

const pt: WorkflowBuiltinTranslations = {
    runsInsideSession: 'É executado numa sessão',
    keepGoing: { title: 'Continuar até terminar' },
    reviewAndConverge: { title: 'Rever e convergir' },
    planWithAPanel: { title: 'Planear com um painel', description: 'Vários agentes planeiam lado a lado e o plano aguarda a sua revisão.' },
    openAPullRequest: { title: 'Abrir um pull request', description: 'Pede uma segunda opinião e depois abre um pull request. Se a segunda opinião discordar, espera por si.' },
};

const ca: WorkflowBuiltinTranslations = {
    runsInsideSession: 'S’executa dins d’una sessió',
    keepGoing: { title: 'Continua fins acabar' },
    reviewAndConverge: { title: 'Revisa i convergeix' },
    planWithAPanel: { title: 'Planifica amb un panell', description: 'Diversos agents planifiquen en paral·lel i el pla espera la teva revisió.' },
    openAPullRequest: { title: 'Obre una pull request', description: 'Demana una segona opinió i després obre una pull request. Si la segona opinió no hi està d’acord, t’espera.' },
};

const pl: WorkflowBuiltinTranslations = {
    runsInsideSession: 'Działa w sesji',
    keepGoing: { title: 'Kontynuuj do skutku' },
    reviewAndConverge: { title: 'Przejrzyj i uzgodnij' },
    planWithAPanel: { title: 'Zaplanuj z panelem', description: 'Kilku agentów planuje obok siebie, a plan czeka na twój przegląd.' },
    openAPullRequest: { title: 'Otwórz pull request', description: 'Prosi o drugą opinię, a potem otwiera pull request. Jeśli druga opinia się nie zgadza, czeka na ciebie.' },
};

const ru: WorkflowBuiltinTranslations = {
    runsInsideSession: 'Выполняется в сессии',
    keepGoing: { title: 'Продолжать до готовности' },
    reviewAndConverge: { title: 'Проверить и свести' },
    planWithAPanel: { title: 'Спланировать с панелью', description: 'Несколько агентов планируют параллельно, затем план ждёт вашей проверки.' },
    openAPullRequest: { title: 'Открыть pull request', description: 'Запрашивает второе мнение, затем открывает pull request. Если второе мнение не согласно, ждёт вас.' },
};

const ja: WorkflowBuiltinTranslations = {
    runsInsideSession: 'セッション内で実行',
    keepGoing: { title: '完了まで続ける' },
    reviewAndConverge: { title: 'レビューして収束' },
    planWithAPanel: { title: 'パネルで計画', description: '複数のエージェントが並行して計画し、計画はあなたのレビューを待ちます。' },
    openAPullRequest: { title: 'プルリクエストを開く', description: 'セカンドオピニオンを求めてからプルリクエストを開きます。意見が合わない場合はあなたを待ちます。' },
};

const zhHans: WorkflowBuiltinTranslations = {
    runsInsideSession: '在会话中运行',
    keepGoing: { title: '持续直到完成' },
    reviewAndConverge: { title: '审查并收敛' },
    planWithAPanel: { title: '由小组规划', description: '多个代理并行规划，然后计划等待你的审查。' },
    openAPullRequest: { title: '打开拉取请求', description: '先征求第二意见，再打开拉取请求。如果第二意见不同意，它会等待你。' },
};

const zhHant: WorkflowBuiltinTranslations = {
    runsInsideSession: '在工作階段中執行',
    keepGoing: { title: '持續直到完成' },
    reviewAndConverge: { title: '審查並收斂' },
    planWithAPanel: { title: '由小組規劃', description: '多個代理並行規劃，然後計畫等待你的審查。' },
    openAPullRequest: { title: '開啟提取請求', description: '先徵詢第二意見，再開啟提取請求。如果第二意見不同意，它會等待你。' },
};

export const workflowBuiltinTranslations = {
    en,
    de,
    es,
    fr,
    it,
    pt,
    ca,
    pl,
    ru,
    ja,
    zhHans,
    zhHant,
} as const;
