const updatePolicy = {
    title: 'Update policy',
    target: ({ machine, server }: { machine: string; server: string }) => `Applies on ${machine} via ${server}.`,
    pinned: 'Pinned',
    pinnedSubtitle: 'Do not update until you choose another policy.',
    allowed: 'Updates allowed',
    allowedSubtitle: 'Explicit updates proceed without another prompt unless declared authority expands.',
} as const;

const installReviewSections = {
    archiveUrlRetention: 'Happier saves the full archive URL on the selected machine, including any credentials, for future updates. Expired or revoked URLs can make updates fail.',
    trustedCodeTitle: 'Trusted code',
    trustedCodeDisclosure: 'Plugins run as trusted code inside Happier, not in a sandbox. A plugin can use this app’s own authority directly — files, network, environment and processes — beyond the Happier-mediated services listed below. That list is what the plugin declared and what you can turn off later, not a limit on what its code can reach.',
    identity: 'Identity and package',
    evidence: 'Technical evidence',
    executableCode: 'Executable code and contributions',
    requiredAccess: 'Required host access',
    optionalAccess: 'Optional host access',
    requestInterceptors: 'Request interceptors',
    rawCredentials: 'Raw credential declarations',
    compatibility: 'Compatibility and updates',
    none: 'None declared',
    scope: ({ scope }: { scope: string }) => `Scope: ${scope}`,
    developmentPath: ({ locator }: { locator: string }) => `${locator} · development`,
    publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · unverified`,
    integrityBasis: {
        expected: ({ integrity }: { integrity: string }) => `${integrity} (expected)`,
        observed: ({ integrity }: { integrity: string }) => `${integrity} (observed)`,
    },
    signatureStatus: {
        // The registry signing key authenticates the registry response over the
        // exact package/version/integrity fact; it never attests the plugin
        // publisher a catalog displays.
        verified: ({ keyId }: { keyId: string }) => `Verified registry signature: ${keyId}`,
        unsupported: ({ keyId }: { keyId: string }) => `Unsupported registry signature: ${keyId}`,
    },
    provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Declared, unverified: ${predicateType}`,
    provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Retrieved, unverified: ${predicateTypes}`,
    provenanceUnavailable: ({ code }: { code: string }) => `Provenance unavailable: ${code}`,
    curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Unreviewed catalog source: ${sourceId}`,
    curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Reviewed by ${sourceId} on ${reviewedAt}${reason}`,
    savedSecret: 'Saved secret',
    connectedAccount: 'Connected account',
    secretKinds: ({ kinds }: { kinds: string }) => `Secret kinds: ${kinds}`,
    connectedAccountService: ({ service }: { service: string }) => `Service: ${service}`,
    credentialPurpose: ({ purpose }: { purpose: string }) => `Purpose: ${purpose}`,
    credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Used in ${realm} during ${phase}`,
    credentialAccess: ({ access }: { access: string }) => `Access: ${access}`,
    credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Headers sent to ${origin}: ${headers}`,
    credentialRequestEnvironment: ({ keys }: { keys: string }) => `Environment variables: ${keys}`,
    credentialRequestFiles: ({ files }: { files: string }) => `Files: ${files}`,
    realm: { web: 'web', ios: 'iOS', android: 'Android', daemon: 'daemon' },
    phase: { settings: 'settings', prepare: 'preparation', connection: 'connection', speech: 'speech' },
    runtimeApi: ({ version }: { version: number }) => `Runtime API ${version}`,
    source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`,
    sourceKind: { path: 'Local path', archive: 'Archive', npm: 'npm package' },
    marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`,
    marketplaceSourceKind: { curated: 'Curated catalog', 'community-npm': 'Community npm catalog', user: 'User catalog' },
    executableRealm: { daemon: 'Background service code', reactNative: 'App interface code', hostedWeb: 'Isolated hosted-web code' },
    uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`,
    uiArtifactStatus: { verified: 'Verified interface artifacts', none: 'No interface artifacts', unavailable: 'Interface artifacts unavailable' },
    authorizationClass: { cooperativeDisclosure: 'Cooperative disclosure', hostResourceSelection: 'Selected host resources', presentIntentOrOs: 'Current intent or operating-system permission' },
    priority: ({ priority }: { priority: number }) => `Priority ${priority}`,
} as const;

const sourceAdministration = {
    title: 'Sources & registries',
    subtitle: 'Choose where this machine discovers exact npm packages and how it reaches their registries.',
    communityTitle: 'Community npm',
    communitySubtitle: 'Built in · unreviewed discovery of eligible Happier plugins on public npm, not arbitrary npm packages.',
    configuredTitle: 'Marketplace sources',
    configuredEmpty: 'No additional marketplace sources configured.',
    add: 'Add source',
    edit: 'Edit source',
    remove: 'Remove source',
    removeTitle: 'Remove marketplace source?',
    removeBody: ({ name }: { name: string }) => `${name} will no longer be used for discovery on this machine. Installed plugins are not changed.`,
    sourceUrl: 'Source URL',
    displayName: 'Display name',
    description: 'Description (optional)',
    enabled: 'Enabled',
    disabled: 'Disabled',
    curated: 'Curated source',
    user: 'Your source',
    loadError: 'Marketplace sources could not be loaded.',
    retry: 'Retry',
    operationFailed: 'This change could not be applied. Check the machine connection and try again.',
    operationOutcomeUnknownTitle: 'Change needs review',
    operationOutcomeUnknownBody: 'The selected machine may have applied this change, but Happier could not confirm the result. Review the refreshed settings before changing it again.',
} as const;

/**
 * A daemon that stopped answering mid-change is not a daemon that refused the
 * change: it may already have applied it. Presenting that as a definite failure
 * invites the reader to retry an install or uninstall that has in fact landed,
 * so the copy names the exact target and sends them to the authoritative answer
 * — the machine's own Installed list and current version — before any retry.
 */
const pluginChangeOutcomeUnknown = {
    pluginChangeOutcomeUnknownTitle: 'Outcome not confirmed',
    pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) =>
        `Happier could not confirm whether ${action} for ${name} finished on ${machine} (${server}). Check Installed on that machine and its current version there before trying again.`,
} as const;

/**
 * Two adjacent buttons destroy different things: one erases the stored secret,
 * the other only detaches it from this setting. "Delete" beside "Remove" says
 * nothing about which, so each label names its own object and its hint states
 * what survives.
 */
const secretFieldActions = {
    delete: 'Delete saved secret',
    deleteHint: 'Erases the stored secret value. This cannot be undone.',
    unbind: 'Remove from this plugin',
    unbindHint: 'Detaches the saved secret from this setting. The secret itself is kept.',
} as const;

const marketplacePresentation = {
    en: {
        diagnosticsIssueTitle: 'Plugin issue',
        diagnosticsRecovery: 'Review the detail above, then reload the plugin or refresh this page after correcting it.',
        diagnosticsTechnicalCode: ({ code }: { code: string }) => `Technical code: ${code}`,
        discover: {
            publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Publisher label: ${displayName} (${id})`,
            categories: ({ values }: { values: string }) => `Categories: ${values}`,
            runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Runs in: ${realms} · Platforms: ${platforms}`,
            reviewStatus: { curated: 'Curated recommendation', unreviewed: 'Unreviewed', withdrawn: 'Withdrawn' },
            executableRealm: { daemon: 'background service', client: 'app', hostedWeb: 'hosted web' },
            platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' },
            diagnostic: { title: 'Marketplace source issue', recovery: 'Refresh Discover. If this continues, review Sources & registries.', unreachableTitle: ({ source }: { source: string }) => `Couldn’t reach ${source}`, behindTitle: ({ source }: { source: string }) => `${source} answered with older or missing data`, indexTitle: 'The plugin index is incomplete', otherSourcesShown: 'Results from other sources are still shown.' },
        },
    },
    de: {
        diagnosticsIssueTitle: 'Plugin-Problem', diagnosticsRecovery: 'Prüfe die Details oben und lade das Plugin oder diese Seite nach der Korrektur neu.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Technischer Code: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Herausgeberangabe: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Kategorien: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Ausführung: ${realms} · Plattformen: ${platforms}`, reviewStatus: { curated: 'Kuratierte Empfehlung', unreviewed: 'Nicht geprüft', withdrawn: 'Zurückgezogen' }, executableRealm: { daemon: 'Hintergrunddienst', client: 'App', hostedWeb: 'gehostetes Web' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problem mit einer Marktplatzquelle', recovery: 'Aktualisiere „Entdecken“. Wenn das Problem bleibt, prüfe „Quellen & Registries“.', unreachableTitle: ({ source }: { source: string }) => `${source} ist nicht erreichbar`, behindTitle: ({ source }: { source: string }) => `${source} lieferte veraltete oder unvollständige Daten`, indexTitle: 'Der Plugin-Index ist unvollständig', otherSourcesShown: 'Ergebnisse anderer Quellen werden weiterhin angezeigt.' } },
    },
    fr: {
        diagnosticsIssueTitle: 'Problème de plugin', diagnosticsRecovery: 'Consultez le détail ci-dessus, puis rechargez le plugin ou cette page après correction.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Code technique : ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Étiquette d’éditeur : ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Catégories : ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `S’exécute dans : ${realms} · Plateformes : ${platforms}`, reviewStatus: { curated: 'Recommandation sélectionnée', unreviewed: 'Non examiné', withdrawn: 'Retiré' }, executableRealm: { daemon: 'service en arrière-plan', client: 'application', hostedWeb: 'web hébergé' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problème de source de marketplace', recovery: 'Actualisez Découvrir. Si le problème persiste, vérifiez Sources et registres.', unreachableTitle: ({ source }: { source: string }) => `Impossible de joindre ${source}`, behindTitle: ({ source }: { source: string }) => `${source} a répondu avec des données anciennes ou incomplètes`, indexTitle: 'L’index des plugins est incomplet', otherSourcesShown: 'Les résultats des autres sources restent affichés.' } },
    },
    ru: {
        diagnosticsIssueTitle: 'Проблема плагина', diagnosticsRecovery: 'Изучите сведения выше, затем после исправления перезагрузите плагин или эту страницу.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Технический код: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Метка издателя: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Категории: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Запускается в: ${realms} · Платформы: ${platforms}`, reviewStatus: { curated: 'Отобранная рекомендация', unreviewed: 'Не проверено', withdrawn: 'Отозвано' }, executableRealm: { daemon: 'фоновая служба', client: 'приложение', hostedWeb: 'размещённый веб' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Веб', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Проблема источника маркетплейса', recovery: 'Обновите раздел «Обзор». Если проблема останется, проверьте «Источники и реестры».', unreachableTitle: ({ source }: { source: string }) => `Не удалось связаться с ${source}`, behindTitle: ({ source }: { source: string }) => `${source} вернул устаревшие или неполные данные`, indexTitle: 'Индекс плагинов неполон', otherSourcesShown: 'Результаты других источников по-прежнему показаны.' } },
    },
    es: {
        diagnosticsIssueTitle: 'Problema del plugin', diagnosticsRecovery: 'Revisa el detalle anterior y, tras corregirlo, vuelve a cargar el plugin o esta página.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Código técnico: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Etiqueta del publicador: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Categorías: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Se ejecuta en: ${realms} · Plataformas: ${platforms}`, reviewStatus: { curated: 'Recomendación seleccionada', unreviewed: 'Sin revisar', withdrawn: 'Retirado' }, executableRealm: { daemon: 'servicio en segundo plano', client: 'aplicación', hostedWeb: 'web alojada' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problema con una fuente del marketplace', recovery: 'Actualiza Descubrir. Si continúa, revisa Fuentes y registros.', unreachableTitle: ({ source }: { source: string }) => `No se pudo conectar con ${source}`, behindTitle: ({ source }: { source: string }) => `${source} respondió con datos antiguos o incompletos`, indexTitle: 'El índice de plugins está incompleto', otherSourcesShown: 'Los resultados de otras fuentes se siguen mostrando.' } },
    },
    it: {
        diagnosticsIssueTitle: 'Problema del plugin', diagnosticsRecovery: 'Controlla i dettagli sopra, quindi ricarica il plugin o questa pagina dopo la correzione.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Codice tecnico: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Etichetta editore: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Categorie: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Esecuzione: ${realms} · Piattaforme: ${platforms}`, reviewStatus: { curated: 'Suggerimento selezionato', unreviewed: 'Non verificato', withdrawn: 'Ritirato' }, executableRealm: { daemon: 'servizio in background', client: 'app', hostedWeb: 'web ospitato' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problema con una fonte del marketplace', recovery: 'Aggiorna Scopri. Se continua, controlla Fonti e registri.', unreachableTitle: ({ source }: { source: string }) => `Impossibile raggiungere ${source}`, behindTitle: ({ source }: { source: string }) => `${source} ha risposto con dati vecchi o incompleti`, indexTitle: 'L’indice dei plugin è incompleto', otherSourcesShown: 'I risultati delle altre fonti restano visibili.' } },
    },
    pt: {
        diagnosticsIssueTitle: 'Problema do plugin', diagnosticsRecovery: 'Consulte os detalhes acima e, depois de corrigir, recarregue o plugin ou esta página.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Código técnico: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Identificação do editor: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Categorias: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Executa em: ${realms} · Plataformas: ${platforms}`, reviewStatus: { curated: 'Recomendação selecionada', unreviewed: 'Não analisado', withdrawn: 'Retirado' }, executableRealm: { daemon: 'serviço em segundo plano', client: 'aplicação', hostedWeb: 'web alojada' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problema com uma fonte do marketplace', recovery: 'Atualize Descobrir. Se continuar, verifique Fontes e registos.', unreachableTitle: ({ source }: { source: string }) => `Não foi possível contactar ${source}`, behindTitle: ({ source }: { source: string }) => `${source} respondeu com dados antigos ou incompletos`, indexTitle: 'O índice de plugins está incompleto', otherSourcesShown: 'Os resultados das outras fontes continuam visíveis.' } },
    },
    ca: {
        diagnosticsIssueTitle: 'Problema del connector', diagnosticsRecovery: 'Revisa els detalls anteriors i, després de corregir-ho, torna a carregar el connector o aquesta pàgina.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Codi tècnic: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Etiqueta de l’editor: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Categories: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `S’executa a: ${realms} · Plataformes: ${platforms}`, reviewStatus: { curated: 'Recomanació seleccionada', unreviewed: 'Sense revisar', withdrawn: 'Retirat' }, executableRealm: { daemon: 'servei en segon pla', client: 'aplicació', hostedWeb: 'web allotjat' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problema amb una font del mercat', recovery: 'Actualitza Descobreix. Si continua, revisa Fonts i registres.', unreachableTitle: ({ source }: { source: string }) => `No s’ha pogut contactar amb ${source}`, behindTitle: ({ source }: { source: string }) => `${source} ha respost amb dades antigues o incompletes`, indexTitle: 'L’índex de connectors és incomplet', otherSourcesShown: 'Els resultats de les altres fonts es continuen mostrant.' } },
    },
    pl: {
        diagnosticsIssueTitle: 'Problem z wtyczką', diagnosticsRecovery: 'Sprawdź szczegóły powyżej, a po naprawie przeładuj wtyczkę lub tę stronę.', diagnosticsTechnicalCode: ({ code }: { code: string }) => `Kod techniczny: ${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `Etykieta wydawcy: ${displayName} (${id})`, categories: ({ values }: { values: string }) => `Kategorie: ${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `Uruchamia się w: ${realms} · Platformy: ${platforms}`, reviewStatus: { curated: 'Wybrana rekomendacja', unreviewed: 'Bez przeglądu', withdrawn: 'Wycofano' }, executableRealm: { daemon: 'usługa w tle', client: 'aplikacja', hostedWeb: 'hostowana sieć' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'Problem ze źródłem marketplace', recovery: 'Odśwież Odkrywaj. Jeśli problem trwa, sprawdź Źródła i rejestry.', unreachableTitle: ({ source }: { source: string }) => `Nie udało się połączyć z ${source}`, behindTitle: ({ source }: { source: string }) => `${source} zwróciło nieaktualne lub niepełne dane`, indexTitle: 'Indeks wtyczek jest niepełny', otherSourcesShown: 'Wyniki z innych źródeł są nadal widoczne.' } },
    },
    'zh-Hans': {
        diagnosticsIssueTitle: '插件问题', diagnosticsRecovery: '查看上方详情，修正后重新加载插件或刷新此页面。', diagnosticsTechnicalCode: ({ code }: { code: string }) => `技术代码：${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `发布者标签：${displayName}（${id}）`, categories: ({ values }: { values: string }) => `类别：${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `运行位置：${realms} · 平台：${platforms}`, reviewStatus: { curated: '精选推荐', unreviewed: '未经审核', withdrawn: '已撤回' }, executableRealm: { daemon: '后台服务', client: '应用', hostedWeb: '托管网页' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: '网页', ios: 'iOS', android: 'Android' }, diagnostic: { title: '市场来源问题', recovery: '刷新“发现”。如果问题仍然存在，请检查“来源和注册表”。', unreachableTitle: ({ source }: { source: string }) => `无法连接 ${source}`, behindTitle: ({ source }: { source: string }) => `${source} 返回的数据较旧或不完整`, indexTitle: '插件索引不完整', otherSourcesShown: '其他来源的结果仍会显示。' } },
    },
    'zh-Hant': {
        diagnosticsIssueTitle: '外掛問題', diagnosticsRecovery: '查看上方詳情，修正後重新載入外掛或重新整理此頁面。', diagnosticsTechnicalCode: ({ code }: { code: string }) => `技術代碼：${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `發布者標籤：${displayName}（${id}）`, categories: ({ values }: { values: string }) => `類別：${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `執行位置：${realms} · 平台：${platforms}`, reviewStatus: { curated: '精選推薦', unreviewed: '未經審核', withdrawn: '已撤回' }, executableRealm: { daemon: '背景服務', client: '應用程式', hostedWeb: '託管網頁' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: '網頁', ios: 'iOS', android: 'Android' }, diagnostic: { title: '市集來源問題', recovery: '重新整理「探索」。如果問題持續，請檢查「來源與登錄檔」。', unreachableTitle: ({ source }: { source: string }) => `無法連線至 ${source}`, behindTitle: ({ source }: { source: string }) => `${source} 回傳的資料較舊或不完整`, indexTitle: '外掛索引不完整', otherSourcesShown: '其他來源的結果仍會顯示。' } },
    },
    ja: {
        diagnosticsIssueTitle: 'プラグインの問題', diagnosticsRecovery: '上の詳細を確認し、修正後にプラグインまたはこのページを再読み込みしてください。', diagnosticsTechnicalCode: ({ code }: { code: string }) => `技術コード：${code}`,
        discover: { publisherLabel: ({ displayName, id }: { displayName: string; id: string }) => `公開者ラベル：${displayName}（${id}）`, categories: ({ values }: { values: string }) => `カテゴリ：${values}`, runtimeSummary: ({ realms, platforms }: { realms: string; platforms: string }) => `実行場所：${realms} · プラットフォーム：${platforms}`, reviewStatus: { curated: '選定されたおすすめ', unreviewed: '未審査', withdrawn: '取り下げ済み' }, executableRealm: { daemon: 'バックグラウンドサービス', client: 'アプリ', hostedWeb: 'ホストウェブ' }, platform: { darwin: 'macOS', linux: 'Linux', windows: 'Windows', web: 'Web', ios: 'iOS', android: 'Android' }, diagnostic: { title: 'マーケットプレイスの提供元に問題があります', recovery: '「見つける」を更新してください。続く場合は「提供元とレジストリ」を確認してください。', unreachableTitle: ({ source }: { source: string }) => `${source} に接続できませんでした`, behindTitle: ({ source }: { source: string }) => `${source} から古いまたは不完全なデータが返されました`, indexTitle: 'プラグインのインデックスが不完全です', otherSourcesShown: 'ほかのソースの結果は引き続き表示されます。' } },
    },
} as const;

