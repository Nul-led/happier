const en = {
    title: 'Account Service sign-in',
    serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Canceling won’t sign you out of your existing Homes.',
    focusedHomePreserved: 'Your focused Home won’t change.',
    stages: {
        signingIn: 'Signing in to the Account Service',
        findingHomes: 'Finding your Homes',
        waitingApproval: 'Waiting for Home approval',
        accountServiceConnected: 'Account Service connected',
        homeAdded: 'Home added',
    },
    errors: {
        provider: { title: 'The provider did not complete sign-in', body: 'Return to Account settings and start the sign-in again.' },
        expired: { title: 'This sign-in request expired', body: 'Start again from Account settings.' },
        identityChanged: { title: 'The Account Service identity changed', body: 'Review the service in Account settings before reconnecting.' },
        unavailable: { title: 'The Account Service is unavailable', body: 'Check the service and try again. Your existing Homes are unchanged.' },
        exchange: { title: 'Sign-in could not be completed', body: 'No Account Service credential was saved. Start again from Account settings.' },
        storage: { title: 'Sign-in could not be saved', body: 'Your existing Home credentials are unchanged. Start again from Account settings.' },
        homeLink: { title: 'Signed in, but this Home could not be linked', body: 'Review the Account Service connection in Account settings.' },
        directoryRefresh: { title: 'Signed in, but we couldn’t refresh your Home list', body: 'Your Account Service connection is ready. Try the Home refresh again from Account settings.' },
        homeEnrollment: { title: 'Signed in, but your Personal Home was not added', body: 'Open Account settings to continue connecting the Home.' },
        invalid: { title: 'This sign-in request is no longer valid', body: 'Start again from Account settings.' },
    },
    actions: {
        openSettings: 'Open Account Settings',
        startAgain: 'Start Again',
    },
} as const;

const de = {
    title: 'Beim Kontodienst anmelden', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Beim Abbrechen bleibst du bei deinen bestehenden Homes angemeldet.', focusedHomePreserved: 'Dein fokussiertes Home ändert sich nicht.',
    stages: { signingIn: 'Beim Kontodienst anmelden', findingHomes: 'Deine Homes werden gesucht', waitingApproval: 'Auf Home-Genehmigung warten', accountServiceConnected: 'Kontodienst verbunden', homeAdded: 'Home hinzugefügt' },
    errors: { provider: { title: 'Der Anbieter hat die Anmeldung nicht abgeschlossen', body: 'Kehre zu den Kontoeinstellungen zurück und starte die Anmeldung erneut.' }, expired: { title: 'Diese Anmeldeanfrage ist abgelaufen', body: 'Starte erneut in den Kontoeinstellungen.' }, identityChanged: { title: 'Die Identität des Kontodienstes hat sich geändert', body: 'Prüfe den Dienst in den Kontoeinstellungen, bevor du ihn erneut verbindest.' }, unavailable: { title: 'Der Kontodienst ist nicht verfügbar', body: 'Prüfe den Dienst und versuche es erneut. Deine bestehenden Homes bleiben unverändert.' }, exchange: { title: 'Die Anmeldung konnte nicht abgeschlossen werden', body: 'Es wurden keine Zugangsdaten für den Kontodienst gespeichert. Starte erneut in den Kontoeinstellungen.' }, storage: { title: 'Die Anmeldung konnte nicht gespeichert werden', body: 'Deine bestehenden Home-Zugangsdaten bleiben unverändert. Starte erneut in den Kontoeinstellungen.' }, homeLink: { title: 'Angemeldet, aber dieses Home konnte nicht verknüpft werden', body: 'Prüfe die Verbindung zum Kontodienst in den Kontoeinstellungen.' }, directoryRefresh: { title: 'Angemeldet, aber deine Home-Liste konnte nicht aktualisiert werden', body: 'Die Verbindung zum Kontodienst ist bereit. Aktualisiere die Homes erneut in den Kontoeinstellungen.' }, homeEnrollment: { title: 'Angemeldet, aber dein persönliches Home wurde nicht hinzugefügt', body: 'Öffne die Kontoeinstellungen, um die Verbindung fortzusetzen.' }, invalid: { title: 'Diese Anmeldeanfrage ist nicht mehr gültig', body: 'Starte erneut in den Kontoeinstellungen.' } },
    actions: { openSettings: 'Kontoeinstellungen öffnen', startAgain: 'Neu starten' },
} as const;

