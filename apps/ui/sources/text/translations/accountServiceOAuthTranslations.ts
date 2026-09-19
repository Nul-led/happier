const en = {
    title: 'Sign in to find your Homes',
    serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Canceling won’t sign you out of your existing Homes.',
    focusedHomePreserved: 'Your focused Home won’t change.',
    stages: {
        signingIn: 'Signing in',
        findingHomes: 'Finding your Homes',
        waitingApproval: 'Waiting for Home approval',
        homeAdded: 'Home added',
    },
    errors: {
        provider: { title: 'The provider did not complete sign-in', body: 'Return to Account settings and start the sign-in again.' },
        expired: { title: 'This sign-in request expired', body: 'Start again from Account settings.' },
        identityChanged: { title: 'The sign-in service identity changed', body: 'Review the service in Account settings before reconnecting.' },
        unavailable: { title: 'The sign-in service is unavailable', body: 'Check the service and try again. Your existing Homes are unchanged.' },
        exchange: { title: 'Sign-in could not be completed', body: 'No sign-in service credential was saved. Start again from Account settings.' },
        storage: { title: 'Sign-in could not be saved', body: 'Your existing Home credentials are unchanged. Start again from Account settings.' },
        homeLink: { title: 'Signed in, but this Home could not be linked', body: 'Review the sign-in service connection in Account settings.' },
        directoryRefresh: { title: 'Signed in, but we couldn’t refresh your Home list', body: 'Your sign-in service connection is ready. Try the Home refresh again from Account settings.' },
        homeEnrollment: { title: 'Signed in, but your Personal Home was not added', body: 'Open Account settings to continue connecting the Home.' },
        invalid: { title: 'This sign-in request is no longer valid', body: 'Start again from Account settings.' }, accountDisabled: { title: 'This account is disabled', body: 'Contact the administrator of your sign-in service. Your existing Homes are unchanged.' },
    },
    actions: {
        openSettings: 'Open Account Settings',
        startAgain: 'Start Again',
    },
    approvalWait: {
        approveDeviceTitle: 'Approve this device',
        approveDeviceBody: ({ homeName }: { homeName: string }) => `Continue on a device already connected to ${homeName}.`,
        waitingBody: 'Approve this sign-in from your other signed-in device.',
        expiredBody: 'This request ran out of time. Start again when you are ready.',
        cancelledTitle: 'Stopped waiting for approval',
        cancelledBody: 'Your sign-in is still saved and your existing Homes are unchanged.',
    },
} as const;