const english = {
    ...marketplacePresentation.en,
    installReviewSections,
    sourceAdministration,
    secretFieldActions,
    ...pluginChangeOutcomeUnknown,
    updateFromInstalledRecordSubtitle: 'Advance this installation through its own trusted update channel.',
    updatePolicy,
    discover: {
        ...marketplacePresentation.en.discover,
        status: {
            loading: 'Searching every marketplace source…',
            loadingSource: ({ source }: { source: string }) => `Searching ${source}…`,
            results: ({ count, sources }: { count: number; sources: number }) =>
                `${count} plugin(s) from ${sources} source(s)`,
            empty: 'No plugins matched this search.',
            error: ({ message }: { message: string }) => `Discover could not be refreshed: ${message}`,
            errorTitle: 'Discover could not be refreshed',
            stale: 'These results answer an earlier search. Search again to apply the controls above.',
            partial: ({ count }: { count: number }) =>
                `${count} source(s) answered with older or missing data, so results may be incomplete.`,
            nonInstallable: ({ count }: { count: number }) =>
                `${count} listing(s) were found but cannot be installed on this machine right now.`,
        },
        sourceFreshness: {
            stale: 'Older than this source',
            'stale-offline': 'Last known results, source offline',
            unavailable: 'Source unavailable',
            'auth-unavailable': 'Sign-in required for this source',
            corrupt: 'Source index could not be read',
        },
        nonInstallableReason: {
            sourceStale: 'Its marketplace source is not current.',
            artifactUnavailable: 'Its package cannot be reached with this machine’s registry access.',
            notApproved: 'It is not approved for install from this source.',
            unsupportedSourceKind: 'Its source kind is not supported by this version of Happier.',
        },
        installSubtitle: ({ source }: { source: string }) =>
            `Review everything this plugin declares before anything from ${source} is trusted.`,
        registrySelectionRequired: ({ origin }: { origin: string }) => `Needs a registry profile for ${origin}`,
        registrySelection: {
            title: ({ name }: { name: string }) => `Choose a registry for ${name}`,
            body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                `${name} is published on ${origin}. Choose the registry profile ${source} uses on this machine, or add one and sign in. Nothing is downloaded until the Install and Trust review.`,
            continue: 'Continue',
        },
    },
} as const;

const localizedTechnicalReviewVocabulary = {
    de: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Lokaler Pfad', archive: 'Archivdatei', npm: 'npm-Paket' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Kuratierter Katalog', 'community-npm': 'Öffentlicher npm-Katalog', user: 'Benutzerkatalog' }, executableRealm: { daemon: 'Code des Hintergrunddiensts', reactNative: 'Code der App-Oberfläche', hostedWeb: 'Isolierter gehosteter Web-Code' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Verifizierte Oberflächenartefakte', none: 'Keine Oberflächenartefakte', unavailable: 'Oberflächenartefakte nicht verfügbar' }, authorizationClass: { cooperativeDisclosure: 'Kooperative Offenlegung', hostResourceSelection: 'Ausgewählte Hostressourcen', presentIntentOrOs: 'Aktuelle Absicht oder Betriebssystemfreigabe' }, priority: ({ priority }: { priority: number }) => `Priorität ${priority}` },
    fr: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind} : ${locator}`, sourceKind: { path: 'Chemin local', archive: 'Fichier d’archive', npm: 'Paquet npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind} : ${source}`, marketplaceSourceKind: { curated: 'Catalogue sélectionné', 'community-npm': 'Catalogue npm public', user: 'Catalogue personnel' }, executableRealm: { daemon: 'Code du service en arrière-plan', reactNative: 'Code de l’interface de l’application', hostedWeb: 'Code web hébergé isolé' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status} : ${ids}`, uiArtifactStatus: { verified: 'Artefacts d’interface vérifiés', none: 'Aucun artefact d’interface', unavailable: 'Artefacts d’interface indisponibles' }, authorizationClass: { cooperativeDisclosure: 'Divulgation coopérative', hostResourceSelection: 'Ressources de l’hôte sélectionnées', presentIntentOrOs: 'Intention actuelle ou autorisation du système' }, priority: ({ priority }: { priority: number }) => `Priorité ${priority}` },
    ru: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Локальный путь', archive: 'Архивный файл', npm: 'Пакет npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Отобранный каталог', 'community-npm': 'Открытый каталог npm', user: 'Пользовательский каталог' }, executableRealm: { daemon: 'Код фоновой службы', reactNative: 'Код интерфейса приложения', hostedWeb: 'Изолированный размещённый веб-код' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Проверенные ресурсы интерфейса', none: 'Нет ресурсов интерфейса', unavailable: 'Ресурсы интерфейса недоступны' }, authorizationClass: { cooperativeDisclosure: 'Совместное раскрытие', hostResourceSelection: 'Выбранные ресурсы хоста', presentIntentOrOs: 'Текущее намерение или разрешение системы' }, priority: ({ priority }: { priority: number }) => `Приоритет ${priority}` },
    es: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Ruta local', archive: 'Archivo comprimido', npm: 'Paquete npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Catálogo seleccionado', 'community-npm': 'Catálogo público de npm', user: 'Catálogo personal' }, executableRealm: { daemon: 'Código del servicio en segundo plano', reactNative: 'Código de la interfaz de la aplicación', hostedWeb: 'Código web alojado aislado' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Recursos de interfaz verificados', none: 'Sin recursos de interfaz', unavailable: 'Recursos de interfaz no disponibles' }, authorizationClass: { cooperativeDisclosure: 'Divulgación cooperativa', hostResourceSelection: 'Recursos del sistema seleccionados', presentIntentOrOs: 'Intención actual o permiso del sistema operativo' }, priority: ({ priority }: { priority: number }) => `Prioridad ${priority}` },
    it: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Percorso locale', archive: 'File di archivio', npm: 'Pacchetto npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Catalogo selezionato', 'community-npm': 'Catalogo npm pubblico', user: 'Catalogo personale' }, executableRealm: { daemon: 'Codice del servizio in background', reactNative: 'Codice dell’interfaccia dell’app', hostedWeb: 'Codice web ospitato isolato' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Risorse dell’interfaccia verificate', none: 'Nessuna risorsa dell’interfaccia', unavailable: 'Risorse dell’interfaccia non disponibili' }, authorizationClass: { cooperativeDisclosure: 'Divulgazione cooperativa', hostResourceSelection: 'Risorse host selezionate', presentIntentOrOs: 'Intento corrente o autorizzazione del sistema' }, priority: ({ priority }: { priority: number }) => `Priorità ${priority}` },
    pt: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Caminho local', archive: 'Ficheiro de arquivo', npm: 'Pacote npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Catálogo selecionado', 'community-npm': 'Catálogo npm público', user: 'Catálogo pessoal' }, executableRealm: { daemon: 'Código do serviço em segundo plano', reactNative: 'Código da interface da aplicação', hostedWeb: 'Código web alojado isolado' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Recursos de interface verificados', none: 'Sem recursos de interface', unavailable: 'Recursos de interface indisponíveis' }, authorizationClass: { cooperativeDisclosure: 'Divulgação cooperativa', hostResourceSelection: 'Recursos do sistema selecionados', presentIntentOrOs: 'Intenção atual ou permissão do sistema' }, priority: ({ priority }: { priority: number }) => `Prioridade ${priority}` },
    ca: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Camí local', archive: 'Fitxer d’arxiu', npm: 'Paquet npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Catàleg seleccionat', 'community-npm': 'Catàleg npm públic', user: 'Catàleg personal' }, executableRealm: { daemon: 'Codi del servei en segon pla', reactNative: 'Codi de la interfície de l’aplicació', hostedWeb: 'Codi web allotjat aïllat' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Recursos d’interfície verificats', none: 'Sense recursos d’interfície', unavailable: 'Recursos d’interfície no disponibles' }, authorizationClass: { cooperativeDisclosure: 'Divulgació cooperativa', hostResourceSelection: 'Recursos del sistema seleccionats', presentIntentOrOs: 'Intenció actual o permís del sistema' }, priority: ({ priority }: { priority: number }) => `Prioritat ${priority}` },
    pl: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}: ${locator}`, sourceKind: { path: 'Ścieżka lokalna', archive: 'Plik archiwum', npm: 'Pakiet npm' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}: ${source}`, marketplaceSourceKind: { curated: 'Wybrany katalog', 'community-npm': 'Publiczny katalog npm', user: 'Katalog użytkownika' }, executableRealm: { daemon: 'Kod usługi w tle', reactNative: 'Kod interfejsu aplikacji', hostedWeb: 'Izolowany hostowany kod internetowy' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}: ${ids}`, uiArtifactStatus: { verified: 'Zweryfikowane zasoby interfejsu', none: 'Brak zasobów interfejsu', unavailable: 'Zasoby interfejsu niedostępne' }, authorizationClass: { cooperativeDisclosure: 'Wspólne ujawnianie', hostResourceSelection: 'Wybrane zasoby hosta', presentIntentOrOs: 'Bieżący zamiar lub uprawnienie systemowe' }, priority: ({ priority }: { priority: number }) => `Priorytet ${priority}` },
    'zh-Hans': { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}：${locator}`, sourceKind: { path: '本地路径', archive: '归档文件', npm: 'npm 软件包' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}：${source}`, marketplaceSourceKind: { curated: '精选目录', 'community-npm': '公共 npm 目录', user: '用户目录' }, executableRealm: { daemon: '后台服务代码', reactNative: '应用界面代码', hostedWeb: '隔离的托管网页代码' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}：${ids}`, uiArtifactStatus: { verified: '已验证界面资源', none: '没有界面资源', unavailable: '界面资源不可用' }, authorizationClass: { cooperativeDisclosure: '协作式披露', hostResourceSelection: '选定的主机资源', presentIntentOrOs: '当前意图或系统权限' }, priority: ({ priority }: { priority: number }) => `优先级 ${priority}` },
    'zh-Hant': { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}：${locator}`, sourceKind: { path: '本機路徑', archive: '封存檔案', npm: 'npm 套件' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}：${source}`, marketplaceSourceKind: { curated: '精選目錄', 'community-npm': '公共 npm 目錄', user: '使用者目錄' }, executableRealm: { daemon: '背景服務程式碼', reactNative: '應用程式介面程式碼', hostedWeb: '隔離的託管網頁程式碼' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}：${ids}`, uiArtifactStatus: { verified: '已驗證介面資源', none: '沒有介面資源', unavailable: '介面資源無法使用' }, authorizationClass: { cooperativeDisclosure: '協作式揭露', hostResourceSelection: '選定的主機資源', presentIntentOrOs: '目前意圖或系統權限' }, priority: ({ priority }: { priority: number }) => `優先順序 ${priority}` },
    ja: { source: ({ kind, locator }: { kind: string; locator: string }) => `${kind}：${locator}`, sourceKind: { path: 'ローカルパス', archive: 'アーカイブファイル', npm: 'npm パッケージ' }, marketplaceSource: ({ kind, source }: { kind: string; source: string }) => `${kind}：${source}`, marketplaceSourceKind: { curated: '選定済みカタログ', 'community-npm': '公開 npm カタログ', user: 'ユーザーカタログ' }, executableRealm: { daemon: 'バックグラウンドサービスのコード', reactNative: 'アプリ画面のコード', hostedWeb: '分離されたホストウェブコード' }, uiArtifacts: ({ status, ids }: { status: string; ids: string }) => `${status}：${ids}`, uiArtifactStatus: { verified: '検証済み画面リソース', none: '画面リソースなし', unavailable: '画面リソースを利用できません' }, authorizationClass: { cooperativeDisclosure: '協調的な開示', hostResourceSelection: '選択したホストリソース', presentIntentOrOs: '現在の意図またはシステム権限' }, priority: ({ priority }: { priority: number }) => `優先度 ${priority}` },
} as const;