const es = {
    title: 'Inicio de sesión del servicio de cuenta', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Cancelar no cerrará la sesión de tus Homes existentes.', focusedHomePreserved: 'Tu Home enfocado no cambiará.',
    stages: { signingIn: 'Iniciando sesión en el servicio de cuenta', findingHomes: 'Buscando tus Homes', waitingApproval: 'Esperando la aprobación del Home', accountServiceConnected: 'Servicio de cuenta conectado', homeAdded: 'Home añadido' },
    errors: { provider: { title: 'El proveedor no completó el inicio de sesión', body: 'Vuelve a los ajustes de cuenta e inicia sesión de nuevo.' }, expired: { title: 'Esta solicitud de inicio de sesión ha caducado', body: 'Empieza de nuevo desde los ajustes de cuenta.' }, identityChanged: { title: 'La identidad del servicio de cuenta ha cambiado', body: 'Revisa el servicio en los ajustes de cuenta antes de volver a conectarlo.' }, unavailable: { title: 'El servicio de cuenta no está disponible', body: 'Comprueba el servicio e inténtalo de nuevo. Tus Homes existentes no cambiarán.' }, exchange: { title: 'No se pudo completar el inicio de sesión', body: 'No se guardaron credenciales del servicio de cuenta. Empieza de nuevo desde los ajustes de cuenta.' }, storage: { title: 'No se pudo guardar el inicio de sesión', body: 'Las credenciales de tus Homes existentes no cambiarán. Empieza de nuevo desde los ajustes de cuenta.' }, homeLink: { title: 'Sesión iniciada, pero no se pudo vincular este Home', body: 'Revisa la conexión del servicio de cuenta en los ajustes de cuenta.' }, directoryRefresh: { title: 'Sesión iniciada, pero no pudimos actualizar tu lista de Homes', body: 'La conexión del servicio de cuenta está lista. Actualiza los Homes de nuevo desde los ajustes de cuenta.' }, homeEnrollment: { title: 'Sesión iniciada, pero tu Home personal no se añadió', body: 'Abre los ajustes de cuenta para continuar conectando el Home.' }, invalid: { title: 'Esta solicitud de inicio de sesión ya no es válida', body: 'Empieza de nuevo desde los ajustes de cuenta.' } },
    actions: { openSettings: 'Abrir ajustes de cuenta', startAgain: 'Empezar de nuevo' },
} as const;

const fr = {
    title: 'Connexion au service de compte', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'L’annulation ne te déconnectera pas de tes Homes existants.', focusedHomePreserved: 'Le Home actif ne changera pas.',
    stages: { signingIn: 'Connexion au service de compte', findingHomes: 'Recherche de tes Homes', waitingApproval: 'En attente de l’approbation du Home', accountServiceConnected: 'Service de compte connecté', homeAdded: 'Home ajouté' },
    errors: { provider: { title: 'Le fournisseur n’a pas terminé la connexion', body: 'Retourne aux réglages du compte et recommence la connexion.' }, expired: { title: 'Cette demande de connexion a expiré', body: 'Recommence depuis les réglages du compte.' }, identityChanged: { title: 'L’identité du service de compte a changé', body: 'Vérifie le service dans les réglages du compte avant de le reconnecter.' }, unavailable: { title: 'Le service de compte est indisponible', body: 'Vérifie le service et réessaie. Tes Homes existants restent inchangés.' }, exchange: { title: 'La connexion n’a pas pu être terminée', body: 'Aucun identifiant du service de compte n’a été enregistré. Recommence depuis les réglages du compte.' }, storage: { title: 'La connexion n’a pas pu être enregistrée', body: 'Les identifiants de tes Homes existants restent inchangés. Recommence depuis les réglages du compte.' }, homeLink: { title: 'Connecté, mais ce Home n’a pas pu être lié', body: 'Vérifie la connexion au service de compte dans les réglages du compte.' }, directoryRefresh: { title: 'Connecté, mais la liste de tes Homes n’a pas pu être actualisée', body: 'La connexion au service de compte est prête. Actualise de nouveau les Homes dans les réglages du compte.' }, homeEnrollment: { title: 'Connecté, mais ton Home personnel n’a pas été ajouté', body: 'Ouvre les réglages du compte pour poursuivre la connexion du Home.' }, invalid: { title: 'Cette demande de connexion n’est plus valide', body: 'Recommence depuis les réglages du compte.' } },
    actions: { openSettings: 'Ouvrir les réglages du compte', startAgain: 'Recommencer' },
} as const;