const de = {
    title: 'Anmelden, um deine Homes zu finden', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Beim Abbrechen bleibst du bei deinen bestehenden Homes angemeldet.', focusedHomePreserved: 'Dein fokussiertes Home ändert sich nicht.',
    stages: { signingIn: 'Anmeldung läuft', findingHomes: 'Deine Homes werden gesucht', waitingApproval: 'Auf Home-Genehmigung warten', homeAdded: 'Home hinzugefügt' },
    errors: { provider: { title: 'Der Anbieter hat die Anmeldung nicht abgeschlossen', body: 'Kehre zu den Kontoeinstellungen zurück und starte die Anmeldung erneut.' }, expired: { title: 'Diese Anmeldeanfrage ist abgelaufen', body: 'Starte erneut in den Kontoeinstellungen.' }, identityChanged: { title: 'Die Identität des Anmeldedienstes hat sich geändert', body: 'Prüfe den Dienst in den Kontoeinstellungen, bevor du ihn erneut verbindest.' }, unavailable: { title: 'Der Anmeldedienst ist nicht verfügbar', body: 'Prüfe den Dienst und versuche es erneut. Deine bestehenden Homes bleiben unverändert.' }, exchange: { title: 'Die Anmeldung konnte nicht abgeschlossen werden', body: 'Es wurden keine Zugangsdaten für den Anmeldedienst gespeichert. Starte erneut in den Kontoeinstellungen.' }, storage: { title: 'Die Anmeldung konnte nicht gespeichert werden', body: 'Deine bestehenden Home-Zugangsdaten bleiben unverändert. Starte erneut in den Kontoeinstellungen.' }, homeLink: { title: 'Angemeldet, aber dieses Home konnte nicht verknüpft werden', body: 'Prüfe die Verbindung zum Anmeldedienst in den Kontoeinstellungen.' }, directoryRefresh: { title: 'Angemeldet, aber deine Home-Liste konnte nicht aktualisiert werden', body: 'Die Verbindung zum Anmeldedienst ist bereit. Aktualisiere die Homes erneut in den Kontoeinstellungen.' }, homeEnrollment: { title: 'Angemeldet, aber dein persönliches Home wurde nicht hinzugefügt', body: 'Öffne die Kontoeinstellungen, um die Verbindung fortzusetzen.' }, invalid: { title: 'Diese Anmeldeanfrage ist nicht mehr gültig', body: 'Starte erneut in den Kontoeinstellungen.' }, accountDisabled: { title: 'Dieses Konto ist deaktiviert', body: 'Wende dich an die Verwaltung deines Anmeldedienstes. Deine bestehenden Homes bleiben unverändert.' } },
    actions: { openSettings: 'Kontoeinstellungen öffnen', startAgain: 'Neu starten' },
    approvalWait: { approveDeviceTitle: 'Dieses Gerät genehmigen', approveDeviceBody: ({ homeName }: { homeName: string }) => `Fahre auf einem Gerät fort, das bereits mit ${homeName} verbunden ist.`, waitingBody: 'Genehmige diese Anmeldung auf deinem anderen angemeldeten Gerät.', expiredBody: 'Die Zeit dieser Anfrage ist abgelaufen. Starte erneut, wenn du bereit bist.', cancelledTitle: 'Warten auf Genehmigung beendet', cancelledBody: 'Deine Anmeldung bleibt gespeichert und deine bestehenden Homes bleiben unverändert.' },
} as const;

const es = {
    title: 'Inicia sesión para encontrar tus Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Cancelar no cerrará la sesión de tus Homes existentes.', focusedHomePreserved: 'Tu Home enfocado no cambiará.',
    stages: { signingIn: 'Iniciando sesión', findingHomes: 'Buscando tus Homes', waitingApproval: 'Esperando la aprobación del Home', homeAdded: 'Home añadido' },
    errors: { provider: { title: 'El proveedor no completó el inicio de sesión', body: 'Vuelve a los ajustes de cuenta e inicia sesión de nuevo.' }, expired: { title: 'Esta solicitud de inicio de sesión ha caducado', body: 'Empieza de nuevo desde los ajustes de cuenta.' }, identityChanged: { title: 'La identidad del servicio de inicio de sesión ha cambiado', body: 'Revisa el servicio en los ajustes de cuenta antes de volver a conectarlo.' }, unavailable: { title: 'El servicio de inicio de sesión no está disponible', body: 'Comprueba el servicio e inténtalo de nuevo. Tus Homes existentes no cambiarán.' }, exchange: { title: 'No se pudo completar el inicio de sesión', body: 'No se guardaron credenciales del servicio de inicio de sesión. Empieza de nuevo desde los ajustes de cuenta.' }, storage: { title: 'No se pudo guardar el inicio de sesión', body: 'Las credenciales de tus Homes existentes no cambiarán. Empieza de nuevo desde los ajustes de cuenta.' }, homeLink: { title: 'Sesión iniciada, pero no se pudo vincular este Home', body: 'Revisa la conexión del servicio de inicio de sesión en los ajustes de cuenta.' }, directoryRefresh: { title: 'Sesión iniciada, pero no pudimos actualizar tu lista de Homes', body: 'La conexión del servicio de inicio de sesión está lista. Actualiza los Homes de nuevo desde los ajustes de cuenta.' }, homeEnrollment: { title: 'Sesión iniciada, pero tu Home personal no se añadió', body: 'Abre los ajustes de cuenta para continuar conectando el Home.' }, invalid: { title: 'Esta solicitud de inicio de sesión ya no es válida', body: 'Empieza de nuevo desde los ajustes de cuenta.' }, accountDisabled: { title: 'Esta cuenta está desactivada', body: 'Contacta con quien administra tu servicio de inicio de sesión. Tus Homes existentes no cambiarán.' } },
    actions: { openSettings: 'Abrir ajustes de cuenta', startAgain: 'Empezar de nuevo' },
    approvalWait: { approveDeviceTitle: 'Aprobar este dispositivo', approveDeviceBody: ({ homeName }: { homeName: string }) => `Continúa en un dispositivo que ya esté conectado a ${homeName}.`, waitingBody: 'Aprueba este inicio de sesión desde tu otro dispositivo con sesión iniciada.', expiredBody: 'Esta solicitud agotó su tiempo. Vuelve a empezar cuando estés listo.', cancelledTitle: 'Se dejó de esperar la aprobación', cancelledBody: 'Tu inicio de sesión sigue guardado y tus Homes existentes no cambian.' },
} as const;

