/**
 * Copy for the Goal control (FIN 04 §5.5; 07 S16c, J14): the Work tab's Goal row and the continuation
 * row — one continuation owner per session, the agent's own goal mode where it has one, otherwise
 * Happier's Keep going. The goal's own strings (set, edit, pause, budget) stay under
 * `session.workState.goal`.
 */
const en = {
    row: {
        notSet: 'Not set',
    },
    keepGoing: {
        title: 'Keep going until done',
        nativeDescription: ({ agent }: { agent: string }) => `${agent} keeps working toward the goal on its own.`,
        description: ({ rounds }: { rounds: number }) => `After each of your turns, an agent checks the goal and continues until it's done, out of budget or making no progress, for at most ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`,
        roundsPrefix: 'Stop after',
        roundsSuffix: 'rounds',
        roundsLabel: 'Rounds before stopping',
        strikesPrefix: 'Stop after',
        strikesSuffix: 'checks without progress',
        strikesLabel: 'Checks without progress before stopping',
        secondOpinionTitle: 'Ask for a second opinion before finishing',
        secondOpinionDescription: 'Before the goal is marked done, a second agent checks it. If it disagrees, you get a notification and the goal stays open.',
        budgetUnreported: ({ agent }: { agent: string }) => `${agent} doesn't report token usage, so only the rounds and progress checks apply.`,
    },
};

const ca: typeof en = {
    row: {
        notSet: 'Sense definir',
    },
    keepGoing: {
        title: 'Continua fins acabar',
        nativeDescription: ({ agent }) => `${agent} continua treballant cap a l’objectiu pel seu compte.`,
        description: ({ rounds }) => `Després de cadascun dels teus torns, un agent revisa l’objectiu i continua fins que s’acaba, s’esgota el pressupost o deixa d’avançar, com a màxim ${rounds} ${rounds === 1 ? 'ronda' : 'rondes'}.`,
        roundsPrefix: 'Atura després de',
        roundsSuffix: 'rondes',
        roundsLabel: 'Rondes abans d’aturar-se',
        strikesPrefix: 'Atura després de',
        strikesSuffix: 'revisions sense avenç',
        strikesLabel: 'Revisions sense avenç abans d’aturar-se',
        secondOpinionTitle: 'Demana una segona opinió abans d’acabar',
        secondOpinionDescription: 'Abans de marcar l’objectiu com a fet, un segon agent el revisa. Si no hi està d’acord, reps una notificació i l’objectiu continua obert.',
        budgetUnreported: ({ agent }) => `${agent} no informa de l’ús de tokens, així que només s’apliquen les rondes i les revisions d’avenç.`,
    },
};

const de: typeof en = {
    row: {
        notSet: 'Nicht festgelegt',
    },
    keepGoing: {
        title: 'Weitermachen bis fertig',
        nativeDescription: ({ agent }) => `${agent} arbeitet selbstständig weiter am Ziel.`,
        description: ({ rounds }) => `Nach jedem deiner Züge prüft ein Agent das Ziel und macht weiter, bis es erreicht ist, das Budget aufgebraucht ist oder kein Fortschritt mehr kommt – höchstens ${rounds} ${rounds === 1 ? 'Runde' : 'Runden'}.`,
        roundsPrefix: 'Stoppen nach',
        roundsSuffix: 'Runden',
        roundsLabel: 'Runden bis zum Stopp',
        strikesPrefix: 'Stoppen nach',
        strikesSuffix: 'Prüfungen ohne Fortschritt',
        strikesLabel: 'Prüfungen ohne Fortschritt bis zum Stopp',
        secondOpinionTitle: 'Vor dem Abschluss eine zweite Meinung einholen',
        secondOpinionDescription: 'Bevor das Ziel als erledigt gilt, prüft es ein zweiter Agent. Ist er anderer Meinung, bekommst du eine Benachrichtigung und das Ziel bleibt offen.',
        budgetUnreported: ({ agent }) => `${agent} meldet keinen Token-Verbrauch, daher gelten nur die Runden und Fortschrittsprüfungen.`,
    },
};

const es: typeof en = {
    row: {
        notSet: 'Sin definir',
    },
    keepGoing: {
        title: 'Seguir hasta terminar',
        nativeDescription: ({ agent }) => `${agent} sigue trabajando hacia el objetivo por su cuenta.`,
        description: ({ rounds }) => `Después de cada uno de tus turnos, un agente revisa el objetivo y continúa hasta que se cumple, se agota el presupuesto o deja de avanzar, como máximo ${rounds} ${rounds === 1 ? 'ronda' : 'rondas'}.`,
        roundsPrefix: 'Parar tras',
        roundsSuffix: 'rondas',
        roundsLabel: 'Rondas antes de parar',
        strikesPrefix: 'Parar tras',
        strikesSuffix: 'revisiones sin avance',
        strikesLabel: 'Revisiones sin avance antes de parar',
        secondOpinionTitle: 'Pedir una segunda opinión antes de terminar',
        secondOpinionDescription: 'Antes de marcar el objetivo como hecho, un segundo agente lo revisa. Si no está de acuerdo, recibes una notificación y el objetivo sigue abierto.',
        budgetUnreported: ({ agent }) => `${agent} no informa del uso de tokens, así que solo se aplican las rondas y las revisiones de avance.`,
    },
};