const it = {
    title: 'Accesso al servizio account', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'L’annullamento non disconnetterà gli Home esistenti.', focusedHomePreserved: 'L’Home attivo non cambierà.',
    stages: { signingIn: 'Accesso al servizio account', findingHomes: 'Ricerca dei tuoi Home', waitingApproval: 'In attesa dell’approvazione dell’Home', accountServiceConnected: 'Servizio account connesso', homeAdded: 'Home aggiunto' },
    errors: { provider: { title: 'Il provider non ha completato l’accesso', body: 'Torna alle impostazioni dell’account e avvia di nuovo l’accesso.' }, expired: { title: 'Questa richiesta di accesso è scaduta', body: 'Ricomincia dalle impostazioni dell’account.' }, identityChanged: { title: 'L’identità del servizio account è cambiata', body: 'Controlla il servizio nelle impostazioni dell’account prima di riconnetterlo.' }, unavailable: { title: 'Il servizio account non è disponibile', body: 'Controlla il servizio e riprova. Gli Home esistenti non cambieranno.' }, exchange: { title: 'Impossibile completare l’accesso', body: 'Non sono state salvate credenziali del servizio account. Ricomincia dalle impostazioni dell’account.' }, storage: { title: 'Impossibile salvare l’accesso', body: 'Le credenziali degli Home esistenti non cambieranno. Ricomincia dalle impostazioni dell’account.' }, homeLink: { title: 'Accesso completato, ma non è stato possibile collegare questo Home', body: 'Controlla la connessione del servizio account nelle impostazioni dell’account.' }, directoryRefresh: { title: 'Accesso completato, ma non è stato possibile aggiornare l’elenco degli Home', body: 'La connessione del servizio account è pronta. Aggiorna di nuovo gli Home dalle impostazioni dell’account.' }, homeEnrollment: { title: 'Accesso completato, ma il tuo Home personale non è stato aggiunto', body: 'Apri le impostazioni dell’account per continuare a collegare l’Home.' }, invalid: { title: 'Questa richiesta di accesso non è più valida', body: 'Ricomincia dalle impostazioni dell’account.' } },
    actions: { openSettings: 'Apri impostazioni account', startAgain: 'Ricomincia' },
} as const;

const pt = {
    title: 'Início de sessão no serviço de conta', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Cancelar não termina a sessão nos Homes existentes.', focusedHomePreserved: 'O Home em foco não será alterado.',
    stages: { signingIn: 'A iniciar sessão no serviço de conta', findingHomes: 'A procurar os teus Homes', waitingApproval: 'A aguardar aprovação do Home', accountServiceConnected: 'Serviço de conta ligado', homeAdded: 'Home adicionado' },
    errors: { provider: { title: 'O fornecedor não concluiu o início de sessão', body: 'Volta às definições da conta e inicia a sessão novamente.' }, expired: { title: 'Este pedido de início de sessão expirou', body: 'Começa novamente nas definições da conta.' }, identityChanged: { title: 'A identidade do serviço de conta mudou', body: 'Revê o serviço nas definições da conta antes de voltar a ligar.' }, unavailable: { title: 'O serviço de conta está indisponível', body: 'Verifica o serviço e tenta novamente. Os Homes existentes permanecem inalterados.' }, exchange: { title: 'Não foi possível concluir o início de sessão', body: 'Não foram guardadas credenciais do serviço de conta. Começa novamente nas definições da conta.' }, storage: { title: 'Não foi possível guardar o início de sessão', body: 'As credenciais dos Homes existentes permanecem inalteradas. Começa novamente nas definições da conta.' }, homeLink: { title: 'Sessão iniciada, mas não foi possível ligar este Home', body: 'Revê a ligação do serviço de conta nas definições da conta.' }, directoryRefresh: { title: 'Sessão iniciada, mas não foi possível atualizar a lista de Homes', body: 'A ligação do serviço de conta está pronta. Atualiza os Homes novamente nas definições da conta.' }, homeEnrollment: { title: 'Sessão iniciada, mas o teu Home pessoal não foi adicionado', body: 'Abre as definições da conta para continuar a ligar o Home.' }, invalid: { title: 'Este pedido de início de sessão já não é válido', body: 'Começa novamente nas definições da conta.' } },
    actions: { openSettings: 'Abrir definições da conta', startAgain: 'Começar novamente' },
} as const;