const fr = {
    title: 'Se connecter pour trouver tes Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'L’annulation ne te déconnectera pas de tes Homes existants.', focusedHomePreserved: 'Le Home actif ne changera pas.',
    stages: { signingIn: 'Connexion en cours', findingHomes: 'Recherche de tes Homes', waitingApproval: 'En attente de l’approbation du Home', homeAdded: 'Home ajouté' },
    errors: { provider: { title: 'Le fournisseur n’a pas terminé la connexion', body: 'Retourne aux réglages du compte et recommence la connexion.' }, expired: { title: 'Cette demande de connexion a expiré', body: 'Recommence depuis les réglages du compte.' }, identityChanged: { title: 'L’identité du service de connexion a changé', body: 'Vérifie le service dans les réglages du compte avant de le reconnecter.' }, unavailable: { title: 'Le service de connexion est indisponible', body: 'Vérifie le service et réessaie. Tes Homes existants restent inchangés.' }, exchange: { title: 'La connexion n’a pas pu être terminée', body: 'Aucun identifiant du service de connexion n’a été enregistré. Recommence depuis les réglages du compte.' }, storage: { title: 'La connexion n’a pas pu être enregistrée', body: 'Les identifiants de tes Homes existants restent inchangés. Recommence depuis les réglages du compte.' }, homeLink: { title: 'Connecté, mais ce Home n’a pas pu être lié', body: 'Vérifie la connexion au service de connexion dans les réglages du compte.' }, directoryRefresh: { title: 'Connecté, mais la liste de tes Homes n’a pas pu être actualisée', body: 'La connexion au service de connexion est prête. Actualise de nouveau les Homes dans les réglages du compte.' }, homeEnrollment: { title: 'Connecté, mais ton Home personnel n’a pas été ajouté', body: 'Ouvre les réglages du compte pour poursuivre la connexion du Home.' }, invalid: { title: 'Cette demande de connexion n’est plus valide', body: 'Recommence depuis les réglages du compte.' }, accountDisabled: { title: 'Ce compte est désactivé', body: 'Contactez l’administrateur de votre service de connexion. Vos Homes existants restent inchangés.' } },
    actions: { openSettings: 'Ouvrir les réglages du compte', startAgain: 'Recommencer' },
    approvalWait: { approveDeviceTitle: 'Approuver cet appareil', approveDeviceBody: ({ homeName }: { homeName: string }) => `Continue sur un appareil déjà connecté à ${homeName}.`, waitingBody: 'Approuve cette connexion depuis ton autre appareil déjà connecté.', expiredBody: 'Le temps de cette demande est écoulé. Recommence quand tu es prêt.', cancelledTitle: 'Attente de l’approbation terminée', cancelledBody: 'Ta connexion reste enregistrée et tes Homes existants ne changent pas.' },
} as const;