const localizedReviewVocabulary = {
    de: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.de,
            archiveUrlRetention: 'Happier speichert die vollständige Archiv-URL einschließlich möglicher Zugangsdaten auf der ausgewählten Maschine für spätere Updates. Abgelaufene oder widerrufene URLs können Updates verhindern.',
            trustedCodeTitle: 'Vertrauenswürdiger Code', trustedCodeDisclosure: 'Plugins laufen als vertrauenswürdiger Code in Happier, nicht in einer Sandbox. Ein Plugin kann die Rechte dieser App direkt nutzen – Dateien, Netzwerk, Umgebung und Prozesse – über die unten aufgeführten, von Happier vermittelten Dienste hinaus. Diese Liste ist das, was das Plugin deklariert hat und was du später abschalten kannst, keine Grenze für das, was sein Code erreichen kann.',
            identity: 'Identität und Paket', evidence: 'Technische Nachweise', executableCode: 'Ausführbarer Code und Beiträge', requiredAccess: 'Erforderlicher Hostzugriff', optionalAccess: 'Optionaler Hostzugriff', requestInterceptors: 'Anfrage-Interceptoren', rawCredentials: 'Deklarationen für direkte Zugangsdaten', compatibility: 'Kompatibilität und Aktualisierungen', none: 'Nichts deklariert',
            scope: ({ scope }: { scope: string }) => `Geltungsbereich: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · Entwicklung`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · nicht verifiziert`,
            integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (erwartet)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (beobachtet)` },
            signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Verifizierte Registry-Signatur: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Nicht unterstützte Registry-Signatur: ${keyId}` },
            provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Deklariert, nicht verifiziert: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Abgerufen, nicht verifiziert: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Herkunftsnachweis nicht verfügbar: ${code}`,
            curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Nicht geprüfte Katalogquelle: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Von ${sourceId} am ${reviewedAt} geprüft${reason}`,
            savedSecret: 'Gespeichertes Geheimnis', connectedAccount: 'Verbundenes Konto', secretKinds: ({ kinds }: { kinds: string }) => `Geheimnisarten: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Dienst: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Zweck: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Verwendung in ${realm} während ${phase}`, credentialAccess: ({ access }: { access: string }) => `Zugriff: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `An ${origin} gesendete Header: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Umgebungsvariablen: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Dateien: ${files}`,
            realm: { web: 'Webbereich', ios: 'iOS-App', android: 'Android-App', daemon: 'Hintergrunddienst' }, phase: { settings: 'der Einrichtung', prepare: 'der Vorbereitung', connection: 'der Verbindung', speech: 'der Sprachnutzung' }, runtimeApi: ({ version }: { version: number }) => `Laufzeit-API ${version}`,
        },
        sourceAdministration: {
            title: 'Quellen und Registries', subtitle: 'Lege fest, wo dieser Rechner genaue npm-Pakete findet und wie er ihre Registries erreicht.', communityTitle: 'Öffentliches npm-Verzeichnis', communitySubtitle: 'Integriert · ungeprüfte Suche nach geeigneten Happier-Plugins auf öffentlichem npm, nicht nach beliebigen npm-Paketen.', configuredTitle: 'Marktplatzquellen', configuredEmpty: 'Keine zusätzlichen Marktplatzquellen konfiguriert.', add: 'Quelle hinzufügen', edit: 'Quelle bearbeiten', remove: 'Quelle entfernen', removeTitle: 'Marktplatzquelle entfernen?', removeBody: ({ name }: { name: string }) => `${name} wird auf diesem Rechner nicht mehr zur Suche verwendet. Installierte Plugins bleiben unverändert.`, sourceUrl: 'Quelladresse', displayName: 'Anzeigename', description: 'Beschreibung (optional)', enabled: 'Aktiviert', disabled: 'Deaktiviert', curated: 'Kuratierte Quelle', user: 'Eigene Quelle', loadError: 'Marktplatzquellen konnten nicht geladen werden.', retry: 'Erneut versuchen', operationFailed: 'Diese Änderung konnte nicht angewendet werden. Prüfe die Rechnerverbindung und versuche es erneut.', operationOutcomeUnknownTitle: 'Änderung muss geprüft werden', operationOutcomeUnknownBody: 'Der ausgewählte Rechner hat diese Änderung möglicherweise bereits angewendet, Happier konnte das Ergebnis aber nicht bestätigen. Prüfe die aktualisierten Einstellungen, bevor du sie erneut änderst.',
        },
        updatePolicy: {
            title: 'Aktualisierungsrichtlinie', target: ({ machine, server }: { machine: string; server: string }) => `Gilt auf ${machine} über ${server}.`, pinned: 'Fest angeheftet', pinnedSubtitle: 'Nicht aktualisieren, bis eine andere Richtlinie gewählt wird.', allowed: 'Aktualisierungen erlaubt', allowedSubtitle: 'Explizite Aktualisierungen werden ohne weitere Nachfrage ausgeführt, solange sich die deklarierte Berechtigung nicht erweitert.',
        },
    },
    fr: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.fr,
            archiveUrlRetention: 'Happier conserve l’URL complète de l’archive sur la machine sélectionnée, y compris les éventuels identifiants, pour les futures mises à jour. Une URL expirée ou révoquée peut faire échouer une mise à jour.',
            trustedCodeTitle: 'Code de confiance', trustedCodeDisclosure: 'Les plugins s’exécutent comme du code de confiance dans Happier, pas dans un bac à sable. Un plugin peut utiliser directement les droits de cette application — fichiers, réseau, environnement et processus — au-delà des services médiatisés par Happier listés ci-dessous. Cette liste est ce que le plugin a déclaré et ce que tu peux désactiver ensuite, pas une limite de ce que son code peut atteindre.', identity: 'Identité et paquet', evidence: 'Éléments techniques', executableCode: 'Code exécutable et contributions', requiredAccess: 'Accès requis à l’hôte', optionalAccess: 'Accès facultatif à l’hôte', requestInterceptors: 'Intercepteurs de requêtes', rawCredentials: 'Déclarations d’accès direct aux identifiants', compatibility: 'Compatibilité et mises à jour', none: 'Aucune déclaration', scope: ({ scope }: { scope: string }) => `Portée : ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · développement`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · non vérifié`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (attendue)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (observée)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Signature du registre vérifiée : ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Signature du registre non prise en charge : ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Déclarée, non vérifiée : ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Récupérée, non vérifiée : ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Provenance indisponible : ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Source de catalogue non examinée : ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Examinée par ${sourceId} le ${reviewedAt}${reason}`, savedSecret: 'Secret enregistré', connectedAccount: 'Compte connecté', secretKinds: ({ kinds }: { kinds: string }) => `Types de secrets : ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Service associé : ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Finalité : ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Utilisé dans ${realm} pendant ${phase}`, credentialAccess: ({ access }: { access: string }) => `Accès accordé : ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `En-têtes envoyés à ${origin} : ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Variables d’environnement : ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Fichiers : ${files}`, realm: { web: 'le navigateur', ios: 'l’application iOS', android: 'l’application Android', daemon: 'le service en arrière-plan' }, phase: { settings: 'la configuration', prepare: 'la préparation', connection: 'la connexion', speech: 'l’utilisation vocale' }, runtimeApi: ({ version }: { version: number }) => `API d’exécution ${version}`,
        },
        sourceAdministration: { title: 'Sources et registres', subtitle: 'Choisissez où cette machine découvre les paquets npm exacts et comment elle accède à leurs registres.', communityTitle: 'Répertoire npm public', communitySubtitle: 'Intégré · découverte non examinée de plugins Happier admissibles sur npm public, pas de paquets npm quelconques.', configuredTitle: 'Sources de la place de marché', configuredEmpty: 'Aucune source supplémentaire configurée.', add: 'Ajouter une source', edit: 'Modifier la source', remove: 'Supprimer la source', removeTitle: 'Supprimer cette source ?', removeBody: ({ name }: { name: string }) => `${name} ne servira plus à la découverte sur cette machine. Les plugins installés ne changent pas.`, sourceUrl: 'Adresse de la source', displayName: 'Nom affiché', description: 'Description facultative', enabled: 'Activée', disabled: 'Désactivée', curated: 'Source sélectionnée', user: 'Votre source', loadError: 'Impossible de charger les sources de la place de marché.', retry: 'Réessayer', operationFailed: 'Impossible d’appliquer cette modification. Vérifiez la connexion à la machine et réessayez.', operationOutcomeUnknownTitle: 'Changement à examiner', operationOutcomeUnknownBody: 'La machine sélectionnée a peut-être déjà appliqué ce changement, mais Happier n’a pas pu confirmer le résultat. Vérifiez les réglages actualisés avant de les modifier à nouveau.' },
        updatePolicy: { title: 'Règle de mise à jour', target: ({ machine, server }: { machine: string; server: string }) => `S’applique sur ${machine} via ${server}.`, pinned: 'Version épinglée', pinnedSubtitle: 'Ne pas mettre à jour avant le choix d’une autre règle.', allowed: 'Mises à jour autorisées', allowedSubtitle: 'Les mises à jour explicites continuent sans nouvelle demande sauf si les autorisations déclarées augmentent.' },
    },
    ru: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.ru,
            archiveUrlRetention: 'Happier сохраняет полный URL архива на выбранной машине, включая возможные учётные данные, для будущих обновлений. Истёкший или отозванный URL может привести к сбою обновления.',
            trustedCodeTitle: 'Доверенный код', trustedCodeDisclosure: 'Плагины выполняются как доверенный код внутри Happier, а не в песочнице. Плагин может напрямую использовать полномочия самого приложения — файлы, сеть, окружение и процессы — за пределами перечисленных ниже служб, посредником в которых выступает Happier. Этот список — то, что плагин заявил и что вы сможете отключить позже, а не граница того, куда может дотянуться его код.', identity: 'Идентификатор и пакет', evidence: 'Технические сведения', executableCode: 'Исполняемый код и расширения', requiredAccess: 'Обязательный доступ к хосту', optionalAccess: 'Необязательный доступ к хосту', requestInterceptors: 'Перехватчики запросов', rawCredentials: 'Декларации прямого доступа к учетным данным', compatibility: 'Совместимость и обновления', none: 'Ничего не заявлено', scope: ({ scope }: { scope: string }) => `Область: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · разработка`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · не проверено`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (ожидаемая)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (наблюдаемая)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Подпись реестра проверена: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Неподдерживаемая подпись реестра: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Заявлено без проверки: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Получено без проверки: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Сведения о происхождении недоступны: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Непроверенный источник каталога: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Проверено ${sourceId}, ${reviewedAt}${reason}`, savedSecret: 'Сохраненный секрет', connectedAccount: 'Подключенная учетная запись', secretKinds: ({ kinds }: { kinds: string }) => `Типы секретов: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Служба: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Назначение: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Использование: ${realm}, этап «${phase}»`, credentialAccess: ({ access }: { access: string }) => `Доступ: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Заголовки, отправляемые на ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Переменные среды: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Файлы: ${files}`, realm: { web: 'веб-клиент', ios: 'приложение iOS', android: 'приложение Android', daemon: 'фоновая служба' }, phase: { settings: 'настройка', prepare: 'подготовка', connection: 'подключение', speech: 'голосовой режим' }, runtimeApi: ({ version }: { version: number }) => `API среды выполнения ${version}`,
        },
        sourceAdministration: { title: 'Источники и реестры', subtitle: 'Выберите, где эта машина ищет точные пакеты npm и как подключается к их реестрам.', communityTitle: 'Открытый каталог npm', communitySubtitle: 'Встроенный поиск подходящих плагинов Happier в публичном npm, а не произвольных пакетов. Результаты не проверены.', configuredTitle: 'Источники маркетплейса', configuredEmpty: 'Дополнительные источники маркетплейса не настроены.', add: 'Добавить источник', edit: 'Изменить источник', remove: 'Удалить источник', removeTitle: 'Удалить источник маркетплейса?', removeBody: ({ name }: { name: string }) => `${name} больше не будет использоваться для поиска на этой машине. Установленные плагины не изменятся.`, sourceUrl: 'Адрес источника', displayName: 'Отображаемое имя', description: 'Описание (необязательно)', enabled: 'Включен', disabled: 'Отключен', curated: 'Отобранный источник', user: 'Ваш источник', loadError: 'Не удалось загрузить источники маркетплейса.', retry: 'Повторить', operationFailed: 'Не удалось применить изменение. Проверьте подключение к машине и повторите попытку.', operationOutcomeUnknownTitle: 'Изменение требует проверки', operationOutcomeUnknownBody: 'Выбранная машина могла уже применить это изменение, но Happier не удалось подтвердить результат. Проверьте обновленные настройки, прежде чем менять их снова.' },
        updatePolicy: { title: 'Правило обновлений', target: ({ machine, server }: { machine: string; server: string }) => `Действует на ${machine} через ${server}.`, pinned: 'Закрепленная версия', pinnedSubtitle: 'Не обновлять, пока не выбрано другое правило.', allowed: 'Обновления разрешены', allowedSubtitle: 'Явные обновления выполняются без нового запроса, пока заявленные полномочия не расширяются.' },
    },
    es: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.es,
            archiveUrlRetention: 'Happier guarda la URL completa del archivo en la máquina seleccionada, incluidas las credenciales que contenga, para futuras actualizaciones. Las URL caducadas o revocadas pueden hacer que las actualizaciones fallen.',
            trustedCodeTitle: 'Código de confianza', trustedCodeDisclosure: 'Los plugins se ejecutan como código de confianza dentro de Happier, no en un entorno aislado. Un plugin puede usar directamente los permisos de esta aplicación —archivos, red, entorno y procesos— más allá de los servicios mediados por Happier que aparecen abajo. Esa lista es lo que el plugin declaró y lo que podrás desactivar después, no un límite de lo que su código puede alcanzar.', identity: 'Identidad y paquete', evidence: 'Detalles técnicos', executableCode: 'Código ejecutable y contribuciones', requiredAccess: 'Acceso obligatorio al sistema', optionalAccess: 'Acceso opcional al sistema', requestInterceptors: 'Interceptores de solicitudes', rawCredentials: 'Declaraciones de acceso directo a credenciales', compatibility: 'Compatibilidad y actualizaciones', none: 'No se declaró nada', scope: ({ scope }: { scope: string }) => `Ámbito: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · desarrollo`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · sin verificar`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (esperada)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (observada)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Firma del registro verificada: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Firma del registro no compatible: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Declarada sin verificar: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Obtenida sin verificar: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Procedencia no disponible: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Fuente de catálogo sin revisar: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Revisada por ${sourceId} el ${reviewedAt}${reason}`, savedSecret: 'Secreto guardado', connectedAccount: 'Cuenta conectada', secretKinds: ({ kinds }: { kinds: string }) => `Tipos de secreto: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Servicio: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Finalidad: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Se usa en ${realm} durante ${phase}`, credentialAccess: ({ access }: { access: string }) => `Acceso: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Encabezados enviados a ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Variables de entorno: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Archivos: ${files}`, realm: { web: 'el navegador', ios: 'la aplicación para iOS', android: 'la aplicación para Android', daemon: 'el servicio en segundo plano' }, phase: { settings: 'la configuración', prepare: 'la preparación', connection: 'la conexión', speech: 'el uso de voz' }, runtimeApi: ({ version }: { version: number }) => `API de ejecución ${version}`,
        },
        sourceAdministration: { title: 'Fuentes y registros', subtitle: 'Elige dónde descubre esta máquina los paquetes npm exactos y cómo accede a sus registros.', communityTitle: 'Directorio público de npm', communitySubtitle: 'Integrado · búsqueda sin revisar de plugins de Happier aptos en npm público, no de cualquier paquete npm.', configuredTitle: 'Fuentes del marketplace', configuredEmpty: 'No hay fuentes adicionales configuradas.', add: 'Añadir fuente', edit: 'Editar fuente', remove: 'Eliminar fuente', removeTitle: '¿Eliminar la fuente del marketplace?', removeBody: ({ name }: { name: string }) => `${name} dejará de usarse para buscar en esta máquina. Los plugins instalados no cambian.`, sourceUrl: 'Dirección de la fuente', displayName: 'Nombre visible', description: 'Descripción opcional', enabled: 'Activada', disabled: 'Desactivada', curated: 'Fuente seleccionada', user: 'Tu fuente', loadError: 'No se pudieron cargar las fuentes del marketplace.', retry: 'Reintentar', operationFailed: 'No se pudo aplicar el cambio. Comprueba la conexión con la máquina e inténtalo de nuevo.', operationOutcomeUnknownTitle: 'Cambio pendiente de revisión', operationOutcomeUnknownBody: 'Es posible que la máquina seleccionada ya haya aplicado este cambio, pero Happier no pudo confirmar el resultado. Revisa los ajustes actualizados antes de cambiarlos de nuevo.' },
        updatePolicy: { title: 'Regla de actualización', target: ({ machine, server }: { machine: string; server: string }) => `Se aplica en ${machine} mediante ${server}.`, pinned: 'Versión fijada', pinnedSubtitle: 'No actualizar hasta que elijas otra regla.', allowed: 'Actualizaciones permitidas', allowedSubtitle: 'Las actualizaciones explícitas continúan sin otra confirmación salvo que aumenten los permisos declarados.' },
    },
    it: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.it,
            archiveUrlRetention: 'Happier salva l’URL completo dell’archivio sulla macchina selezionata, incluse eventuali credenziali, per gli aggiornamenti futuri. Gli URL scaduti o revocati possono far fallire gli aggiornamenti.',
            trustedCodeTitle: 'Codice attendibile', trustedCodeDisclosure: 'I plugin vengono eseguiti come codice attendibile dentro Happier, non in una sandbox. Un plugin può usare direttamente i permessi di questa app — file, rete, ambiente e processi — oltre ai servizi mediati da Happier elencati qui sotto. Quell’elenco è ciò che il plugin ha dichiarato e ciò che potrai disattivare in seguito, non un limite a ciò che il suo codice può raggiungere.', identity: 'Identità e pacchetto', evidence: 'Dettagli tecnici', executableCode: 'Codice eseguibile e contributi', requiredAccess: 'Accesso obbligatorio all’host', optionalAccess: 'Accesso facoltativo all’host', requestInterceptors: 'Intercettori delle richieste', rawCredentials: 'Dichiarazioni di accesso diretto alle credenziali', compatibility: 'Compatibilità e aggiornamenti', none: 'Nessuna dichiarazione', scope: ({ scope }: { scope: string }) => `Ambito: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · sviluppo`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · non verificato`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (prevista)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (osservata)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Firma del registro verificata: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Firma del registro non supportata: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Dichiarata, non verificata: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Recuperata, non verificata: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Provenienza non disponibile: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Fonte del catalogo non esaminata: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Esaminata da ${sourceId} il ${reviewedAt}${reason}`, savedSecret: 'Segreto salvato', connectedAccount: 'Account collegato', secretKinds: ({ kinds }: { kinds: string }) => `Tipi di segreto: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Servizio: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Scopo: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Usato in ${realm} durante ${phase}`, credentialAccess: ({ access }: { access: string }) => `Accesso: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Header inviati a ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Variabili d’ambiente: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `File: ${files}`, realm: { web: 'il browser', ios: 'l’app iOS', android: 'l’app Android', daemon: 'il servizio in background' }, phase: { settings: 'la configurazione', prepare: 'la preparazione', connection: 'la connessione', speech: 'l’uso vocale' }, runtimeApi: ({ version }: { version: number }) => `API di esecuzione ${version}`,
        },
        sourceAdministration: { title: 'Fonti e registri', subtitle: 'Scegli dove questa macchina trova i pacchetti npm esatti e come raggiunge i relativi registri.', communityTitle: 'Elenco npm pubblico', communitySubtitle: 'Integrato · ricerca non verificata di plugin Happier idonei su npm pubblico, non di pacchetti npm generici.', configuredTitle: 'Fonti del marketplace', configuredEmpty: 'Nessuna fonte aggiuntiva configurata.', add: 'Aggiungi fonte', edit: 'Modifica fonte', remove: 'Rimuovi fonte', removeTitle: 'Rimuovere la fonte del marketplace?', removeBody: ({ name }: { name: string }) => `${name} non verrà più usata per la ricerca su questa macchina. I plugin installati non cambiano.`, sourceUrl: 'Indirizzo della fonte', displayName: 'Nome visualizzato', description: 'Descrizione facoltativa', enabled: 'Attivata', disabled: 'Disattivata', curated: 'Fonte selezionata', user: 'La tua fonte', loadError: 'Impossibile caricare le fonti del marketplace.', retry: 'Riprova', operationFailed: 'Impossibile applicare la modifica. Controlla la connessione alla macchina e riprova.', operationOutcomeUnknownTitle: 'Modifica da verificare', operationOutcomeUnknownBody: 'La macchina selezionata potrebbe avere già applicato questa modifica, ma Happier non ha potuto confermare il risultato. Controlla le impostazioni aggiornate prima di modificarle di nuovo.' },
        updatePolicy: { title: 'Regola di aggiornamento', target: ({ machine, server }: { machine: string; server: string }) => `Si applica su ${machine} tramite ${server}.`, pinned: 'Versione bloccata', pinnedSubtitle: 'Non aggiornare finché non scegli un’altra regola.', allowed: 'Aggiornamenti consentiti', allowedSubtitle: 'Gli aggiornamenti espliciti procedono senza un’altra conferma, salvo un aumento delle autorizzazioni dichiarate.' },
    },
    pt: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.pt,
            archiveUrlRetention: 'O Happier salva a URL completa do arquivo na máquina selecionada, incluindo eventuais credenciais, para futuras atualizações. URLs expiradas ou revogadas podem impedir as atualizações.',
            trustedCodeTitle: 'Código confiável', trustedCodeDisclosure: 'Os plugins são executados como código confiável dentro do Happier, não numa sandbox. Um plugin pode usar diretamente as permissões desta aplicação — ficheiros, rede, ambiente e processos — para além dos serviços mediados pelo Happier listados abaixo. Essa lista é o que o plugin declarou e o que poderás desativar mais tarde, não um limite ao que o seu código consegue alcançar.', identity: 'Identidade e pacote', evidence: 'Dados técnicos', executableCode: 'Código executável e contribuições', requiredAccess: 'Acesso obrigatório ao sistema', optionalAccess: 'Acesso opcional ao sistema', requestInterceptors: 'Intercetores de pedidos', rawCredentials: 'Declarações de acesso direto a credenciais', compatibility: 'Compatibilidade e atualizações', none: 'Nada declarado', scope: ({ scope }: { scope: string }) => `Âmbito: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · desenvolvimento`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · não verificado`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (esperada)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (observada)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Assinatura do registo verificada: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Assinatura do registo não suportada: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Declarada, não verificada: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Obtida, não verificada: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Proveniência indisponível: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Origem de catálogo não analisada: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Analisada por ${sourceId} em ${reviewedAt}${reason}`, savedSecret: 'Segredo guardado', connectedAccount: 'Conta ligada', secretKinds: ({ kinds }: { kinds: string }) => `Tipos de segredo: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Serviço: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Finalidade: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Usado em ${realm} durante ${phase}`, credentialAccess: ({ access }: { access: string }) => `Acesso: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Cabeçalhos enviados para ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Variáveis de ambiente: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Ficheiros: ${files}`, realm: { web: 'o navegador', ios: 'a aplicação iOS', android: 'a aplicação Android', daemon: 'o serviço em segundo plano' }, phase: { settings: 'a configuração', prepare: 'a preparação', connection: 'a ligação', speech: 'o uso de voz' }, runtimeApi: ({ version }: { version: number }) => `API de execução ${version}`,
        },
        sourceAdministration: { title: 'Origens e registos', subtitle: 'Escolha onde esta máquina encontra os pacotes npm exatos e como acede aos respetivos registos.', communityTitle: 'Diretório npm público', communitySubtitle: 'Integrado · pesquisa não analisada de plugins Happier elegíveis no npm público, não de quaisquer pacotes npm.', configuredTitle: 'Origens do marketplace', configuredEmpty: 'Não há origens adicionais configuradas.', add: 'Adicionar origem', edit: 'Editar origem', remove: 'Remover origem', removeTitle: 'Remover a origem do marketplace?', removeBody: ({ name }: { name: string }) => `${name} deixará de ser usada para pesquisa nesta máquina. Os plugins instalados não serão alterados.`, sourceUrl: 'Endereço da origem', displayName: 'Nome apresentado', description: 'Descrição opcional', enabled: 'Ativada', disabled: 'Desativada', curated: 'Origem selecionada', user: 'A sua origem', loadError: 'Não foi possível carregar as origens do marketplace.', retry: 'Tentar novamente', operationFailed: 'Não foi possível aplicar a alteração. Verifique a ligação à máquina e tente novamente.', operationOutcomeUnknownTitle: 'Alteração pendente de análise', operationOutcomeUnknownBody: 'A máquina selecionada pode já ter aplicado esta alteração, mas o Happier não conseguiu confirmar o resultado. Reveja as definições atualizadas antes de as alterar novamente.' },
        updatePolicy: { title: 'Regra de atualização', target: ({ machine, server }: { machine: string; server: string }) => `Aplica-se em ${machine} através de ${server}.`, pinned: 'Versão fixada', pinnedSubtitle: 'Não atualizar até escolher outra regra.', allowed: 'Atualizações permitidas', allowedSubtitle: 'As atualizações explícitas avançam sem nova confirmação, exceto se as permissões declaradas aumentarem.' },
    },
    ca: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.ca,
            archiveUrlRetention: 'Happier desa l’URL complet de l’arxiu a la màquina seleccionada, incloses les credencials que contingui, per a futures actualitzacions. Els URL caducats o revocats poden fer que les actualitzacions fallin.',
            trustedCodeTitle: 'Codi de confiança', trustedCodeDisclosure: 'Els plugins s’executen com a codi de confiança dins de Happier, no en un entorn aïllat. Un plugin pot fer servir directament els permisos d’aquesta aplicació —fitxers, xarxa, entorn i processos— més enllà dels serveis intermediats per Happier que es mostren a sota. Aquesta llista és el que el plugin ha declarat i el que podràs desactivar més endavant, no un límit del que el seu codi pot arribar a fer.', identity: 'Identitat i paquet', evidence: 'Detalls tècnics', executableCode: 'Codi executable i contribucions', requiredAccess: 'Accés obligatori al sistema', optionalAccess: 'Accés opcional al sistema', requestInterceptors: 'Interceptors de sol·licituds', rawCredentials: 'Declaracions d’accés directe a credencials', compatibility: 'Compatibilitat i actualitzacions', none: 'No s’ha declarat res', scope: ({ scope }: { scope: string }) => `Àmbit: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · desenvolupament`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · sense verificar`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (esperada)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (observada)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Signatura del registre verificada: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Signatura del registre no compatible: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Declarada sense verificar: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Obtinguda sense verificar: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Procedència no disponible: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Origen de catàleg sense revisar: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Revisada per ${sourceId} el ${reviewedAt}${reason}`, savedSecret: 'Secret desat', connectedAccount: 'Compte connectat', secretKinds: ({ kinds }: { kinds: string }) => `Tipus de secret: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Servei: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Finalitat: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `S’utilitza a ${realm} durant ${phase}`, credentialAccess: ({ access }: { access: string }) => `Accés: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Capçaleres enviades a ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Variables d’entorn: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Fitxers: ${files}`, realm: { web: 'el navegador', ios: 'l’aplicació per a iOS', android: 'l’aplicació per a Android', daemon: 'el servei en segon pla' }, phase: { settings: 'la configuració', prepare: 'la preparació', connection: 'la connexió', speech: 'l’ús de veu' }, runtimeApi: ({ version }: { version: number }) => `API d’execució ${version}`,
        },
        sourceAdministration: { title: 'Orígens i registres', subtitle: 'Tria on descobreix aquesta màquina els paquets npm exactes i com accedeix als seus registres.', communityTitle: 'Directori npm públic', communitySubtitle: 'Integrat · cerca sense revisar de connectors Happier aptes a npm públic, no de qualsevol paquet npm.', configuredTitle: 'Orígens del marketplace', configuredEmpty: 'No hi ha orígens addicionals configurats.', add: 'Afegeix un origen', edit: 'Edita l’origen', remove: 'Elimina l’origen', removeTitle: 'Vols eliminar l’origen del marketplace?', removeBody: ({ name }: { name: string }) => `${name} deixarà d’utilitzar-se per cercar en aquesta màquina. Els connectors instal·lats no canviaran.`, sourceUrl: 'Adreça de l’origen', displayName: 'Nom visible', description: 'Descripció opcional', enabled: 'Activat', disabled: 'Desactivat', curated: 'Origen seleccionat', user: 'El teu origen', loadError: 'No s’han pogut carregar els orígens del marketplace.', retry: 'Torna-ho a provar', operationFailed: 'No s’ha pogut aplicar el canvi. Comprova la connexió amb la màquina i torna-ho a provar.', operationOutcomeUnknownTitle: 'Canvi pendent de revisió', operationOutcomeUnknownBody: 'És possible que la màquina seleccionada ja hagi aplicat aquest canvi, però el Happier no ha pogut confirmar el resultat. Revisa la configuració actualitzada abans de tornar-la a canviar.' },
        updatePolicy: { title: 'Regla d’actualització', target: ({ machine, server }: { machine: string; server: string }) => `S’aplica a ${machine} mitjançant ${server}.`, pinned: 'Versió fixada', pinnedSubtitle: 'No actualitzis fins que triïs una altra regla.', allowed: 'Actualitzacions permeses', allowedSubtitle: 'Les actualitzacions explícites continuen sense una altra confirmació, tret que augmentin els permisos declarats.' },
    },
    pl: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.pl,
            archiveUrlRetention: 'Happier zapisuje pełny adres URL archiwum na wybranej maszynie, wraz z ewentualnymi danymi uwierzytelniającymi, na potrzeby przyszłych aktualizacji. Wygasły lub unieważniony adres URL może uniemożliwić aktualizację.',
            trustedCodeTitle: 'Zaufany kod', trustedCodeDisclosure: 'Wtyczki działają jako zaufany kod wewnątrz Happier, a nie w piaskownicy. Wtyczka może bezpośrednio korzystać z uprawnień samej aplikacji — plików, sieci, środowiska i procesów — poza wymienionymi poniżej usługami pośredniczonymi przez Happier. Ta lista to, co wtyczka zadeklarowała i co możesz później wyłączyć, a nie granica tego, co jej kod może osiągnąć.', identity: 'Tożsamość i pakiet', evidence: 'Dane techniczne', executableCode: 'Kod wykonywalny i rozszerzenia', requiredAccess: 'Wymagany dostęp do hosta', optionalAccess: 'Opcjonalny dostęp do hosta', requestInterceptors: 'Interceptory żądań', rawCredentials: 'Deklaracje bezpośredniego dostępu do danych logowania', compatibility: 'Zgodność i aktualizacje', none: 'Nic nie zadeklarowano', scope: ({ scope }: { scope: string }) => `Zakres: ${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · rozwój`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · niezweryfikowany`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity} (oczekiwana)`, observed: ({ integrity }: { integrity: string }) => `${integrity} (zaobserwowana)` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `Zweryfikowany podpis rejestru: ${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `Nieobsługiwany podpis rejestru: ${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `Zadeklarowane bez weryfikacji: ${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `Pobrane bez weryfikacji: ${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `Pochodzenie niedostępne: ${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `Niesprawdzone źródło katalogu: ${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `Sprawdzone przez ${sourceId} dnia ${reviewedAt}${reason}`, savedSecret: 'Zapisany sekret', connectedAccount: 'Połączone konto', secretKinds: ({ kinds }: { kinds: string }) => `Rodzaje sekretów: ${kinds}`, connectedAccountService: ({ service }: { service: string }) => `Usługa: ${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `Cel: ${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `Używane w ${realm} podczas etapu „${phase}”`, credentialAccess: ({ access }: { access: string }) => `Dostęp: ${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `Nagłówki wysyłane do ${origin}: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `Zmienne środowiskowe: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `Pliki: ${files}`, realm: { web: 'kliencie internetowym', ios: 'aplikacji iOS', android: 'aplikacji Android', daemon: 'usłudze w tle' }, phase: { settings: 'konfiguracja', prepare: 'przygotowanie', connection: 'połączenie', speech: 'obsługa głosu' }, runtimeApi: ({ version }: { version: number }) => `API środowiska wykonawczego ${version}`,
        },
        sourceAdministration: { title: 'Źródła i rejestry', subtitle: 'Wybierz, gdzie ta maszyna znajduje dokładne pakiety npm i jak dociera do ich rejestrów.', communityTitle: 'Publiczny katalog npm', communitySubtitle: 'Wbudowane · niesprawdzone wyszukiwanie odpowiednich wtyczek Happier w publicznym npm, a nie dowolnych pakietów npm.', configuredTitle: 'Źródła marketplace', configuredEmpty: 'Nie skonfigurowano dodatkowych źródeł.', add: 'Dodaj źródło', edit: 'Edytuj źródło', remove: 'Usuń źródło', removeTitle: 'Usunąć źródło marketplace?', removeBody: ({ name }: { name: string }) => `${name} nie będzie już używane do wyszukiwania na tej maszynie. Zainstalowane wtyczki pozostaną bez zmian.`, sourceUrl: 'Adres źródła', displayName: 'Nazwa wyświetlana', description: 'Opis opcjonalny', enabled: 'Włączone', disabled: 'Wyłączone', curated: 'Wybrane źródło', user: 'Twoje źródło', loadError: 'Nie udało się wczytać źródeł marketplace.', retry: 'Spróbuj ponownie', operationFailed: 'Nie udało się zastosować zmiany. Sprawdź połączenie z maszyną i spróbuj ponownie.', operationOutcomeUnknownTitle: 'Zmiana wymaga sprawdzenia', operationOutcomeUnknownBody: 'Wybrana maszyna mogła już zastosować tę zmianę, ale Happier nie mógł potwierdzić wyniku. Sprawdź odświeżone ustawienia, zanim zmienisz je ponownie.' },
        updatePolicy: { title: 'Reguła aktualizacji', target: ({ machine, server }: { machine: string; server: string }) => `Obowiązuje na ${machine} przez ${server}.`, pinned: 'Przypięta wersja', pinnedSubtitle: 'Nie aktualizuj, dopóki nie wybierzesz innej reguły.', allowed: 'Aktualizacje dozwolone', allowedSubtitle: 'Jawne aktualizacje są wykonywane bez kolejnego potwierdzenia, dopóki deklarowane uprawnienia się nie rozszerzą.' },
    },
    'zh-Hans': {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary['zh-Hans'],
            archiveUrlRetention: 'Happier 会将完整的归档 URL（包括其中的凭据）保存在所选机器上，用于今后的更新。URL 过期或被撤销可能导致更新失败。',
            trustedCodeTitle: '受信任的代码', trustedCodeDisclosure: '插件以受信任代码的形式在 Happier 内运行，并不在沙箱中。除了下方列出的由 Happier 中转的服务外，插件还可以直接使用本应用自身的权限——文件、网络、环境和进程。下方的列表是插件声明的内容，也是你之后可以关闭的内容，而不是限制其代码可触及范围的边界。', identity: '身份与软件包', evidence: '技术证据', executableCode: '可执行代码与扩展项', requiredAccess: '必需的主机访问权限', optionalAccess: '可选的主机访问权限', requestInterceptors: '请求拦截器', rawCredentials: '原始凭据访问声明', compatibility: '兼容性与更新', none: '未声明任何内容', scope: ({ scope }: { scope: string }) => `范围：${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · 开发版本`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · 未验证`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity}（预期值）`, observed: ({ integrity }: { integrity: string }) => `${integrity}（观测值）` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `已验证注册表签名：${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `不支持的注册表签名：${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `已声明但未验证：${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `已获取但未验证：${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `来源证明不可用：${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `未经审阅的目录来源：${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `由 ${sourceId} 于 ${reviewedAt} 审阅${reason}`, savedSecret: '已保存的密钥', connectedAccount: '已连接的账户', secretKinds: ({ kinds }: { kinds: string }) => `密钥类型：${kinds}`, connectedAccountService: ({ service }: { service: string }) => `服务：${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `用途：${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `在${realm}的${phase}阶段使用`, credentialAccess: ({ access }: { access: string }) => `访问内容：${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `发送到 ${origin} 的请求头：${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `环境变量：${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `文件：${files}`, realm: { web: '网页端', ios: 'iOS 客户端', android: 'Android 客户端', daemon: '后台服务' }, phase: { settings: '设置', prepare: '准备', connection: '连接', speech: '语音' }, runtimeApi: ({ version }: { version: number }) => `运行时接口 ${version}`,
        },
        sourceAdministration: { title: '来源与注册表', subtitle: '选择这台机器从何处发现准确的 npm 软件包，以及如何访问相应注册表。', communityTitle: '公共 npm 目录', communitySubtitle: '内置 · 在公共 npm 中发现符合条件的 Happier 插件，而非任意 npm 软件包；结果未经审阅。', configuredTitle: '市场来源', configuredEmpty: '未配置其他市场来源。', add: '添加来源', edit: '编辑来源', remove: '移除来源', removeTitle: '要移除市场来源吗？', removeBody: ({ name }: { name: string }) => `${name} 将不再用于这台机器上的发现。已安装的插件不会改变。`, sourceUrl: '来源地址', displayName: '显示名称', description: '可选说明', enabled: '已启用', disabled: '已停用', curated: '精选来源', user: '你的来源', loadError: '无法加载市场来源。', retry: '重试', operationFailed: '无法应用此更改。请检查机器连接后重试。', operationOutcomeUnknownTitle: '更改需要审阅', operationOutcomeUnknownBody: '所选机器可能已应用此更改，但 Happier 无法确认结果。请先查看刷新后的设置，再重新更改。' },
        updatePolicy: { title: '更新规则', target: ({ machine, server }: { machine: string; server: string }) => `通过 ${server} 应用于 ${machine}。`, pinned: '固定版本', pinnedSubtitle: '在选择其他规则前不更新。', allowed: '允许更新', allowedSubtitle: '明确更新无需再次确认，除非声明的权限扩大。' },
    },
    'zh-Hant': {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary['zh-Hant'],
            archiveUrlRetention: 'Happier 會將完整的封存檔 URL（包括其中的憑證）儲存在所選機器上，用於日後更新。URL 過期或遭撤銷可能導致更新失敗。',
            trustedCodeTitle: '受信任的程式碼', trustedCodeDisclosure: '外掛會以受信任程式碼的形式在 Happier 內執行，並不在沙箱中。除了下方列出的由 Happier 中介的服務之外，外掛還可以直接使用本應用程式本身的權限——檔案、網路、環境與程序。下方的清單是外掛所宣告的內容，也是你之後可以關閉的內容，而不是限制其程式碼可觸及範圍的界線。', identity: '身分與套件', evidence: '技術證據', executableCode: '可執行程式碼與擴充項目', requiredAccess: '必要的主機存取權', optionalAccess: '選用的主機存取權', requestInterceptors: '要求攔截器', rawCredentials: '原始憑證存取聲明', compatibility: '相容性與更新', none: '未聲明任何內容', scope: ({ scope }: { scope: string }) => `範圍：${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · 開發版本`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · 未驗證`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity}（預期值）`, observed: ({ integrity }: { integrity: string }) => `${integrity}（觀測值）` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `已驗證登錄檔簽章：${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `不支援的登錄檔簽章：${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `已聲明但未驗證：${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `已取得但未驗證：${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `來源證明無法使用：${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `未經審閱的目錄來源：${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `由 ${sourceId} 於 ${reviewedAt} 審閱${reason}`, savedSecret: '已儲存的密鑰', connectedAccount: '已連結的帳戶', secretKinds: ({ kinds }: { kinds: string }) => `密鑰類型：${kinds}`, connectedAccountService: ({ service }: { service: string }) => `服務：${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `用途：${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `在${realm}的${phase}階段使用`, credentialAccess: ({ access }: { access: string }) => `存取內容：${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `傳送到 ${origin} 的請求標頭：${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `環境變數：${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `檔案：${files}`, realm: { web: '網頁端', ios: 'iOS 客戶端', android: 'Android 客戶端', daemon: '背景服務' }, phase: { settings: '設定', prepare: '準備', connection: '連線', speech: '語音' }, runtimeApi: ({ version }: { version: number }) => `執行階段介面 ${version}`,
        },
        sourceAdministration: { title: '來源與登錄檔', subtitle: '選擇這台機器從何處探索確切的 npm 套件，以及如何存取對應的登錄檔。', communityTitle: '公共 npm 目錄', communitySubtitle: '內建 · 在公共 npm 中探索符合條件的 Happier 外掛，而非任意 npm 套件；結果未經審閱。', configuredTitle: '市集來源', configuredEmpty: '未設定其他市集來源。', add: '新增來源', edit: '編輯來源', remove: '移除來源', removeTitle: '要移除市集來源嗎？', removeBody: ({ name }: { name: string }) => `${name} 將不再用於這台機器上的探索。已安裝的外掛不會變更。`, sourceUrl: '來源位址', displayName: '顯示名稱', description: '選填說明', enabled: '已啟用', disabled: '已停用', curated: '精選來源', user: '你的來源', loadError: '無法載入市集來源。', retry: '重試', operationFailed: '無法套用此變更。請檢查機器連線後再試一次。', operationOutcomeUnknownTitle: '變更需要審閱', operationOutcomeUnknownBody: '所選機器可能已套用此變更，但 Happier 無法確認結果。請先檢視重新整理後的設定，再重新變更。' },
        updatePolicy: { title: '更新規則', target: ({ machine, server }: { machine: string; server: string }) => `透過 ${server} 套用於 ${machine}。`, pinned: '固定版本', pinnedSubtitle: '在選擇其他規則前不要更新。', allowed: '允許更新', allowedSubtitle: '明確更新無需再次確認，除非聲明的權限擴大。' },
    },
    ja: {
        installReviewSections: {
            ...localizedTechnicalReviewVocabulary.ja,
            archiveUrlRetention: 'Happier は今後の更新のため、認証情報が含まれている場合はそれも含めて、アーカイブの完全な URL を選択したマシンに保存します。URL の期限切れや失効により、更新に失敗することがあります。',
            trustedCodeTitle: '信頼するコード', trustedCodeDisclosure: 'プラグインは Happier 内で信頼済みコードとして実行され、サンドボックスでは隔離されません。プラグインは、下に示す Happier 経由のサービスにとどまらず、このアプリ自身の権限（ファイル、ネットワーク、環境、プロセス）を直接使用できます。下の一覧はプラグインが宣言した内容であり、後から無効にできる範囲でもありますが、そのコードが到達できる範囲を制限する境界ではありません。', identity: '識別情報とパッケージ', evidence: '技術的な証拠', executableCode: '実行コードと拡張項目', requiredAccess: '必須のホストアクセス', optionalAccess: '任意のホストアクセス', requestInterceptors: 'リクエストインターセプター', rawCredentials: '認証情報への直接アクセス宣言', compatibility: '互換性と更新', none: '宣言なし', scope: ({ scope }: { scope: string }) => `範囲：${scope}`, developmentPath: ({ locator }: { locator: string }) => `${locator} · 開発版`, publisherUnverified: ({ displayName, id }: { displayName: string; id: string }) => `${displayName} · ${id} · 未検証`, integrityBasis: { expected: ({ integrity }: { integrity: string }) => `${integrity}（期待値）`, observed: ({ integrity }: { integrity: string }) => `${integrity}（観測値）` }, signatureStatus: { verified: ({ keyId }: { keyId: string }) => `レジストリ署名を検証済み：${keyId}`, unsupported: ({ keyId }: { keyId: string }) => `未対応のレジストリ署名：${keyId}` }, provenanceDeclaredUnverified: ({ predicateType }: { predicateType: string }) => `宣言済み・未検証：${predicateType}`, provenanceRetrievedUnverified: ({ predicateTypes }: { predicateTypes: string }) => `取得済み・未検証：${predicateTypes}`, provenanceUnavailable: ({ code }: { code: string }) => `来歴情報を利用できません：${code}`, curationUnreviewed: ({ sourceId }: { sourceId: string }) => `未審査のカタログソース：${sourceId}`, curationApproved: ({ sourceId, reviewedAt, reason }: { sourceId: string; reviewedAt: string; reason: string }) => `${sourceId} が ${reviewedAt} に審査${reason}`, savedSecret: '保存済みシークレット', connectedAccount: '接続済みアカウント', secretKinds: ({ kinds }: { kinds: string }) => `シークレットの種類：${kinds}`, connectedAccountService: ({ service }: { service: string }) => `サービス：${service}`, credentialPurpose: ({ purpose }: { purpose: string }) => `用途：${purpose}`, credentialUse: ({ realm, phase }: { realm: string; phase: string }) => `${realm} の「${phase}」段階で使用`, credentialAccess: ({ access }: { access: string }) => `アクセス内容：${access}`, credentialRequestHeaders: ({ origin, headers }: { origin: string; headers: string }) => `${origin} に送信されるヘッダー: ${headers}`, credentialRequestEnvironment: ({ keys }: { keys: string }) => `環境変数: ${keys}`, credentialRequestFiles: ({ files }: { files: string }) => `ファイル: ${files}`, realm: { web: 'ウェブクライアント', ios: 'iOS アプリ', android: 'Android アプリ', daemon: 'バックグラウンドサービス' }, phase: { settings: '設定', prepare: '準備', connection: '接続', speech: '音声利用' }, runtimeApi: ({ version }: { version: number }) => `ランタイム API ${version}`,
        },
        sourceAdministration: { title: 'ソースとレジストリ', subtitle: 'このマシンが正確な npm パッケージを見つける場所と、そのレジストリへの接続方法を選びます。', communityTitle: '公開 npm ディレクトリ', communitySubtitle: '組み込み · 公開 npm で対象の Happier プラグインを検索します。任意の npm パッケージが対象ではなく、結果は未審査です。', configuredTitle: 'マーケットプレイスソース', configuredEmpty: '追加のマーケットプレイスソースは設定されていません。', add: 'ソースを追加', edit: 'ソースを編集', remove: 'ソースを削除', removeTitle: 'マーケットプレイスソースを削除しますか？', removeBody: ({ name }: { name: string }) => `${name} はこのマシンの検索に使われなくなります。インストール済みプラグインは変更されません。`, sourceUrl: 'ソースのアドレス', displayName: '表示名', description: '説明（任意）', enabled: '有効', disabled: '無効', curated: '選定済みソース', user: '自分のソース', loadError: 'マーケットプレイスソースを読み込めませんでした。', retry: '再試行', operationFailed: '変更を適用できませんでした。マシンへの接続を確認して、もう一度お試しください。', operationOutcomeUnknownTitle: '変更の確認が必要です', operationOutcomeUnknownBody: '選択したマシンはこの変更を適用済みの可能性がありますが、Happier は結果を確認できませんでした。再度変更する前に、更新された設定を確認してください。' },
        updatePolicy: { title: '更新ルール', target: ({ machine, server }: { machine: string; server: string }) => `${server} 経由で ${machine} に適用されます。`, pinned: 'バージョンを固定', pinnedSubtitle: '別のルールを選ぶまで更新しません。', allowed: '更新を許可', allowedSubtitle: '明示的な更新は、宣言された権限が拡大しない限り再確認なしで続行します。' },
    },
} as const;

/**
 * Discover is one aggregate query over several independent marketplace indexes,
 * so partial failure is the normal case rather than an error state. Every
 * locale therefore keeps three facts separable: how many results were found,
 * which sources answered with something older or nothing at all, and which
 * listings exist but cannot be installed here. Collapsing them into one
 * "catalog unavailable" would tell a reader Discover is broken when in fact one
 * index is offline.
 */
export const pluginMarketplaceDiscoverTranslations = {
    en: english,
    de: {
        ...localizedReviewVocabulary.de,
        ...marketplacePresentation.de,
        secretFieldActions: { delete: 'Gespeichertes Geheimnis löschen', deleteHint: 'Löscht den gespeicherten Wert endgültig. Das lässt sich nicht rückgängig machen.', unbind: 'Aus diesem Plugin entfernen', unbindHint: 'Löst das gespeicherte Geheimnis von dieser Einstellung. Das Geheimnis selbst bleibt erhalten.' },
        pluginChangeOutcomeUnknownTitle: 'Ergebnis nicht bestätigt',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier konnte nicht bestätigen, ob ${action} für ${name} auf ${machine} (${server}) abgeschlossen wurde. Sieh dort unter „Installiert“ nach und prüfe die aktuelle Version, bevor du es erneut versuchst.`,
        updateFromInstalledRecordSubtitle: 'Diese Installation über ihren eigenen vertrauten Update-Kanal aktualisieren.',
        discover: {
            ...marketplacePresentation.de.discover,
            status: {
                loading: 'Alle Marktplatzquellen werden durchsucht …',
                loadingSource: ({ source }: { source: string }) => `${source} wird durchsucht …`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} Plugin(s) aus ${sources} Quelle(n)`,
                empty: 'Keine Plugins passen zu dieser Suche.',
                error: ({ message }: { message: string }) => `Diese Suche konnte nicht aktualisiert werden: ${message}`,
                errorTitle: 'Diese Suche konnte nicht aktualisiert werden',
                stale: 'Diese Ergebnisse gehören zu einer früheren Suche. Suche erneut, um die Einstellungen oben anzuwenden.',
                partial: ({ count }: { count: number }) =>
                    `${count} Quelle(n) haben mit älteren oder fehlenden Daten geantwortet, die Ergebnisse können unvollständig sein.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `${count} Eintrag/Einträge wurden gefunden, können auf diesem Rechner aber gerade nicht installiert werden.`,
            },
            sourceFreshness: {
                stale: 'Älter als diese Quelle',
                'stale-offline': 'Letzter bekannter Stand, Quelle offline',
                unavailable: 'Quelle nicht verfügbar',
                'auth-unavailable': 'Für diese Quelle ist eine Anmeldung nötig',
                corrupt: 'Der Quellindex konnte nicht gelesen werden',
            },
            nonInstallableReason: {
                sourceStale: 'Die Marktplatzquelle ist nicht aktuell.',
                artifactUnavailable: 'Das Paket ist mit dem Registry-Zugang dieses Rechners nicht erreichbar.',
                notApproved: 'Aus dieser Quelle ist die Installation nicht freigegeben.',
                unsupportedSourceKind: 'Diese Quellenart unterstützt diese Happier-Version nicht.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Prüfe alles, was dieses Plugin deklariert, bevor etwas aus ${source} vertraut wird.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Benötigt ein Registry-Profil für ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Registry für ${name} wählen`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} wird über ${origin} veröffentlicht. Wähle das Registry-Profil, das ${source} auf diesem Rechner nutzt, oder füge eines hinzu und melde dich an. Heruntergeladen wird erst nach der Prüfung zum Installieren und Vertrauen.`,
                continue: 'Weiter',
            },
        },
    },
    fr: {
        ...localizedReviewVocabulary.fr,
        ...marketplacePresentation.fr,
        secretFieldActions: { delete: 'Supprimer le secret enregistré', deleteHint: 'Efface la valeur enregistrée. C’est irréversible.', unbind: 'Retirer de ce plugin', unbindHint: 'Détache le secret enregistré de ce réglage. Le secret lui-même est conservé.' },
        pluginChangeOutcomeUnknownTitle: 'Résultat non confirmé',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier n’a pas pu confirmer si ${action} pour ${name} s’est terminé sur ${machine} (${server}). Regarde la liste Installés de cette machine et sa version actuelle avant de réessayer.`,
        updateFromInstalledRecordSubtitle: 'Faire avancer cette installation via son propre canal de mise à jour approuvé.',
        discover: {
            ...marketplacePresentation.fr.discover,
            status: {
                loading: 'Recherche dans toutes les sources de marketplace…',
                loadingSource: ({ source }: { source: string }) => `Recherche dans ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} plugin(s) provenant de ${sources} source(s)`,
                empty: 'Aucun plugin ne correspond à cette recherche.',
                error: ({ message }: { message: string }) => `La recherche n’a pas pu être actualisée : ${message}`,
                errorTitle: 'La recherche n’a pas pu être actualisée',
                stale: 'Ces résultats correspondent à une recherche précédente. Relancez la recherche pour appliquer les réglages ci-dessus.',
                partial: ({ count }: { count: number }) =>
                    `${count} source(s) ont répondu avec des données plus anciennes ou manquantes : les résultats peuvent être incomplets.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `${count} entrée(s) ont été trouvées mais ne peuvent pas être installées sur cette machine pour le moment.`,
            },
            sourceFreshness: {
                stale: 'Plus ancien que cette source',
                'stale-offline': 'Derniers résultats connus, source hors ligne',
                unavailable: 'Source indisponible',
                'auth-unavailable': 'Connexion requise pour cette source',
                corrupt: 'L’index de la source n’a pas pu être lu',
            },
            nonInstallableReason: {
                sourceStale: 'Sa source de marketplace n’est pas à jour.',
                artifactUnavailable: 'Son paquet est inaccessible avec l’accès au registre de cette machine.',
                notApproved: 'Son installation n’est pas approuvée depuis cette source.',
                unsupportedSourceKind: 'Ce type de source n’est pas pris en charge par cette version de Happier.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Examinez tout ce que ce plugin déclare avant d’accorder votre confiance à ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Nécessite un profil de registre pour ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Choisir un registre pour ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} est publié sur ${origin}. Choisissez le profil de registre que ${source} utilise sur cette machine, ou ajoutez-en un et connectez-vous. Rien n’est téléchargé avant l’examen d’installation et de confiance.`,
                continue: 'Continuer',
            },
        },
    },
    ru: {
        ...localizedReviewVocabulary.ru,
        ...marketplacePresentation.ru,
        secretFieldActions: { delete: 'Удалить сохраненный секрет', deleteHint: 'Стирает сохраненное значение. Отменить это нельзя.', unbind: 'Отвязать от этого плагина', unbindHint: 'Отсоединяет сохраненный секрет от этой настройки. Сам секрет остается.' },
        pluginChangeOutcomeUnknownTitle: 'Результат не подтвержден',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier не смог подтвердить, завершилось ли действие «${action}» для ${name} на ${machine} (${server}). Откройте список установленных на этой машине и проверьте текущую версию, прежде чем повторять.`,
        updateFromInstalledRecordSubtitle: 'Обновить эту установку по её собственному доверенному каналу обновлений.',
        discover: {
            ...marketplacePresentation.ru.discover,
            status: {
                loading: 'Поиск по всем источникам маркетплейса…',
                loadingSource: ({ source }: { source: string }) => `Поиск в источнике ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `Плагинов: ${count}; источников: ${sources}`,
                empty: 'По этому запросу плагины не найдены.',
                error: ({ message }: { message: string }) => `Не удалось обновить поиск: ${message}`,
                errorTitle: 'Не удалось обновить поиск',
                stale: 'Эти результаты относятся к предыдущему запросу. Выполните поиск снова, чтобы применить настройки выше.',
                partial: ({ count }: { count: number }) =>
                    `Источников с устаревшими или отсутствующими данными: ${count}. Результаты могут быть неполными.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `Найдено записей, которые сейчас нельзя установить на этой машине: ${count}.`,
            },
            sourceFreshness: {
                stale: 'Старее, чем этот источник',
                'stale-offline': 'Последние известные результаты, источник офлайн',
                unavailable: 'Источник недоступен',
                'auth-unavailable': 'Для этого источника нужен вход',
                corrupt: 'Индекс источника не удалось прочитать',
            },
            nonInstallableReason: {
                sourceStale: 'Его источник маркетплейса неактуален.',
                artifactUnavailable: 'Его пакет недоступен с текущим доступом к реестру на этой машине.',
                notApproved: 'Установка из этого источника не одобрена.',
                unsupportedSourceKind: 'Этот вид источника не поддерживается в этой версии Happier.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Проверьте всё, что объявляет плагин, прежде чем доверять чему-либо из источника ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Нужен профиль реестра для ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Выберите реестр для ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} опубликован в ${origin}. Выберите профиль реестра, который ${source} использует на этой машине, или добавьте его и войдите. Ничего не загружается до проверки установки и доверия.`,
                continue: 'Продолжить',
            },
        },
    },
    es: {
        ...localizedReviewVocabulary.es,
        ...marketplacePresentation.es,
        secretFieldActions: { delete: 'Eliminar el secreto guardado', deleteHint: 'Borra el valor guardado. No se puede deshacer.', unbind: 'Quitar de este plugin', unbindHint: 'Desvincula el secreto guardado de este ajuste. El secreto se conserva.' },
        pluginChangeOutcomeUnknownTitle: 'Resultado sin confirmar',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier no pudo confirmar si ${action} para ${name} terminó en ${machine} (${server}). Consulta la lista de instalados de esa máquina y su versión actual antes de volver a intentarlo.`,
        updateFromInstalledRecordSubtitle: 'Actualizar esta instalación por su propio canal de actualización de confianza.',
        discover: {
            ...marketplacePresentation.es.discover,
            status: {
                loading: 'Buscando en todas las fuentes del marketplace…',
                loadingSource: ({ source }: { source: string }) => `Buscando en ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} plugin(s) de ${sources} fuente(s)`,
                empty: 'Ningún plugin coincide con esta búsqueda.',
                error: ({ message }: { message: string }) => `No se pudo actualizar la búsqueda: ${message}`,
                errorTitle: 'No se pudo actualizar la búsqueda',
                stale: 'Estos resultados responden a una búsqueda anterior. Vuelve a buscar para aplicar los controles de arriba.',
                partial: ({ count }: { count: number }) =>
                    `${count} fuente(s) respondieron con datos antiguos o incompletos, así que los resultados pueden estar incompletos.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `Se encontraron ${count} entrada(s) que ahora mismo no se pueden instalar en esta máquina.`,
            },
            sourceFreshness: {
                stale: 'Más antiguo que esta fuente',
                'stale-offline': 'Últimos resultados conocidos, fuente sin conexión',
                unavailable: 'Fuente no disponible',
                'auth-unavailable': 'Esta fuente requiere iniciar sesión',
                corrupt: 'No se pudo leer el índice de la fuente',
            },
            nonInstallableReason: {
                sourceStale: 'Su fuente del marketplace no está actualizada.',
                artifactUnavailable: 'No se puede alcanzar su paquete con el acceso al registro de esta máquina.',
                notApproved: 'Su instalación no está aprobada desde esta fuente.',
                unsupportedSourceKind: 'Esta versión de Happier no admite ese tipo de fuente.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Revisa todo lo que declara este plugin antes de confiar en nada procedente de ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Necesita un perfil de registro para ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Elige un registro para ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} se publica en ${origin}. Elige el perfil de registro que ${source} usa en esta máquina, o añade uno e inicia sesión. No se descarga nada hasta la revisión de instalación y confianza.`,
                continue: 'Continuar',
            },
        },
    },
    it: {
        ...localizedReviewVocabulary.it,
        ...marketplacePresentation.it,
        secretFieldActions: { delete: 'Elimina il segreto salvato', deleteHint: 'Cancella il valore salvato. L’operazione non è reversibile.', unbind: 'Rimuovi da questo plugin', unbindHint: 'Scollega il segreto salvato da questa impostazione. Il segreto viene conservato.' },
        pluginChangeOutcomeUnknownTitle: 'Esito non confermato',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier non ha potuto confermare se ${action} per ${name} sia stata completata su ${machine} (${server}). Controlla l’elenco Installati di quella macchina e la versione attuale prima di riprovare.`,
        updateFromInstalledRecordSubtitle: 'Aggiorna questa installazione tramite il suo canale di aggiornamento attendibile.',
        discover: {
            ...marketplacePresentation.it.discover,
            status: {
                loading: 'Ricerca in tutte le fonti del marketplace…',
                loadingSource: ({ source }: { source: string }) => `Ricerca in ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} plugin da ${sources} fonte/i`,
                empty: 'Nessun plugin corrisponde a questa ricerca.',
                error: ({ message }: { message: string }) => `Non è stato possibile aggiornare la ricerca: ${message}`,
                errorTitle: 'Non è stato possibile aggiornare la ricerca',
                stale: 'Questi risultati rispondono a una ricerca precedente. Cerca di nuovo per applicare i controlli qui sopra.',
                partial: ({ count }: { count: number }) =>
                    `${count} fonte/i hanno risposto con dati vecchi o mancanti, quindi i risultati possono essere incompleti.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `Sono state trovate ${count} voci che al momento non possono essere installate su questa macchina.`,
            },
            sourceFreshness: {
                stale: 'Più vecchio di questa fonte',
                'stale-offline': 'Ultimi risultati noti, fonte offline',
                unavailable: 'Fonte non disponibile',
                'auth-unavailable': 'Per questa fonte serve l’accesso',
                corrupt: 'Non è stato possibile leggere l’indice della fonte',
            },
            nonInstallableReason: {
                sourceStale: 'La sua fonte del marketplace non è aggiornata.',
                artifactUnavailable: 'Il suo pacchetto non è raggiungibile con l’accesso al registro di questa macchina.',
                notApproved: 'L’installazione da questa fonte non è approvata.',
                unsupportedSourceKind: 'Questo tipo di fonte non è supportato da questa versione di Happier.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Controlla tutto ciò che questo plugin dichiara prima di dare fiducia a qualcosa proveniente da ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Richiede un profilo di registro per ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Scegli un registro per ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} è pubblicato su ${origin}. Scegli il profilo di registro che ${source} usa su questa macchina, oppure aggiungine uno e accedi. Nulla viene scaricato prima della revisione di installazione e fiducia.`,
                continue: 'Continua',
            },
        },
    },
    pt: {
        ...localizedReviewVocabulary.pt,
        ...marketplacePresentation.pt,
        secretFieldActions: { delete: 'Eliminar o segredo guardado', deleteHint: 'Apaga o valor guardado. Não é possível anular.', unbind: 'Remover deste plugin', unbindHint: 'Desassocia o segredo guardado desta definição. O segredo é mantido.' },
        pluginChangeOutcomeUnknownTitle: 'Resultado não confirmado',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `O Happier não conseguiu confirmar se ${action} para ${name} terminou em ${machine} (${server}). Consulta a lista de instalados dessa máquina e a versão atual antes de tentares novamente.`,
        updateFromInstalledRecordSubtitle: 'Avançar esta instalação pelo seu próprio canal de atualização de confiança.',
        discover: {
            ...marketplacePresentation.pt.discover,
            status: {
                loading: 'A pesquisar em todas as fontes do marketplace…',
                loadingSource: ({ source }: { source: string }) => `A pesquisar em ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} plugin(s) de ${sources} fonte(s)`,
                empty: 'Nenhum plugin corresponde a esta pesquisa.',
                error: ({ message }: { message: string }) => `Não foi possível atualizar a pesquisa: ${message}`,
                errorTitle: 'Não foi possível atualizar a pesquisa',
                stale: 'Estes resultados respondem a uma pesquisa anterior. Pesquise de novo para aplicar os controlos acima.',
                partial: ({ count }: { count: number }) =>
                    `${count} fonte(s) responderam com dados antigos ou em falta, por isso os resultados podem estar incompletos.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `Foram encontradas ${count} entrada(s) que neste momento não podem ser instaladas nesta máquina.`,
            },
            sourceFreshness: {
                stale: 'Mais antigo do que esta fonte',
                'stale-offline': 'Últimos resultados conhecidos, fonte offline',
                unavailable: 'Fonte indisponível',
                'auth-unavailable': 'Esta fonte exige sessão iniciada',
                corrupt: 'Não foi possível ler o índice da fonte',
            },
            nonInstallableReason: {
                sourceStale: 'A sua fonte do marketplace não está atual.',
                artifactUnavailable: 'O seu pacote não é alcançável com o acesso ao registo desta máquina.',
                notApproved: 'A instalação a partir desta fonte não está aprovada.',
                unsupportedSourceKind: 'Esta versão do Happier não suporta este tipo de fonte.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Reveja tudo o que este plugin declara antes de confiar em algo vindo de ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Precisa de um perfil de registo para ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Escolha um registo para ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} é publicado em ${origin}. Escolha o perfil de registo que ${source} usa nesta máquina, ou adicione um e inicie sessão. Nada é transferido antes da revisão de instalação e confiança.`,
                continue: 'Continuar',
            },
        },
    },
    ca: {
        ...localizedReviewVocabulary.ca,
        ...marketplacePresentation.ca,
        secretFieldActions: { delete: 'Elimina el secret desat', deleteHint: 'Esborra el valor desat. No es pot desfer.', unbind: 'Treu-lo d’aquest plugin', unbindHint: 'Desvincula el secret desat d’aquesta opció. El secret es conserva.' },
        pluginChangeOutcomeUnknownTitle: 'Resultat no confirmat',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier no ha pogut confirmar si ${action} per a ${name} ha acabat a ${machine} (${server}). Consulta la llista d’instal·lats d’aquesta màquina i la versió actual abans de tornar-ho a provar.`,
        updateFromInstalledRecordSubtitle: 'Fes avançar aquesta instal·lació pel seu propi canal d’actualització de confiança.',
        discover: {
            ...marketplacePresentation.ca.discover,
            status: {
                loading: 'S’està cercant a totes les fonts del mercat…',
                loadingSource: ({ source }: { source: string }) => `S’està cercant a ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${count} connector(s) de ${sources} font(s)`,
                empty: 'Cap connector coincideix amb aquesta cerca.',
                error: ({ message }: { message: string }) => `No s’ha pogut actualitzar la cerca: ${message}`,
                errorTitle: 'No s’ha pogut actualitzar la cerca',
                stale: 'Aquests resultats responen a una cerca anterior. Torna a cercar per aplicar els controls de dalt.',
                partial: ({ count }: { count: number }) =>
                    `${count} font(s) han respost amb dades antigues o absents, així que els resultats poden ser incomplets.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `S’han trobat ${count} entrada(es) que ara mateix no es poden instal·lar en aquesta màquina.`,
            },
            sourceFreshness: {
                stale: 'Més antic que aquesta font',
                'stale-offline': 'Darrers resultats coneguts, font fora de línia',
                unavailable: 'Font no disponible',
                'auth-unavailable': 'Aquesta font requereix iniciar la sessió',
                corrupt: 'No s’ha pogut llegir l’índex de la font',
            },
            nonInstallableReason: {
                sourceStale: 'La seva font del mercat no és actual.',
                artifactUnavailable: 'El seu paquet no és accessible amb l’accés al registre d’aquesta màquina.',
                notApproved: 'La instal·lació des d’aquesta font no està aprovada.',
                unsupportedSourceKind: 'Aquesta versió de Happier no admet aquest tipus de font.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Revisa tot el que declara aquest connector abans de confiar en res que vingui de ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Necessita un perfil de registre per a ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Tria un registre per a ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} es publica a ${origin}. Tria el perfil de registre que ${source} fa servir en aquesta màquina, o afegeix-ne un i inicia la sessió. No es baixa res fins a la revisió d’instal·lació i confiança.`,
                continue: 'Continua',
            },
        },
    },
    pl: {
        ...localizedReviewVocabulary.pl,
        ...marketplacePresentation.pl,
        secretFieldActions: { delete: 'Usuń zapisany sekret', deleteHint: 'Kasuje zapisaną wartość. Nie można tego cofnąć.', unbind: 'Odłącz od tej wtyczki', unbindHint: 'Odłącza zapisany sekret od tego ustawienia. Sam sekret zostaje zachowany.' },
        pluginChangeOutcomeUnknownTitle: 'Wynik niepotwierdzony',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier nie mógł potwierdzić, czy działanie „${action}” dla ${name} zakończyło się na ${machine} (${server}). Sprawdź listę zainstalowanych na tej maszynie i bieżącą wersję, zanim spróbujesz ponownie.`,
        updateFromInstalledRecordSubtitle: 'Zaktualizuj tę instalację przez jej własny zaufany kanał aktualizacji.',
        discover: {
            ...marketplacePresentation.pl.discover,
            status: {
                loading: 'Przeszukiwanie wszystkich źródeł marketplace…',
                loadingSource: ({ source }: { source: string }) => `Przeszukiwanie źródła ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `Wtyczki: ${count}, źródła: ${sources}`,
                empty: 'Żadna wtyczka nie pasuje do tego wyszukiwania.',
                error: ({ message }: { message: string }) => `Nie udało się odświeżyć wyszukiwania: ${message}`,
                errorTitle: 'Nie udało się odświeżyć wyszukiwania',
                stale: 'Te wyniki dotyczą wcześniejszego wyszukiwania. Wyszukaj ponownie, aby zastosować ustawienia powyżej.',
                partial: ({ count }: { count: number }) =>
                    `Źródła ze starszymi lub brakującymi danymi: ${count}. Wyniki mogą być niepełne.`,
                nonInstallable: ({ count }: { count: number }) =>
                    `Znaleziono ${count} pozycji, których nie można teraz zainstalować na tej maszynie.`,
            },
            sourceFreshness: {
                stale: 'Starsze niż to źródło',
                'stale-offline': 'Ostatnie znane wyniki, źródło offline',
                unavailable: 'Źródło niedostępne',
                'auth-unavailable': 'To źródło wymaga zalogowania',
                corrupt: 'Nie udało się odczytać indeksu źródła',
            },
            nonInstallableReason: {
                sourceStale: 'Jej źródło marketplace nie jest aktualne.',
                artifactUnavailable: 'Jej pakiet jest nieosiągalny przy dostępie do rejestru tej maszyny.',
                notApproved: 'Instalacja z tego źródła nie jest zatwierdzona.',
                unsupportedSourceKind: 'Ta wersja Happier nie obsługuje tego rodzaju źródła.',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `Sprawdź wszystko, co deklaruje ta wtyczka, zanim zaufasz czemukolwiek ze źródła ${source}.`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `Wymaga profilu rejestru dla ${origin}`,
            registrySelection: {
                title: ({ name }: { name: string }) => `Wybierz rejestr dla ${name}`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} jest publikowany w ${origin}. Wybierz profil rejestru, którego ${source} używa na tym komputerze, albo dodaj go i zaloguj się. Nic nie jest pobierane przed przeglądem instalacji i zaufania.`,
                continue: 'Dalej',
            },
        },
    },
    'zh-Hans': {
        ...localizedReviewVocabulary['zh-Hans'],
        ...marketplacePresentation['zh-Hans'],
        secretFieldActions: { delete: '删除已保存的密钥', deleteHint: '彻底清除已保存的值，无法撤销。', unbind: '从此插件移除', unbindHint: '解除该设置与已保存密钥的关联，密钥本身会保留。' },
        pluginChangeOutcomeUnknownTitle: '结果未确认',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier 无法确认 ${name} 的${action}是否已在 ${machine}（${server}）上完成。请先在该机器上查看已安装列表及其当前版本，然后再重试。`,
        updateFromInstalledRecordSubtitle: '通过该安装记录自己的受信任更新通道进行升级。',
        discover: {
            ...marketplacePresentation['zh-Hans'].discover,
            status: {
                loading: '正在搜索所有市场来源…',
                loadingSource: ({ source }: { source: string }) => `正在搜索 ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `来自 ${sources} 个来源的 ${count} 个插件`,
                empty: '没有插件符合此搜索。',
                error: ({ message }: { message: string }) => `无法刷新发现结果：${message}`,
                errorTitle: '无法刷新发现结果',
                stale: '这些结果对应之前的搜索。请重新搜索以应用上方的设置。',
                partial: ({ count }: { count: number }) =>
                    `有 ${count} 个来源返回了较旧或缺失的数据，结果可能不完整。`,
                nonInstallable: ({ count }: { count: number }) =>
                    `找到 ${count} 个条目，但当前无法安装到这台机器上。`,
            },
            sourceFreshness: {
                stale: '比该来源更旧',
                'stale-offline': '最后已知结果，来源离线',
                unavailable: '来源不可用',
                'auth-unavailable': '该来源需要登录',
                corrupt: '无法读取来源索引',
            },
            nonInstallableReason: {
                sourceStale: '它的市场来源不是最新的。',
                artifactUnavailable: '以这台机器的注册表访问权限无法获取它的软件包。',
                notApproved: '尚未批准从该来源安装。',
                unsupportedSourceKind: '此版本的 Happier 不支持该来源类型。',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `在信任来自 ${source} 的任何内容之前，请先审阅该插件声明的全部内容。`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `需要 ${origin} 的注册表配置`,
            registrySelection: {
                title: ({ name }: { name: string }) => `为 ${name} 选择注册表`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} 发布在 ${origin}。请选择 ${source} 在此机器上使用的注册表配置，或添加一个并登录。在“安装并信任”审核之前不会下载任何内容。`,
                continue: '继续',
            },
        },
    },
    'zh-Hant': {
        ...localizedReviewVocabulary['zh-Hant'],
        ...marketplacePresentation['zh-Hant'],
        secretFieldActions: { delete: '刪除已儲存的密鑰', deleteHint: '徹底清除已儲存的值，無法復原。', unbind: '從此外掛移除', unbindHint: '解除此設定與已儲存密鑰的關聯，密鑰本身會保留。' },
        pluginChangeOutcomeUnknownTitle: '結果未確認',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `Happier 無法確認 ${name} 的${action}是否已在 ${machine}（${server}）上完成。請先在該機器上查看已安裝清單及其目前版本，然後再重試。`,
        updateFromInstalledRecordSubtitle: '透過此安裝紀錄自己的受信任更新通道進行升級。',
        discover: {
            ...marketplacePresentation['zh-Hant'].discover,
            status: {
                loading: '正在搜尋所有市集來源…',
                loadingSource: ({ source }: { source: string }) => `正在搜尋 ${source}…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `來自 ${sources} 個來源的 ${count} 個外掛`,
                empty: '沒有外掛符合此搜尋。',
                error: ({ message }: { message: string }) => `無法重新整理探索結果：${message}`,
                errorTitle: '無法重新整理探索結果',
                stale: '這些結果對應先前的搜尋。請重新搜尋以套用上方的設定。',
                partial: ({ count }: { count: number }) =>
                    `有 ${count} 個來源回傳了較舊或缺少的資料，結果可能不完整。`,
                nonInstallable: ({ count }: { count: number }) =>
                    `找到 ${count} 個項目，但目前無法安裝到這台機器上。`,
            },
            sourceFreshness: {
                stale: '比這個來源更舊',
                'stale-offline': '最後已知結果，來源離線',
                unavailable: '來源無法使用',
                'auth-unavailable': '這個來源需要登入',
                corrupt: '無法讀取來源索引',
            },
            nonInstallableReason: {
                sourceStale: '它的市集來源不是最新的。',
                artifactUnavailable: '以這台機器的登錄檔存取權無法取得它的套件。',
                notApproved: '尚未核准從這個來源安裝。',
                unsupportedSourceKind: '此版本的 Happier 不支援這種來源類型。',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `在信任任何來自 ${source} 的內容之前，請先審閱這個外掛宣告的全部內容。`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `需要 ${origin} 的登錄檔設定`,
            registrySelection: {
                title: ({ name }: { name: string }) => `為 ${name} 選擇登錄檔`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} 發布在 ${origin}。請選擇 ${source} 在此機器上使用的登錄檔設定，或新增一個並登入。在「安裝並信任」審查之前不會下載任何內容。`,
                continue: '繼續',
            },
        },
    },
    ja: {
        ...localizedReviewVocabulary.ja,
        ...marketplacePresentation.ja,
        secretFieldActions: { delete: '保存済みシークレットを削除', deleteHint: '保存された値を消去します。元に戻せません。', unbind: 'このプラグインから外す', unbindHint: 'この設定と保存済みシークレットの関連付けを解除します。シークレット自体は残ります。' },
        pluginChangeOutcomeUnknownTitle: '結果は未確認です',
        pluginChangeOutcomeUnknownBody: ({ action, name, machine, server }: { action: string; name: string; machine: string; server: string }) => `${name} の${action}が ${machine}（${server}）で完了したかどうかを Happier は確認できませんでした。再試行する前に、そのマシンのインストール済み一覧と現在のバージョンを確認してください。`,
        updateFromInstalledRecordSubtitle: 'このインストール自身の信頼された更新チャネルで更新します。',
        discover: {
            ...marketplacePresentation.ja.discover,
            status: {
                loading: 'すべてのマーケットプレイスソースを検索しています…',
                loadingSource: ({ source }: { source: string }) => `${source} を検索しています…`,
                results: ({ count, sources }: { count: number; sources: number }) =>
                    `${sources} 個のソースから ${count} 個のプラグイン`,
                empty: 'この検索に一致するプラグインはありません。',
                error: ({ message }: { message: string }) => `検索を更新できませんでした: ${message}`,
                errorTitle: '検索を更新できませんでした',
                stale: 'これらは以前の検索の結果です。上の設定を反映するにはもう一度検索してください。',
                partial: ({ count }: { count: number }) =>
                    `${count} 個のソースが古いデータまたは応答なしでした。結果は不完全な可能性があります。`,
                nonInstallable: ({ count }: { count: number }) =>
                    `${count} 件見つかりましたが、現在このマシンにはインストールできません。`,
            },
            sourceFreshness: {
                stale: 'このソースより古い状態',
                'stale-offline': '最後に判明した結果、ソースはオフライン',
                unavailable: 'ソースを利用できません',
                'auth-unavailable': 'このソースにはサインインが必要です',
                corrupt: 'ソースのインデックスを読み取れませんでした',
            },
            nonInstallableReason: {
                sourceStale: 'マーケットプレイスソースが最新ではありません。',
                artifactUnavailable: 'このマシンのレジストリアクセスではパッケージに到達できません。',
                notApproved: 'このソースからのインストールは承認されていません。',
                unsupportedSourceKind: 'このバージョンの Happier はこのソース種別に対応していません。',
            },
            installSubtitle: ({ source }: { source: string }) =>
                `${source} からのものを信頼する前に、このプラグインが宣言する内容をすべて確認してください。`,
            registrySelectionRequired: ({ origin }: { origin: string }) => `${origin} のレジストリプロファイルが必要です`,
            registrySelection: {
                title: ({ name }: { name: string }) => `${name} のレジストリを選択`,
                body: ({ name, origin, source }: { name: string; origin: string; source: string }) =>
                    `${name} は ${origin} で公開されています。このマシンで ${source} が使うレジストリプロファイルを選ぶか、追加してサインインしてください。「インストールして信頼」の確認までは何もダウンロードされません。`,
                continue: '続行',
            },
        },
    },
} as const;