const ca = {
    title: 'Inici de sessió al servei de compte', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'La cancel·lació no tancarà la sessió dels Homes existents.', focusedHomePreserved: 'El Home actiu no canviarà.',
    stages: { signingIn: 'Iniciant sessió al servei de compte', findingHomes: 'Cercant els teus Homes', waitingApproval: 'Esperant l’aprovació del Home', accountServiceConnected: 'Servei de compte connectat', homeAdded: 'Home afegit' },
    errors: { provider: { title: 'El proveïdor no ha completat l’inici de sessió', body: 'Torna a la configuració del compte i inicia la sessió de nou.' }, expired: { title: 'Aquesta sol·licitud d’inici de sessió ha caducat', body: 'Torna a començar des de la configuració del compte.' }, identityChanged: { title: 'La identitat del servei de compte ha canviat', body: 'Revisa el servei a la configuració del compte abans de tornar-lo a connectar.' }, unavailable: { title: 'El servei de compte no està disponible', body: 'Comprova el servei i torna-ho a provar. Els Homes existents no canviaran.' }, exchange: { title: 'No s’ha pogut completar l’inici de sessió', body: 'No s’han desat credencials del servei de compte. Torna a començar des de la configuració del compte.' }, storage: { title: 'No s’ha pogut desar l’inici de sessió', body: 'Les credencials dels Homes existents no canviaran. Torna a començar des de la configuració del compte.' }, homeLink: { title: 'Sessió iniciada, però no s’ha pogut enllaçar aquest Home', body: 'Revisa la connexió del servei de compte a la configuració del compte.' }, directoryRefresh: { title: 'Sessió iniciada, però no hem pogut actualitzar la llista de Homes', body: 'La connexió del servei de compte està preparada. Actualitza els Homes de nou des de la configuració del compte.' }, homeEnrollment: { title: 'Sessió iniciada, però el teu Home personal no s’ha afegit', body: 'Obre la configuració del compte per continuar connectant el Home.' }, invalid: { title: 'Aquesta sol·licitud d’inici de sessió ja no és vàlida', body: 'Torna a començar des de la configuració del compte.' } },
    actions: { openSettings: 'Obre la configuració del compte', startAgain: 'Torna a començar' },
} as const;

const pl = {
    title: 'Logowanie do usługi konta', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Anulowanie nie wyloguje Cię z istniejących Homes.', focusedHomePreserved: 'Wybrany Home nie zmieni się.',
    stages: { signingIn: 'Logowanie do usługi konta', findingHomes: 'Wyszukiwanie Twoich Homes', waitingApproval: 'Oczekiwanie na zatwierdzenie Home', accountServiceConnected: 'Usługa konta połączona', homeAdded: 'Home dodany' },
    errors: { provider: { title: 'Dostawca nie ukończył logowania', body: 'Wróć do ustawień konta i rozpocznij logowanie ponownie.' }, expired: { title: 'Ta prośba o logowanie wygasła', body: 'Rozpocznij ponownie w ustawieniach konta.' }, identityChanged: { title: 'Tożsamość usługi konta zmieniła się', body: 'Sprawdź usługę w ustawieniach konta przed ponownym połączeniem.' }, unavailable: { title: 'Usługa konta jest niedostępna', body: 'Sprawdź usługę i spróbuj ponownie. Istniejące Homes pozostaną bez zmian.' }, exchange: { title: 'Nie udało się ukończyć logowania', body: 'Nie zapisano danych logowania usługi konta. Rozpocznij ponownie w ustawieniach konta.' }, storage: { title: 'Nie udało się zapisać logowania', body: 'Dane logowania istniejących Homes pozostaną bez zmian. Rozpocznij ponownie w ustawieniach konta.' }, homeLink: { title: 'Zalogowano, ale nie udało się połączyć tego Home', body: 'Sprawdź połączenie z usługą konta w ustawieniach konta.' }, directoryRefresh: { title: 'Zalogowano, ale nie udało się odświeżyć listy Homes', body: 'Połączenie z usługą konta jest gotowe. Odśwież Homes ponownie w ustawieniach konta.' }, homeEnrollment: { title: 'Zalogowano, ale osobisty Home nie został dodany', body: 'Otwórz ustawienia konta, aby kontynuować łączenie Home.' }, invalid: { title: 'Ta prośba o logowanie nie jest już ważna', body: 'Rozpocznij ponownie w ustawieniach konta.' } },
    actions: { openSettings: 'Otwórz ustawienia konta', startAgain: 'Rozpocznij ponownie' },
} as const;