const it = {
    title: 'Accedi per trovare i tuoi Home', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'L’annullamento non disconnetterà gli Home esistenti.', focusedHomePreserved: 'L’Home attivo non cambierà.',
    stages: { signingIn: 'Accesso in corso', findingHomes: 'Ricerca dei tuoi Home', waitingApproval: 'In attesa dell’approvazione dell’Home', homeAdded: 'Home aggiunto' },
    errors: { provider: { title: 'Il provider non ha completato l’accesso', body: 'Torna alle impostazioni dell’account e avvia di nuovo l’accesso.' }, expired: { title: 'Questa richiesta di accesso è scaduta', body: 'Ricomincia dalle impostazioni dell’account.' }, identityChanged: { title: 'L’identità del servizio di accesso è cambiata', body: 'Controlla il servizio nelle impostazioni dell’account prima di riconnetterlo.' }, unavailable: { title: 'Il servizio di accesso non è disponibile', body: 'Controlla il servizio e riprova. Gli Home esistenti non cambieranno.' }, exchange: { title: 'Impossibile completare l’accesso', body: 'Non sono state salvate credenziali del servizio di accesso. Ricomincia dalle impostazioni dell’account.' }, storage: { title: 'Impossibile salvare l’accesso', body: 'Le credenziali degli Home esistenti non cambieranno. Ricomincia dalle impostazioni dell’account.' }, homeLink: { title: 'Accesso completato, ma non è stato possibile collegare questo Home', body: 'Controlla la connessione del servizio di accesso nelle impostazioni dell’account.' }, directoryRefresh: { title: 'Accesso completato, ma non è stato possibile aggiornare l’elenco degli Home', body: 'La connessione del servizio di accesso è pronta. Aggiorna di nuovo gli Home dalle impostazioni dell’account.' }, homeEnrollment: { title: 'Accesso completato, ma il tuo Home personale non è stato aggiunto', body: 'Apri le impostazioni dell’account per continuare a collegare l’Home.' }, invalid: { title: 'Questa richiesta di accesso non è più valida', body: 'Ricomincia dalle impostazioni dell’account.' }, accountDisabled: { title: 'Questo account è disattivato', body: 'Contatta chi amministra il tuo servizio di accesso. I tuoi Home esistenti restano invariati.' } },
    actions: { openSettings: 'Apri impostazioni account', startAgain: 'Ricomincia' },
    approvalWait: { approveDeviceTitle: 'Approva questo dispositivo', approveDeviceBody: ({ homeName }: { homeName: string }) => `Continua su un dispositivo già connesso a ${homeName}.`, waitingBody: 'Approva questo accesso dall’altro dispositivo su cui hai effettuato l’accesso.', expiredBody: 'Il tempo di questa richiesta è scaduto. Ricomincia quando vuoi.', cancelledTitle: 'Attesa dell’approvazione terminata', cancelledBody: 'L’accesso rimane salvato e gli Home esistenti non cambiano.' },
} as const;

const pt = {
    title: 'Inicia sessão para encontrar os teus Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Cancelar não termina a sessão nos Homes existentes.', focusedHomePreserved: 'O Home em foco não será alterado.',
    stages: { signingIn: 'A iniciar sessão', findingHomes: 'A procurar os teus Homes', waitingApproval: 'A aguardar aprovação do Home', homeAdded: 'Home adicionado' },
    errors: { provider: { title: 'O fornecedor não concluiu o início de sessão', body: 'Volta às definições da conta e inicia a sessão novamente.' }, expired: { title: 'Este pedido de início de sessão expirou', body: 'Começa novamente nas definições da conta.' }, identityChanged: { title: 'A identidade do serviço de início de sessão mudou', body: 'Revê o serviço nas definições da conta antes de voltar a ligar.' }, unavailable: { title: 'O serviço de início de sessão está indisponível', body: 'Verifica o serviço e tenta novamente. Os Homes existentes permanecem inalterados.' }, exchange: { title: 'Não foi possível concluir o início de sessão', body: 'Não foram guardadas credenciais do serviço de início de sessão. Começa novamente nas definições da conta.' }, storage: { title: 'Não foi possível guardar o início de sessão', body: 'As credenciais dos Homes existentes permanecem inalteradas. Começa novamente nas definições da conta.' }, homeLink: { title: 'Sessão iniciada, mas não foi possível ligar este Home', body: 'Revê a ligação do serviço de início de sessão nas definições da conta.' }, directoryRefresh: { title: 'Sessão iniciada, mas não foi possível atualizar a lista de Homes', body: 'A ligação do serviço de início de sessão está pronta. Atualiza os Homes novamente nas definições da conta.' }, homeEnrollment: { title: 'Sessão iniciada, mas o teu Home pessoal não foi adicionado', body: 'Abre as definições da conta para continuar a ligar o Home.' }, invalid: { title: 'Este pedido de início de sessão já não é válido', body: 'Começa novamente nas definições da conta.' }, accountDisabled: { title: 'Esta conta está desativada', body: 'Contacta o administrador do teu serviço de início de sessão. Os teus Homes existentes permanecem inalterados.' } },
    actions: { openSettings: 'Abrir definições da conta', startAgain: 'Começar novamente' },
    approvalWait: { approveDeviceTitle: 'Aprovar este dispositivo', approveDeviceBody: ({ homeName }: { homeName: string }) => `Continua num dispositivo que já esteja ligado a ${homeName}.`, waitingBody: 'Aprova este início de sessão no teu outro dispositivo com sessão iniciada.', expiredBody: 'O tempo deste pedido esgotou-se. Começa de novo quando quiseres.', cancelledTitle: 'Deixou de esperar a aprovação', cancelledBody: 'O teu início de sessão continua guardado e os Homes existentes não mudam.' },
} as const;

