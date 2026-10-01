/**
 * The Account preference that decides whether a plugin update that widens the access the user
 * granted (host access, Connected Account purposes, request interceptors, raw credentials) asks
 * first or applies automatically. New contributions of already-trusted code never ask, so the copy
 * talks only about access. `Happier` stays byte-identical in every locale.
 */

const en = {
    title: 'Update review',
    confirmSubtitle: 'Updates that widen the access you granted ask you first.',
    autoApplySubtitle: 'Updates apply without asking, even when their access widens.',
    confirmOption: 'Ask first',
    autoApplyOption: 'Automatic',
};

const de = {
    title: 'Update-Prüfung',
    confirmSubtitle: 'Updates, die den gewährten Zugriff erweitern, fragen zuerst nach.',
    autoApplySubtitle: 'Updates werden ohne Nachfrage angewendet, auch wenn sich ihr Zugriff erweitert.',
    confirmOption: 'Erst fragen',
    autoApplyOption: 'Automatisch',
};

const es = {
    title: 'Revisión de actualizaciones',
    confirmSubtitle: 'Las actualizaciones que amplían el acceso que concediste te preguntan primero.',
    autoApplySubtitle: 'Las actualizaciones se aplican sin preguntar, aunque amplíen su acceso.',
    confirmOption: 'Preguntar',
    autoApplyOption: 'Automático',
};

const fr = {
    title: 'Vérification des mises à jour',
    confirmSubtitle: 'Les mises à jour qui élargissent l’accès accordé vous demandent d’abord.',
    autoApplySubtitle: 'Les mises à jour s’appliquent sans demander, même si leur accès s’élargit.',
    confirmOption: 'Demander',
    autoApplyOption: 'Automatique',
};

const it = {
    title: 'Revisione aggiornamenti',
    confirmSubtitle: 'Gli aggiornamenti che ampliano l’accesso concesso chiedono prima conferma.',
    autoApplySubtitle: 'Gli aggiornamenti si applicano senza chiedere, anche se ampliano l’accesso.',
    confirmOption: 'Chiedi',
    autoApplyOption: 'Automatico',
};

const ja = {
    title: '更新の確認',
    confirmSubtitle: '許可したアクセスを広げる更新は、先に確認します。',
    autoApplySubtitle: 'アクセスが広がる場合でも、更新を確認なしで適用します。',
    confirmOption: '先に確認',
    autoApplyOption: '自動',
};

const pl = {
    title: 'Przegląd aktualizacji',
    confirmSubtitle: 'Aktualizacje, które rozszerzają przyznany dostęp, najpierw pytają.',
    autoApplySubtitle: 'Aktualizacje są stosowane bez pytania, nawet gdy rozszerzają dostęp.',
    confirmOption: 'Pytaj',
    autoApplyOption: 'Automatycznie',
};

const pt = {
    title: 'Revisão de atualizações',
    confirmSubtitle: 'Atualizações que ampliam o acesso que você concedeu perguntam primeiro.',
    autoApplySubtitle: 'Atualizações são aplicadas sem perguntar, mesmo quando ampliam o acesso.',
    confirmOption: 'Perguntar',
    autoApplyOption: 'Automático',
};

const ru = {
    title: 'Проверка обновлений',
    confirmSubtitle: 'Обновления, расширяющие выданный доступ, сначала спрашивают.',
    autoApplySubtitle: 'Обновления применяются без вопросов, даже если расширяют доступ.',
    confirmOption: 'Спрашивать',
    autoApplyOption: 'Автоматически',
};

const ca = {
    title: 'Revisió d’actualitzacions',
    confirmSubtitle: 'Les actualitzacions que amplien l’accés que vas concedir pregunten primer.',
    autoApplySubtitle: 'Les actualitzacions s’apliquen sense preguntar, encara que amplien l’accés.',
    confirmOption: 'Preguntar',
    autoApplyOption: 'Automàtic',
};

const zhHans = {
    title: '更新审核',
    confirmSubtitle: '会扩大你所授予访问权限的更新会先询问你。',
    autoApplySubtitle: '即使访问权限扩大，更新也会直接应用，不再询问。',
    confirmOption: '先询问',
    autoApplyOption: '自动',
};

const zhHant = {
    title: '更新審核',
    confirmSubtitle: '會擴大你所授予存取權限的更新會先詢問你。',
    autoApplySubtitle: '即使存取權限擴大，更新也會直接套用，不再詢問。',
    confirmOption: '先詢問',
    autoApplyOption: '自動',
};

export const pluginUpdateReviewTranslations = {
    en: en,
    de: de,
    es: es,
    fr: fr,
    it: it,
    ja: ja,
    pl: pl,
    pt: pt,
    ru: ru,
    ca: ca,
    zhHans: zhHans,
    zhHant: zhHant,
};