const ru = {
    title: 'Вход в службу аккаунта', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Отмена не приведёт к выходу из существующих Homes.', focusedHomePreserved: 'Текущий Home не изменится.',
    stages: { signingIn: 'Вход в службу аккаунта', findingHomes: 'Поиск ваших Homes', waitingApproval: 'Ожидание одобрения Home', accountServiceConnected: 'Служба аккаунта подключена', homeAdded: 'Home добавлен' },
    errors: { provider: { title: 'Провайдер не завершил вход', body: 'Вернитесь в настройки аккаунта и начните вход заново.' }, expired: { title: 'Срок действия запроса на вход истёк', body: 'Начните заново в настройках аккаунта.' }, identityChanged: { title: 'Идентификатор службы аккаунта изменился', body: 'Проверьте службу в настройках аккаунта перед повторным подключением.' }, unavailable: { title: 'Служба аккаунта недоступна', body: 'Проверьте службу и повторите попытку. Существующие Homes не изменятся.' }, exchange: { title: 'Не удалось завершить вход', body: 'Учётные данные службы аккаунта не сохранены. Начните заново в настройках аккаунта.' }, storage: { title: 'Не удалось сохранить вход', body: 'Учётные данные существующих Homes не изменятся. Начните заново в настройках аккаунта.' }, homeLink: { title: 'Вход выполнен, но этот Home не удалось связать', body: 'Проверьте подключение службы аккаунта в настройках аккаунта.' }, directoryRefresh: { title: 'Вход выполнен, но список Homes не удалось обновить', body: 'Подключение службы аккаунта готово. Обновите Homes ещё раз в настройках аккаунта.' }, homeEnrollment: { title: 'Вход выполнен, но личный Home не добавлен', body: 'Откройте настройки аккаунта, чтобы продолжить подключение Home.' }, invalid: { title: 'Этот запрос на вход больше недействителен', body: 'Начните заново в настройках аккаунта.' } },
    actions: { openSettings: 'Открыть настройки аккаунта', startAgain: 'Начать заново' },
} as const;

const ja = {
    title: 'アカウントサービスへのサインイン', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'キャンセルしても既存の Home からはサインアウトされません。', focusedHomePreserved: '現在の Home は変更されません。',
    stages: { signingIn: 'アカウントサービスにサインイン中', findingHomes: 'Home を検索中', waitingApproval: 'Home の承認を待っています', accountServiceConnected: 'アカウントサービスに接続しました', homeAdded: 'Home を追加しました' },
    errors: { provider: { title: 'プロバイダーがサインインを完了しませんでした', body: 'アカウント設定に戻り、もう一度サインインしてください。' }, expired: { title: 'このサインイン要求は期限切れです', body: 'アカウント設定からやり直してください。' }, identityChanged: { title: 'アカウントサービスの識別情報が変更されました', body: '再接続する前にアカウント設定でサービスを確認してください。' }, unavailable: { title: 'アカウントサービスを利用できません', body: 'サービスを確認して再試行してください。既存の Home は変更されません。' }, exchange: { title: 'サインインを完了できませんでした', body: 'アカウントサービスの認証情報は保存されていません。アカウント設定からやり直してください。' }, storage: { title: 'サインインを保存できませんでした', body: '既存の Home の認証情報は変更されません。アカウント設定からやり直してください。' }, homeLink: { title: 'サインインしましたが、この Home をリンクできませんでした', body: 'アカウント設定でアカウントサービスの接続を確認してください。' }, directoryRefresh: { title: 'サインインしましたが、Home 一覧を更新できませんでした', body: 'アカウントサービスへの接続は完了しています。アカウント設定から Home をもう一度更新してください。' }, homeEnrollment: { title: 'サインインしましたが、Personal Home は追加されませんでした', body: 'アカウント設定を開いて Home の接続を続けてください。' }, invalid: { title: 'このサインイン要求は無効です', body: 'アカウント設定からやり直してください。' } },
    actions: { openSettings: 'アカウント設定を開く', startAgain: 'やり直す' },
} as const;