const ca = {
    title: 'Inicia la sessió per trobar els teus Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'La cancel·lació no tancarà la sessió dels Homes existents.', focusedHomePreserved: 'El Home actiu no canviarà.',
    stages: { signingIn: 'Iniciant sessió', findingHomes: 'Cercant els teus Homes', waitingApproval: 'Esperant l’aprovació del Home', homeAdded: 'Home afegit' },
    errors: { provider: { title: 'El proveïdor no ha completat l’inici de sessió', body: 'Torna a la configuració del compte i inicia la sessió de nou.' }, expired: { title: 'Aquesta sol·licitud d’inici de sessió ha caducat', body: 'Torna a començar des de la configuració del compte.' }, identityChanged: { title: 'La identitat del servei d’inici de sessió ha canviat', body: 'Revisa el servei a la configuració del compte abans de tornar-lo a connectar.' }, unavailable: { title: 'El servei d’inici de sessió no està disponible', body: 'Comprova el servei i torna-ho a provar. Els Homes existents no canviaran.' }, exchange: { title: 'No s’ha pogut completar l’inici de sessió', body: 'No s’han desat credencials del servei d’inici de sessió. Torna a començar des de la configuració del compte.' }, storage: { title: 'No s’ha pogut desar l’inici de sessió', body: 'Les credencials dels Homes existents no canviaran. Torna a començar des de la configuració del compte.' }, homeLink: { title: 'Sessió iniciada, però no s’ha pogut enllaçar aquest Home', body: 'Revisa la connexió del servei d’inici de sessió a la configuració del compte.' }, directoryRefresh: { title: 'Sessió iniciada, però no hem pogut actualitzar la llista de Homes', body: 'La connexió del servei d’inici de sessió està preparada. Actualitza els Homes de nou des de la configuració del compte.' }, homeEnrollment: { title: 'Sessió iniciada, però el teu Home personal no s’ha afegit', body: 'Obre la configuració del compte per continuar connectant el Home.' }, invalid: { title: 'Aquesta sol·licitud d’inici de sessió ja no és vàlida', body: 'Torna a començar des de la configuració del compte.' }, accountDisabled: { title: 'Aquest compte està desactivat', body: 'Contacta amb qui administra el teu servei d’inici de sessió. Els teus Homes existents no canvien.' } },
    actions: { openSettings: 'Obre la configuració del compte', startAgain: 'Torna a començar' },
    approvalWait: { approveDeviceTitle: 'Aprova aquest dispositiu', approveDeviceBody: ({ homeName }: { homeName: string }) => `Continua en un dispositiu que ja estigui connectat a ${homeName}.`, waitingBody: 'Aprova aquest inici de sessió des del teu altre dispositiu amb sessió iniciada.', expiredBody: 'Aquesta sol·licitud ha esgotat el temps. Torna a començar quan vulguis.', cancelledTitle: 'Has deixat d’esperar l’aprovació', cancelledBody: 'El teu inici de sessió continua desat i els Homes existents no canvien.' },
} as const;