const fr: typeof en = {
    row: {
        notSet: 'Non défini',
    },
    keepGoing: {
        title: 'Continuer jusqu’au bout',
        nativeDescription: ({ agent }) => `${agent} poursuit l’objectif de façon autonome.`,
        description: ({ rounds }) => `Après chacun de vos tours, un agent vérifie l’objectif et continue jusqu’à ce qu’il soit atteint, que le budget soit épuisé ou qu’il ne progresse plus, pendant ${rounds} ${rounds === 1 ? 'tour' : 'tours'} au maximum.`,
        roundsPrefix: 'Arrêter après',
        roundsSuffix: 'tours',
        roundsLabel: 'Tours avant l’arrêt',
        strikesPrefix: 'Arrêter après',
        strikesSuffix: 'vérifications sans progrès',
        strikesLabel: 'Vérifications sans progrès avant l’arrêt',
        secondOpinionTitle: 'Demander un second avis avant de terminer',
        secondOpinionDescription: 'Avant que l’objectif soit marqué comme atteint, un second agent le vérifie. S’il n’est pas d’accord, vous recevez une notification et l’objectif reste ouvert.',
        budgetUnreported: ({ agent }) => `${agent} ne signale pas sa consommation de tokens, donc seuls les tours et les vérifications de progrès s’appliquent.`,
    },
};

const it: typeof en = {
    row: {
        notSet: 'Non impostato',
    },
    keepGoing: {
        title: 'Continua fino alla fine',
        nativeDescription: ({ agent }) => `${agent} continua a lavorare all’obiettivo in autonomia.`,
        description: ({ rounds }) => `Dopo ogni tuo turno, un agente controlla l’obiettivo e continua finché non è raggiunto, il budget è esaurito o non fa più progressi, per al massimo ${rounds} round.`,
        roundsPrefix: 'Fermati dopo',
        roundsSuffix: 'round',
        roundsLabel: 'Round prima di fermarsi',
        strikesPrefix: 'Fermati dopo',
        strikesSuffix: 'controlli senza progressi',
        strikesLabel: 'Controlli senza progressi prima di fermarsi',
        secondOpinionTitle: 'Chiedi un secondo parere prima di finire',
        secondOpinionDescription: 'Prima che l’obiettivo sia segnato come raggiunto, un secondo agente lo controlla. Se non è d’accordo, ricevi una notifica e l’obiettivo resta aperto.',
        budgetUnreported: ({ agent }) => `${agent} non riporta l’uso dei token, quindi valgono solo i round e i controlli di avanzamento.`,
    },
};

const ja: typeof en = {
    row: {
        notSet: '未設定',
    },
    keepGoing: {
        title: '完了まで続ける',
        nativeDescription: ({ agent }) => `${agent} は自分で目標に向けて作業を続けます。`,
        description: ({ rounds }) => `あなたのターンが終わるたびにエージェントが目標を確認し、達成、予算切れ、進捗なしのいずれかになるまで、最大 ${rounds} ラウンド続けます。`,
        roundsPrefix: '停止するまで',
        roundsSuffix: 'ラウンド',
        roundsLabel: '停止までのラウンド数',
        strikesPrefix: '停止するまで',
        strikesSuffix: '回の進捗なしの確認',
        strikesLabel: '停止までの進捗なしの確認回数',
        secondOpinionTitle: '完了前にセカンドオピニオンを求める',
        secondOpinionDescription: '目標を完了にする前に、別のエージェントが確認します。同意しない場合は通知が届き、目標は未完了のままです。',
        budgetUnreported: ({ agent }) => `${agent} はトークン使用量を報告しないため、ラウンド数と進捗確認だけが適用されます。`,
    },
};

const pl: typeof en = {
    row: {
        notSet: 'Nie ustawiono',
    },
    keepGoing: {
        title: 'Kontynuuj do końca',
        nativeDescription: ({ agent }) => `${agent} sam kontynuuje pracę nad celem.`,
        description: ({ rounds }) => `Po każdej Twojej turze agent sprawdza cel i kontynuuje, aż cel zostanie osiągnięty, budżet się wyczerpie lub zabraknie postępów, maksymalnie przez ${rounds} ${rounds === 1 ? 'rundę' : 'rund'}.`,
        roundsPrefix: 'Zatrzymaj po',
        roundsSuffix: 'rundach',
        roundsLabel: 'Rundy przed zatrzymaniem',
        strikesPrefix: 'Zatrzymaj po',
        strikesSuffix: 'sprawdzeniach bez postępu',
        strikesLabel: 'Sprawdzenia bez postępu przed zatrzymaniem',
        secondOpinionTitle: 'Poproś o drugą opinię przed zakończeniem',
        secondOpinionDescription: 'Zanim cel zostanie oznaczony jako osiągnięty, sprawdza go drugi agent. Jeśli się nie zgadza, dostajesz powiadomienie, a cel pozostaje otwarty.',
        budgetUnreported: ({ agent }) => `${agent} nie zgłasza zużycia tokenów, więc obowiązują tylko rundy i sprawdzenia postępu.`,
    },
};