const zhHans = {
    title: '登录账户服务', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: '取消不会退出你现有的 Home。', focusedHomePreserved: '当前聚焦的 Home 不会改变。',
    stages: { signingIn: '正在登录账户服务', findingHomes: '正在查找你的 Homes', waitingApproval: '正在等待 Home 批准', accountServiceConnected: '账户服务已连接', homeAdded: 'Home 已添加' },
    errors: { provider: { title: '提供方未完成登录', body: '返回账户设置并重新开始登录。' }, expired: { title: '此登录请求已过期', body: '请从账户设置重新开始。' }, identityChanged: { title: '账户服务身份已更改', body: '重新连接前，请在账户设置中检查此服务。' }, unavailable: { title: '账户服务不可用', body: '检查服务后重试。现有 Homes 不会改变。' }, exchange: { title: '无法完成登录', body: '未保存账户服务凭据。请从账户设置重新开始。' }, storage: { title: '无法保存登录', body: '现有 Home 凭据不会改变。请从账户设置重新开始。' }, homeLink: { title: '已登录，但无法关联此 Home', body: '请在账户设置中检查账户服务连接。' }, directoryRefresh: { title: '已登录，但无法刷新 Home 列表', body: '账户服务连接已就绪。请从账户设置再次刷新 Homes。' }, homeEnrollment: { title: '已登录，但未添加 Personal Home', body: '打开账户设置以继续连接 Home。' }, invalid: { title: '此登录请求已失效', body: '请从账户设置重新开始。' } },
    actions: { openSettings: '打开账户设置', startAgain: '重新开始' },
} as const;

const zhHant = {
    title: '登入帳號服務', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: '取消不會登出你現有的 Home。', focusedHomePreserved: '目前聚焦的 Home 不會變更。',
    stages: { signingIn: '正在登入帳號服務', findingHomes: '正在尋找你的 Homes', waitingApproval: '正在等待 Home 核准', accountServiceConnected: '帳號服務已連線', homeAdded: 'Home 已新增' },
    errors: { provider: { title: '提供者未完成登入', body: '返回帳號設定並重新開始登入。' }, expired: { title: '此登入要求已過期', body: '請從帳號設定重新開始。' }, identityChanged: { title: '帳號服務身分已變更', body: '重新連接前，請在帳號設定中檢查此服務。' }, unavailable: { title: '帳號服務無法使用', body: '檢查服務後再試一次。現有 Homes 不會變更。' }, exchange: { title: '無法完成登入', body: '未儲存帳號服務憑證。請從帳號設定重新開始。' }, storage: { title: '無法儲存登入', body: '現有 Home 憑證不會變更。請從帳號設定重新開始。' }, homeLink: { title: '已登入，但無法連結此 Home', body: '請在帳號設定中檢查帳號服務連線。' }, directoryRefresh: { title: '已登入，但無法重新整理 Home 清單', body: '帳號服務連線已就緒。請從帳號設定再次重新整理 Homes。' }, homeEnrollment: { title: '已登入，但未新增 Personal Home', body: '開啟帳號設定以繼續連接 Home。' }, invalid: { title: '此登入要求已失效', body: '請從帳號設定重新開始。' } },
    actions: { openSettings: '開啟帳號設定', startAgain: '重新開始' },
} as const;

export const accountServiceOAuthTranslations = {
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