const pl = {
    title: 'Zaloguj się, aby znaleźć swoje Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Anulowanie nie wyloguje Cię z istniejących Homes.', focusedHomePreserved: 'Wybrany Home nie zmieni się.',
    stages: { signingIn: 'Logowanie', findingHomes: 'Wyszukiwanie Twoich Homes', waitingApproval: 'Oczekiwanie na zatwierdzenie Home', homeAdded: 'Home dodany' },
    errors: { provider: { title: 'Dostawca nie ukończył logowania', body: 'Wróć do ustawień konta i rozpocznij logowanie ponownie.' }, expired: { title: 'Ta prośba o logowanie wygasła', body: 'Rozpocznij ponownie w ustawieniach konta.' }, identityChanged: { title: 'Tożsamość usługi logowania zmieniła się', body: 'Sprawdź usługę w ustawieniach konta przed ponownym połączeniem.' }, unavailable: { title: 'Usługa logowania jest niedostępna', body: 'Sprawdź usługę i spróbuj ponownie. Istniejące Homes pozostaną bez zmian.' }, exchange: { title: 'Nie udało się ukończyć logowania', body: 'Nie zapisano danych logowania usługi logowania. Rozpocznij ponownie w ustawieniach konta.' }, storage: { title: 'Nie udało się zapisać logowania', body: 'Dane logowania istniejących Homes pozostaną bez zmian. Rozpocznij ponownie w ustawieniach konta.' }, homeLink: { title: 'Zalogowano, ale nie udało się połączyć tego Home', body: 'Sprawdź połączenie z usługą logowania w ustawieniach konta.' }, directoryRefresh: { title: 'Zalogowano, ale nie udało się odświeżyć listy Homes', body: 'Połączenie z usługą logowania jest gotowe. Odśwież Homes ponownie w ustawieniach konta.' }, homeEnrollment: { title: 'Zalogowano, ale osobisty Home nie został dodany', body: 'Otwórz ustawienia konta, aby kontynuować łączenie Home.' }, invalid: { title: 'Ta prośba o logowanie nie jest już ważna', body: 'Rozpocznij ponownie w ustawieniach konta.' }, accountDisabled: { title: 'To konto jest wyłączone', body: 'Skontaktuj się z administratorem usługi logowania. Twoje istniejące Homes pozostają bez zmian.' } },
    actions: { openSettings: 'Otwórz ustawienia konta', startAgain: 'Rozpocznij ponownie' },
    approvalWait: { approveDeviceTitle: 'Zatwierdź to urządzenie', approveDeviceBody: ({ homeName }: { homeName: string }) => `Kontynuuj na urządzeniu, które jest już połączone z ${homeName}.`, waitingBody: 'Zatwierdź to logowanie na innym zalogowanym urządzeniu.', expiredBody: 'Czas tego żądania minął. Zacznij ponownie, kiedy będziesz gotowy.', cancelledTitle: 'Zakończono oczekiwanie na zatwierdzenie', cancelledBody: 'Logowanie pozostało zapisane, a istniejące Homes pozostały bez zmian.' },
} as const;