const pt: typeof en = {
    row: {
        notSet: 'Não definida',
    },
    keepGoing: {
        title: 'Continuar até terminar',
        nativeDescription: ({ agent }) => `${agent} continua a trabalhar para a meta por conta própria.`,
        description: ({ rounds }) => `Depois de cada um dos seus turnos, um agente verifica a meta e continua até ela ser cumprida, o orçamento acabar ou deixar de haver progresso, no máximo ${rounds} ${rounds === 1 ? 'rodada' : 'rodadas'}.`,
        roundsPrefix: 'Parar após',
        roundsSuffix: 'rodadas',
        roundsLabel: 'Rodadas antes de parar',
        strikesPrefix: 'Parar após',
        strikesSuffix: 'verificações sem progresso',
        strikesLabel: 'Verificações sem progresso antes de parar',
        secondOpinionTitle: 'Pedir uma segunda opinião antes de terminar',
        secondOpinionDescription: 'Antes de a meta ser marcada como concluída, um segundo agente verifica-a. Se discordar, recebe uma notificação e a meta continua aberta.',
        budgetUnreported: ({ agent }) => `${agent} não informa o uso de tokens, por isso só se aplicam as rodadas e as verificações de progresso.`,
    },
};

const ru: typeof en = {
    row: {
        notSet: 'Не задана',
    },
    keepGoing: {
        title: 'Продолжать до готовности',
        nativeDescription: ({ agent }) => `${agent} сам продолжает работу над целью.`,
        description: ({ rounds }) => `После каждого вашего хода агент проверяет цель и продолжает, пока она не достигнута, не исчерпан бюджет или не прекратится прогресс, не больше ${rounds} ${rounds === 1 ? 'раунда' : 'раундов'}.`,
        roundsPrefix: 'Остановиться после',
        roundsSuffix: 'раундов',
        roundsLabel: 'Раундов до остановки',
        strikesPrefix: 'Остановиться после',
        strikesSuffix: 'проверок без прогресса',
        strikesLabel: 'Проверок без прогресса до остановки',
        secondOpinionTitle: 'Запросить второе мнение перед завершением',
        secondOpinionDescription: 'Прежде чем цель будет отмечена выполненной, её проверяет второй агент. Если он не согласен, вы получите уведомление, а цель останется открытой.',
        budgetUnreported: ({ agent }) => `${agent} не сообщает расход токенов, поэтому действуют только раунды и проверки прогресса.`,
    },
};

const zhHans: typeof en = {
    row: {
        notSet: '未设置',
    },
    keepGoing: {
        title: '持续推进直到完成',
        nativeDescription: ({ agent }) => `${agent} 会自行朝目标继续工作。`,
        description: ({ rounds }) => `在你的每个回合结束后，一个代理会检查目标并继续推进，直到完成、预算用尽或不再有进展，最多 ${rounds} 轮。`,
        roundsPrefix: '在',
        roundsSuffix: '轮后停止',
        roundsLabel: '停止前的轮数',
        strikesPrefix: '在',
        strikesSuffix: '次无进展检查后停止',
        strikesLabel: '停止前的无进展检查次数',
        secondOpinionTitle: '完成前征求第二意见',
        secondOpinionDescription: '在目标标记为完成之前，会由另一个代理检查。如果它不同意，你会收到通知，目标保持未完成。',
        budgetUnreported: ({ agent }) => `${agent} 不报告 token 用量，因此只适用轮数和进展检查。`,
    },
};

const zhHant: typeof en = {
    row: {
        notSet: '未設定',
    },
    keepGoing: {
        title: '持續推進直到完成',
        nativeDescription: ({ agent }) => `${agent} 會自行朝目標繼續工作。`,
        description: ({ rounds }) => `在你的每個回合結束後，一個代理會檢查目標並繼續推進，直到完成、預算用盡或不再有進展，最多 ${rounds} 輪。`,
        roundsPrefix: '在',
        roundsSuffix: '輪後停止',
        roundsLabel: '停止前的輪數',
        strikesPrefix: '在',
        strikesSuffix: '次無進展檢查後停止',
        strikesLabel: '停止前的無進展檢查次數',
        secondOpinionTitle: '完成前徵求第二意見',
        secondOpinionDescription: '在目標標記為完成之前，會由另一個代理檢查。如果它不同意，你會收到通知，目標保持未完成。',
        budgetUnreported: ({ agent }) => `${agent} 不回報 token 用量，因此只適用輪數和進展檢查。`,
    },
};

export const goalControlTranslations = {
    en, ca, de, es, fr, it, ja, pl, pt, ru, zhHans, zhHant,
};