const ru = {
    title: 'Войдите, чтобы найти свои Homes', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'Отмена не приведёт к выходу из существующих Homes.', focusedHomePreserved: 'Текущий Home не изменится.',
    stages: { signingIn: 'Выполняется вход', findingHomes: 'Поиск ваших Homes', waitingApproval: 'Ожидание одобрения Home', homeAdded: 'Home добавлен' },
    errors: { provider: { title: 'Провайдер не завершил вход', body: 'Вернитесь в настройки аккаунта и начните вход заново.' }, expired: { title: 'Срок действия запроса на вход истёк', body: 'Начните заново в настройках аккаунта.' }, identityChanged: { title: 'Идентификатор службы входа изменился', body: 'Проверьте службу в настройках аккаунта перед повторным подключением.' }, unavailable: { title: 'Служба входа недоступна', body: 'Проверьте службу и повторите попытку. Существующие Homes не изменятся.' }, exchange: { title: 'Не удалось завершить вход', body: 'Учётные данные службы входа не сохранены. Начните заново в настройках аккаунта.' }, storage: { title: 'Не удалось сохранить вход', body: 'Учётные данные существующих Homes не изменятся. Начните заново в настройках аккаунта.' }, homeLink: { title: 'Вход выполнен, но этот Home не удалось связать', body: 'Проверьте подключение службы входа в настройках аккаунта.' }, directoryRefresh: { title: 'Вход выполнен, но список Homes не удалось обновить', body: 'Подключение службы входа готово. Обновите Homes ещё раз в настройках аккаунта.' }, homeEnrollment: { title: 'Вход выполнен, но личный Home не добавлен', body: 'Откройте настройки аккаунта, чтобы продолжить подключение Home.' }, invalid: { title: 'Этот запрос на вход больше недействителен', body: 'Начните заново в настройках аккаунта.' }, accountDisabled: { title: 'Этот аккаунт отключён', body: 'Обратитесь к администратору службы входа. Ваши существующие Homes не изменятся.' } },
    actions: { openSettings: 'Открыть настройки аккаунта', startAgain: 'Начать заново' },
    approvalWait: { approveDeviceTitle: 'Подтвердить это устройство', approveDeviceBody: ({ homeName }: { homeName: string }) => `Продолжите на устройстве, которое уже подключено к ${homeName}.`, waitingBody: 'Подтвердите этот вход на другом устройстве, где вы уже вошли.', expiredBody: 'Время этого запроса истекло. Начните заново, когда будете готовы.', cancelledTitle: 'Ожидание одобрения прекращено', cancelledBody: 'Вход сохранён, существующие Homes не изменились.' },
} as const;

const ja = {
    title: 'サインインして Home を見つける', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: 'キャンセルしても既存の Home からはサインアウトされません。', focusedHomePreserved: '現在の Home は変更されません。',
    stages: { signingIn: 'サインイン中', findingHomes: 'Home を検索中', waitingApproval: 'Home の承認を待っています', homeAdded: 'Home を追加しました' },
    errors: { provider: { title: 'プロバイダーがサインインを完了しませんでした', body: 'アカウント設定に戻り、もう一度サインインしてください。' }, expired: { title: 'このサインイン要求は期限切れです', body: 'アカウント設定からやり直してください。' }, identityChanged: { title: 'サインインサービスの識別情報が変更されました', body: '再接続する前にアカウント設定でサービスを確認してください。' }, unavailable: { title: 'サインインサービスを利用できません', body: 'サービスを確認して再試行してください。既存の Home は変更されません。' }, exchange: { title: 'サインインを完了できませんでした', body: 'サインインサービスの認証情報は保存されていません。アカウント設定からやり直してください。' }, storage: { title: 'サインインを保存できませんでした', body: '既存の Home の認証情報は変更されません。アカウント設定からやり直してください。' }, homeLink: { title: 'サインインしましたが、この Home をリンクできませんでした', body: 'アカウント設定でサインインサービスの接続を確認してください。' }, directoryRefresh: { title: 'サインインしましたが、Home 一覧を更新できませんでした', body: 'サインインサービスへの接続は完了しています。アカウント設定から Home をもう一度更新してください。' }, homeEnrollment: { title: 'サインインしましたが、Personal Home は追加されませんでした', body: 'アカウント設定を開いて Home の接続を続けてください。' }, invalid: { title: 'このサインイン要求は無効です', body: 'アカウント設定からやり直してください。' }, accountDisabled: { title: 'このアカウントは無効化されています', body: 'サインインサービスの管理者に連絡してください。既存の Home は変更されません。' } },
    actions: { openSettings: 'アカウント設定を開く', startAgain: 'やり直す' },
    approvalWait: { approveDeviceTitle: 'このデバイスを承認', approveDeviceBody: ({ homeName }: { homeName: string }) => `${homeName} に接続済みのデバイスで続行してください。`, waitingBody: 'サインイン済みの別のデバイスでこのサインインを承認してください。', expiredBody: 'このリクエストの有効期限が切れました。準備ができたらやり直してください。', cancelledTitle: '承認の待機を終了しました', cancelledBody: 'サインインは保存されたままで、既存の Home は変更されません。' },
} as const;

const zhHans = {
    title: '登录以查找你的 Home', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: '取消不会退出你现有的 Home。', focusedHomePreserved: '当前聚焦的 Home 不会改变。',
    stages: { signingIn: '正在登录', findingHomes: '正在查找你的 Homes', waitingApproval: '正在等待 Home 批准', homeAdded: 'Home 已添加' },
    errors: { provider: { title: '提供方未完成登录', body: '返回账户设置并重新开始登录。' }, expired: { title: '此登录请求已过期', body: '请从账户设置重新开始。' }, identityChanged: { title: '登录服务身份已更改', body: '重新连接前，请在账户设置中检查此服务。' }, unavailable: { title: '登录服务不可用', body: '检查服务后重试。现有 Homes 不会改变。' }, exchange: { title: '无法完成登录', body: '未保存登录服务凭据。请从账户设置重新开始。' }, storage: { title: '无法保存登录', body: '现有 Home 凭据不会改变。请从账户设置重新开始。' }, homeLink: { title: '已登录，但无法关联此 Home', body: '请在账户设置中检查登录服务连接。' }, directoryRefresh: { title: '已登录，但无法刷新 Home 列表', body: '登录服务连接已就绪。请从账户设置再次刷新 Homes。' }, homeEnrollment: { title: '已登录，但未添加 Personal Home', body: '打开账户设置以继续连接 Home。' }, invalid: { title: '此登录请求已失效', body: '请从账户设置重新开始。' }, accountDisabled: { title: '此账户已被停用', body: '请联系登录服务的管理员。你现有的 Home 不会改变。' } },
    actions: { openSettings: '打开账户设置', startAgain: '重新开始' },
    approvalWait: { approveDeviceTitle: '批准此设备', approveDeviceBody: ({ homeName }: { homeName: string }) => `请在已连接到 ${homeName} 的设备上继续。`, waitingBody: '在你另一台已登录的设备上批准这次登录。', expiredBody: '此请求已超时。准备好后请重新开始。', cancelledTitle: '已停止等待批准', cancelledBody: '你的登录仍然保留，现有 Home 不会改变。' },
} as const;

const zhHant = {
    title: '登入以尋找你的 Home', serviceIdentity: ({ provider, host }: { provider: string; host: string }) => `${provider} · ${host}`,
    cancelNote: '取消不會登出你現有的 Home。', focusedHomePreserved: '目前聚焦的 Home 不會變更。',
    stages: { signingIn: '正在登入', findingHomes: '正在尋找你的 Homes', waitingApproval: '正在等待 Home 核准', homeAdded: 'Home 已新增' },
    errors: { provider: { title: '提供者未完成登入', body: '返回帳號設定並重新開始登入。' }, expired: { title: '此登入要求已過期', body: '請從帳號設定重新開始。' }, identityChanged: { title: '登入服務身分已變更', body: '重新連接前，請在帳號設定中檢查此服務。' }, unavailable: { title: '登入服務無法使用', body: '檢查服務後再試一次。現有 Homes 不會變更。' }, exchange: { title: '無法完成登入', body: '未儲存登入服務憑證。請從帳號設定重新開始。' }, storage: { title: '無法儲存登入', body: '現有 Home 憑證不會變更。請從帳號設定重新開始。' }, homeLink: { title: '已登入，但無法連結此 Home', body: '請在帳號設定中檢查登入服務連線。' }, directoryRefresh: { title: '已登入，但無法重新整理 Home 清單', body: '登入服務連線已就緒。請從帳號設定再次重新整理 Homes。' }, homeEnrollment: { title: '已登入，但未新增 Personal Home', body: '開啟帳號設定以繼續連接 Home。' }, invalid: { title: '此登入要求已失效', body: '請從帳號設定重新開始。' }, accountDisabled: { title: '此帳戶已停用', body: '請聯絡登入服務的管理員。你現有的 Home 不會改變。' } },
    actions: { openSettings: '開啟帳號設定', startAgain: '重新開始' },
    approvalWait: { approveDeviceTitle: '核准此裝置', approveDeviceBody: ({ homeName }: { homeName: string }) => `請在已連接到 ${homeName} 的裝置上繼續。`, waitingBody: '在你另一部已登入的裝置上核准這次登入。', expiredBody: '此要求已逾時。準備好後請重新開始。', cancelledTitle: '已停止等待核准', cancelledBody: '你的登入仍然保留，現有 Home 不會改變。' },
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
