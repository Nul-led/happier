const en = {
    title: 'Sign in to find your Homes',
    cancelNote: 'Canceling won’t sign you out of your existing Homes.',
    focusedHomePreserved: 'Your focused Home won’t change.',
    stages: {
        signingIn: 'Signing in',
        findingHomes: 'Finding your Homes',
        waitingApproval: 'Waiting for Home approval',
    },
    errors: {
        provider: { title: 'The provider did not complete sign-in', body: 'Start the sign-in again.' },
        expired: { title: 'This sign-in request expired', body: 'Start the sign-in again.' },
        identityChanged: { title: 'The sign-in service identity changed', body: 'Check that this is the sign-in service you meant to use before connecting again.' },
        unavailable: { title: 'The sign-in service is unavailable', body: 'Check the service and try again. Your existing Homes are unchanged.' },
        exchange: { title: 'Sign-in could not be completed', body: 'No sign-in service credential was saved. Start the sign-in again.' },
        storage: { title: 'Sign-in could not be saved', body: 'Your existing Home credentials are unchanged. Start the sign-in again.' },
        homeLink: { title: 'Signed in, but this Home could not be linked', body: 'Your sign-in is saved. Try linking this Home again.' },
        directoryRefresh: { title: 'Signed in, but we couldn’t refresh your Home list', body: 'Your sign-in service connection is ready. Try refreshing your Home list again.' },
        homeEnrollment: { title: 'Signed in, but your Personal Home was not added', body: 'Your sign-in is saved. Try adding the Home again.' },
        invalid: { title: 'This sign-in request is no longer valid', body: 'Start the sign-in again.' }, accountDisabled: { title: 'This account is disabled', body: 'Contact the administrator of your sign-in service. Your existing Homes are unchanged.' },
    },
    actions: {
        startAgain: 'Start again',
        openHome: ({ homeName }: { homeName: string }) => `Open ${homeName}`,
    },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} is connected`, body: 'Your sign-in is saved and this Home is ready to use.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} isn’t linked to this account yet`, signInAction: ({ homeName }: { homeName: string }) => `Sign in to ${homeName}`, body: ({ homeName }: { homeName: string }) => `Sign in to ${homeName} directly, or scan its QR code or paste its Home link.`, scanBody: ({ homeName }: { homeName: string }) => `Scan the QR code of ${homeName} or paste its Home link to connect it.` },
    noHomes: { body: 'This account has no Homes yet. Refresh after adding one elsewhere, or scan a Home’s QR code or paste its Home link.' },
    approvalWait: {
        waitingBody: 'Approve this sign-in from your other signed-in device.',
        cancelledTitle: 'Stopped waiting for approval',
        cancelledBody: 'Your sign-in is still saved and your existing Homes are unchanged.',
    },
} as const;

const de = {
    title: 'Anmelden, um deine Homes zu finden',
    cancelNote: 'Beim Abbrechen bleibst du bei deinen bestehenden Homes angemeldet.', focusedHomePreserved: 'Dein fokussiertes Home ändert sich nicht.',
    stages: { signingIn: 'Anmeldung läuft', findingHomes: 'Deine Homes werden gesucht', waitingApproval: 'Auf Home-Genehmigung warten' },
    errors: { provider: { title: 'Der Anbieter hat die Anmeldung nicht abgeschlossen', body: 'Starte die Anmeldung erneut.' }, expired: { title: 'Diese Anmeldeanfrage ist abgelaufen', body: 'Starte die Anmeldung erneut.' }, identityChanged: { title: 'Die Identität des Anmeldedienstes hat sich geändert', body: 'Prüfe, ob das der Anmeldedienst ist, den du verwenden wolltest, bevor du dich erneut verbindest.' }, unavailable: { title: 'Der Anmeldedienst ist nicht verfügbar', body: 'Prüfe den Dienst und versuche es erneut. Deine bestehenden Homes bleiben unverändert.' }, exchange: { title: 'Die Anmeldung konnte nicht abgeschlossen werden', body: 'Es wurden keine Zugangsdaten für den Anmeldedienst gespeichert. Starte die Anmeldung erneut.' }, storage: { title: 'Die Anmeldung konnte nicht gespeichert werden', body: 'Deine bestehenden Home-Zugangsdaten bleiben unverändert. Starte die Anmeldung erneut.' }, homeLink: { title: 'Angemeldet, aber dieses Home konnte nicht verknüpft werden', body: 'Deine Anmeldung ist gespeichert. Versuche erneut, dieses Home zu verknüpfen.' }, directoryRefresh: { title: 'Angemeldet, aber deine Home-Liste konnte nicht aktualisiert werden', body: 'Die Verbindung zum Anmeldedienst ist bereit. Versuche erneut, deine Home-Liste zu aktualisieren.' }, homeEnrollment: { title: 'Angemeldet, aber dein persönliches Home wurde nicht hinzugefügt', body: 'Deine Anmeldung ist gespeichert. Versuche erneut, das Home hinzuzufügen.' }, invalid: { title: 'Diese Anmeldeanfrage ist nicht mehr gültig', body: 'Starte die Anmeldung erneut.' }, accountDisabled: { title: 'Dieses Konto ist deaktiviert', body: 'Wende dich an die Verwaltung deines Anmeldedienstes. Deine bestehenden Homes bleiben unverändert.' } },
    actions: { startAgain: 'Neu starten', openHome: ({ homeName }: { homeName: string }) => `${homeName} öffnen` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} ist verbunden`, body: 'Deine Anmeldung ist gespeichert und dieses Home kann jetzt verwendet werden.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} ist noch nicht mit diesem Konto verknüpft`, signInAction: ({ homeName }: { homeName: string }) => `Bei ${homeName} anmelden`, body: ({ homeName }: { homeName: string }) => `Melde dich direkt bei ${homeName} an oder scanne seinen QR-Code bzw. füge seinen Home-Link ein.`, scanBody: ({ homeName }: { homeName: string }) => `Scanne den QR-Code von ${homeName} oder füge seinen Home-Link ein, um es zu verbinden.` },
    noHomes: { body: 'Dieses Konto hat noch keine Homes. Aktualisiere, nachdem du anderswo eines hinzugefügt hast, oder scanne den QR-Code eines Homes bzw. füge seinen Home-Link ein.' },
    approvalWait: { waitingBody: 'Genehmige diese Anmeldung auf deinem anderen angemeldeten Gerät.', cancelledTitle: 'Warten auf Genehmigung beendet', cancelledBody: 'Deine Anmeldung bleibt gespeichert und deine bestehenden Homes bleiben unverändert.' },
} as const;

const es = {
    title: 'Inicia sesión para encontrar tus Homes',
    cancelNote: 'Cancelar no cerrará la sesión de tus Homes existentes.', focusedHomePreserved: 'Tu Home enfocado no cambiará.',
    stages: { signingIn: 'Iniciando sesión', findingHomes: 'Buscando tus Homes', waitingApproval: 'Esperando la aprobación del Home' },
    errors: { provider: { title: 'El proveedor no completó el inicio de sesión', body: 'Vuelve a iniciar sesión.' }, expired: { title: 'Esta solicitud de inicio de sesión ha caducado', body: 'Vuelve a iniciar sesión.' }, identityChanged: { title: 'La identidad del servicio de inicio de sesión ha cambiado', body: 'Comprueba que es el servicio de inicio de sesión que querías usar antes de volver a conectarte.' }, unavailable: { title: 'El servicio de inicio de sesión no está disponible', body: 'Comprueba el servicio e inténtalo de nuevo. Tus Homes existentes no cambiarán.' }, exchange: { title: 'No se pudo completar el inicio de sesión', body: 'No se guardaron credenciales del servicio de inicio de sesión. Vuelve a iniciar sesión.' }, storage: { title: 'No se pudo guardar el inicio de sesión', body: 'Las credenciales de tus Homes existentes no cambiarán. Vuelve a iniciar sesión.' }, homeLink: { title: 'Sesión iniciada, pero no se pudo vincular este Home', body: 'Tu inicio de sesión está guardado. Intenta vincular este Home de nuevo.' }, directoryRefresh: { title: 'Sesión iniciada, pero no pudimos actualizar tu lista de Homes', body: 'La conexión del servicio de inicio de sesión está lista. Intenta actualizar tu lista de Homes de nuevo.' }, homeEnrollment: { title: 'Sesión iniciada, pero tu Home personal no se añadió', body: 'Tu inicio de sesión está guardado. Intenta añadir el Home de nuevo.' }, invalid: { title: 'Esta solicitud de inicio de sesión ya no es válida', body: 'Vuelve a iniciar sesión.' }, accountDisabled: { title: 'Esta cuenta está desactivada', body: 'Contacta con quien administra tu servicio de inicio de sesión. Tus Homes existentes no cambiarán.' } },
    actions: { startAgain: 'Empezar de nuevo', openHome: ({ homeName }: { homeName: string }) => `Abrir ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} está conectado`, body: 'Tu inicio de sesión está guardado y este Home está listo para usarse.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} aún no está vinculado a esta cuenta`, signInAction: ({ homeName }: { homeName: string }) => `Iniciar sesión en ${homeName}`, body: ({ homeName }: { homeName: string }) => `Inicia sesión directamente en ${homeName}, o escanea su código QR o pega su enlace de Home.`, scanBody: ({ homeName }: { homeName: string }) => `Escanea el código QR de ${homeName} o pega su enlace de Home para conectarlo.` },
    noHomes: { body: 'Esta cuenta aún no tiene Homes. Actualiza después de añadir uno en otro lugar, o escanea el código QR de un Home o pega su enlace de Home.' },
    approvalWait: { waitingBody: 'Aprueba este inicio de sesión desde tu otro dispositivo con sesión iniciada.', cancelledTitle: 'Se dejó de esperar la aprobación', cancelledBody: 'Tu inicio de sesión sigue guardado y tus Homes existentes no cambian.' },
} as const;

const fr = {
    title: 'Se connecter pour trouver tes Homes',
    cancelNote: 'L’annulation ne te déconnectera pas de tes Homes existants.', focusedHomePreserved: 'Le Home actif ne changera pas.',
    stages: { signingIn: 'Connexion en cours', findingHomes: 'Recherche de tes Homes', waitingApproval: 'En attente de l’approbation du Home' },
    errors: { provider: { title: 'Le fournisseur n’a pas terminé la connexion', body: 'Recommence la connexion.' }, expired: { title: 'Cette demande de connexion a expiré', body: 'Recommence la connexion.' }, identityChanged: { title: 'L’identité du service de connexion a changé', body: 'Vérifie qu’il s’agit bien du service de connexion que tu voulais utiliser avant de te reconnecter.' }, unavailable: { title: 'Le service de connexion est indisponible', body: 'Vérifie le service et réessaie. Tes Homes existants restent inchangés.' }, exchange: { title: 'La connexion n’a pas pu être terminée', body: 'Aucun identifiant du service de connexion n’a été enregistré. Recommence la connexion.' }, storage: { title: 'La connexion n’a pas pu être enregistrée', body: 'Les identifiants de tes Homes existants restent inchangés. Recommence la connexion.' }, homeLink: { title: 'Connecté, mais ce Home n’a pas pu être lié', body: 'Ta connexion est enregistrée. Réessaie de lier ce Home.' }, directoryRefresh: { title: 'Connecté, mais la liste de tes Homes n’a pas pu être actualisée', body: 'La connexion au service de connexion est prête. Réessaie d’actualiser la liste de tes Homes.' }, homeEnrollment: { title: 'Connecté, mais ton Home personnel n’a pas été ajouté', body: 'Ta connexion est enregistrée. Réessaie d’ajouter le Home.' }, invalid: { title: 'Cette demande de connexion n’est plus valide', body: 'Recommence la connexion.' }, accountDisabled: { title: 'Ce compte est désactivé', body: 'Contacte l’administrateur de ton service de connexion. Tes Homes existants restent inchangés.' } },
    actions: { startAgain: 'Recommencer', openHome: ({ homeName }: { homeName: string }) => `Ouvrir ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} est connecté`, body: 'Ta connexion est enregistrée et ce Home est prêt à être utilisé.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} n’est pas encore lié à ce compte`, signInAction: ({ homeName }: { homeName: string }) => `Se connecter à ${homeName}`, body: ({ homeName }: { homeName: string }) => `Connecte-toi directement à ${homeName}, ou scanne son code QR ou colle son lien de Home.`, scanBody: ({ homeName }: { homeName: string }) => `Scanne le code QR de ${homeName} ou colle son lien de Home pour le connecter.` },
    noHomes: { body: 'Ce compte n’a pas encore de Home. Actualise après en avoir ajouté un ailleurs, ou scanne le code QR d’un Home ou colle son lien de Home.' },
    approvalWait: { waitingBody: 'Approuve cette connexion depuis ton autre appareil déjà connecté.', cancelledTitle: 'Attente de l’approbation terminée', cancelledBody: 'Ta connexion reste enregistrée et tes Homes existants ne changent pas.' },
} as const;

const it = {
    title: 'Accedi per trovare i tuoi Home',
    cancelNote: 'L’annullamento non disconnetterà gli Home esistenti.', focusedHomePreserved: 'L’Home attivo non cambierà.',
    stages: { signingIn: 'Accesso in corso', findingHomes: 'Ricerca dei tuoi Home', waitingApproval: 'In attesa dell’approvazione dell’Home' },
    errors: { provider: { title: 'Il provider non ha completato l’accesso', body: 'Avvia di nuovo l’accesso.' }, expired: { title: 'Questa richiesta di accesso è scaduta', body: 'Avvia di nuovo l’accesso.' }, identityChanged: { title: 'L’identità del servizio di accesso è cambiata', body: 'Verifica che sia il servizio di accesso che intendevi usare prima di riconnetterti.' }, unavailable: { title: 'Il servizio di accesso non è disponibile', body: 'Controlla il servizio e riprova. Gli Home esistenti non cambieranno.' }, exchange: { title: 'Impossibile completare l’accesso', body: 'Non sono state salvate credenziali del servizio di accesso. Avvia di nuovo l’accesso.' }, storage: { title: 'Impossibile salvare l’accesso', body: 'Le credenziali degli Home esistenti non cambieranno. Avvia di nuovo l’accesso.' }, homeLink: { title: 'Accesso completato, ma non è stato possibile collegare questo Home', body: 'Il tuo accesso è salvato. Prova di nuovo a collegare questo Home.' }, directoryRefresh: { title: 'Accesso completato, ma non è stato possibile aggiornare l’elenco degli Home', body: 'La connessione del servizio di accesso è pronta. Prova di nuovo ad aggiornare l’elenco degli Home.' }, homeEnrollment: { title: 'Accesso completato, ma il tuo Home personale non è stato aggiunto', body: 'Il tuo accesso è salvato. Prova di nuovo ad aggiungere l’Home.' }, invalid: { title: 'Questa richiesta di accesso non è più valida', body: 'Avvia di nuovo l’accesso.' }, accountDisabled: { title: 'Questo account è disattivato', body: 'Contatta chi amministra il tuo servizio di accesso. I tuoi Home esistenti restano invariati.' } },
    actions: { startAgain: 'Ricomincia', openHome: ({ homeName }: { homeName: string }) => `Apri ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} è connesso`, body: 'Il tuo accesso è salvato e questo Home è pronto per essere usato.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} non è ancora collegato a questo account`, signInAction: ({ homeName }: { homeName: string }) => `Accedi a ${homeName}`, body: ({ homeName }: { homeName: string }) => `Accedi direttamente a ${homeName}, oppure scansiona il suo codice QR o incolla il suo link Home.`, scanBody: ({ homeName }: { homeName: string }) => `Scansiona il codice QR di ${homeName} o incolla il suo link Home per collegarlo.` },
    noHomes: { body: 'Questo account non ha ancora Home. Aggiorna dopo averne aggiunto uno altrove, oppure scansiona il codice QR di un Home o incolla il suo link Home.' },
    approvalWait: { waitingBody: 'Approva questo accesso dall’altro dispositivo su cui hai effettuato l’accesso.', cancelledTitle: 'Attesa dell’approvazione terminata', cancelledBody: 'L’accesso rimane salvato e gli Home esistenti non cambiano.' },
} as const;

const pt = {
    title: 'Faça login para encontrar seus Homes',
    cancelNote: 'Cancelar não encerra a sessão nos seus Homes existentes.', focusedHomePreserved: 'O Home em foco não será alterado.',
    stages: { signingIn: 'Fazendo login', findingHomes: 'Procurando seus Homes', waitingApproval: 'Aguardando aprovação do Home' },
    errors: { provider: { title: 'O provedor não concluiu o login', body: 'Faça login novamente.' }, expired: { title: 'Esta solicitação de login expirou', body: 'Faça login novamente.' }, identityChanged: { title: 'A identidade do serviço de login mudou', body: 'Confirme que este é o serviço de login que você queria usar antes de se conectar novamente.' }, unavailable: { title: 'O serviço de login está indisponível', body: 'Verifique o serviço e tente novamente. Seus Homes existentes não serão alterados.' }, exchange: { title: 'Não foi possível concluir o login', body: 'Nenhuma credencial do serviço de login foi salva. Faça login novamente.' }, storage: { title: 'Não foi possível salvar o login', body: 'As credenciais dos seus Homes existentes não serão alteradas. Faça login novamente.' }, homeLink: { title: 'Login feito, mas não foi possível vincular este Home', body: 'Seu login está salvo. Tente vincular este Home novamente.' }, directoryRefresh: { title: 'Login feito, mas não foi possível atualizar sua lista de Homes', body: 'A conexão com o serviço de login está pronta. Tente atualizar sua lista de Homes novamente.' }, homeEnrollment: { title: 'Login feito, mas seu Home pessoal não foi adicionado', body: 'Seu login está salvo. Tente adicionar o Home novamente.' }, invalid: { title: 'Esta solicitação de login não é mais válida', body: 'Faça login novamente.' }, accountDisabled: { title: 'Esta conta está desativada', body: 'Entre em contato com quem administra seu serviço de login. Seus Homes existentes não serão alterados.' } },
    actions: { startAgain: 'Começar de novo', openHome: ({ homeName }: { homeName: string }) => `Abrir ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} está conectado`, body: 'Seu login está salvo e este Home está pronto para uso.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} ainda não está vinculado a esta conta`, signInAction: ({ homeName }: { homeName: string }) => `Fazer login em ${homeName}`, body: ({ homeName }: { homeName: string }) => `Faça login diretamente em ${homeName}, ou escaneie o código QR dele ou cole o link do Home.`, scanBody: ({ homeName }: { homeName: string }) => `Escaneie o código QR de ${homeName} ou cole o link do Home para conectá-lo.` },
    noHomes: { body: 'Esta conta ainda não tem Homes. Atualize depois de adicionar um em outro lugar, ou escaneie o código QR de um Home ou cole o link do Home.' },
    approvalWait: { waitingBody: 'Aprove este login no seu outro dispositivo conectado.', cancelledTitle: 'Você parou de aguardar a aprovação', cancelledBody: 'Seu login continua salvo e seus Homes existentes não mudam.' },
} as const;

const ca = {
    title: 'Inicia la sessió per trobar els teus Homes',
    cancelNote: 'La cancel·lació no tancarà la sessió dels Homes existents.', focusedHomePreserved: 'El Home actiu no canviarà.',
    stages: { signingIn: 'Iniciant sessió', findingHomes: 'Cercant els teus Homes', waitingApproval: 'Esperant l’aprovació del Home' },
    errors: { provider: { title: 'El proveïdor no ha completat l’inici de sessió', body: 'Torna a iniciar la sessió.' }, expired: { title: 'Aquesta sol·licitud d’inici de sessió ha caducat', body: 'Torna a iniciar la sessió.' }, identityChanged: { title: 'La identitat del servei d’inici de sessió ha canviat', body: 'Comprova que és el servei d’inici de sessió que volies fer servir abans de tornar-te a connectar.' }, unavailable: { title: 'El servei d’inici de sessió no està disponible', body: 'Comprova el servei i torna-ho a provar. Els Homes existents no canviaran.' }, exchange: { title: 'No s’ha pogut completar l’inici de sessió', body: 'No s’han desat credencials del servei d’inici de sessió. Torna a iniciar la sessió.' }, storage: { title: 'No s’ha pogut desar l’inici de sessió', body: 'Les credencials dels Homes existents no canviaran. Torna a iniciar la sessió.' }, homeLink: { title: 'Sessió iniciada, però no s’ha pogut enllaçar aquest Home', body: 'El teu inici de sessió està desat. Torna a provar d’enllaçar aquest Home.' }, directoryRefresh: { title: 'Sessió iniciada, però no hem pogut actualitzar la llista de Homes', body: 'La connexió del servei d’inici de sessió està preparada. Torna a provar d’actualitzar la llista de Homes.' }, homeEnrollment: { title: 'Sessió iniciada, però el teu Home personal no s’ha afegit', body: 'El teu inici de sessió està desat. Torna a provar d’afegir el Home.' }, invalid: { title: 'Aquesta sol·licitud d’inici de sessió ja no és vàlida', body: 'Torna a iniciar la sessió.' }, accountDisabled: { title: 'Aquest compte està desactivat', body: 'Contacta amb qui administra el teu servei d’inici de sessió. Els teus Homes existents no canvien.' } },
    actions: { startAgain: 'Torna a començar', openHome: ({ homeName }: { homeName: string }) => `Obre ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} està connectat`, body: 'La sessió està desada i aquest Home està llest per utilitzar-se.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} encara no està vinculat a aquest compte`, signInAction: ({ homeName }: { homeName: string }) => `Inicia la sessió a ${homeName}`, body: ({ homeName }: { homeName: string }) => `Inicia la sessió directament a ${homeName}, o escaneja’n el codi QR o enganxa’n l’enllaç de Home.`, scanBody: ({ homeName }: { homeName: string }) => `Escaneja el codi QR de ${homeName} o enganxa’n l’enllaç de Home per connectar-lo.` },
    noHomes: { body: 'Aquest compte encara no té Homes. Actualitza després d’afegir-ne un en un altre lloc, o escaneja el codi QR d’un Home o enganxa’n l’enllaç de Home.' },
    approvalWait: { waitingBody: 'Aprova aquest inici de sessió des del teu altre dispositiu amb sessió iniciada.', cancelledTitle: 'Has deixat d’esperar l’aprovació', cancelledBody: 'El teu inici de sessió continua desat i els Homes existents no canvien.' },
} as const;

const pl = {
    title: 'Zaloguj się, aby znaleźć swoje Homes',
    cancelNote: 'Anulowanie nie wyloguje Cię z istniejących Homes.', focusedHomePreserved: 'Wybrany Home nie zmieni się.',
    stages: { signingIn: 'Logowanie', findingHomes: 'Wyszukiwanie Twoich Homes', waitingApproval: 'Oczekiwanie na zatwierdzenie Home' },
    errors: { provider: { title: 'Dostawca nie ukończył logowania', body: 'Rozpocznij logowanie ponownie.' }, expired: { title: 'Ta prośba o logowanie wygasła', body: 'Rozpocznij logowanie ponownie.' }, identityChanged: { title: 'Tożsamość usługi logowania zmieniła się', body: 'Upewnij się, że to właściwa usługa logowania, zanim połączysz się ponownie.' }, unavailable: { title: 'Usługa logowania jest niedostępna', body: 'Sprawdź usługę i spróbuj ponownie. Istniejące Homes pozostaną bez zmian.' }, exchange: { title: 'Nie udało się ukończyć logowania', body: 'Nie zapisano danych logowania usługi logowania. Rozpocznij logowanie ponownie.' }, storage: { title: 'Nie udało się zapisać logowania', body: 'Dane logowania istniejących Homes pozostaną bez zmian. Rozpocznij logowanie ponownie.' }, homeLink: { title: 'Zalogowano, ale nie udało się połączyć tego Home', body: 'Logowanie zostało zapisane. Spróbuj ponownie połączyć ten Home.' }, directoryRefresh: { title: 'Zalogowano, ale nie udało się odświeżyć listy Homes', body: 'Połączenie z usługą logowania jest gotowe. Spróbuj ponownie odświeżyć listę Homes.' }, homeEnrollment: { title: 'Zalogowano, ale osobisty Home nie został dodany', body: 'Logowanie zostało zapisane. Spróbuj ponownie dodać Home.' }, invalid: { title: 'Ta prośba o logowanie nie jest już ważna', body: 'Rozpocznij logowanie ponownie.' }, accountDisabled: { title: 'To konto jest wyłączone', body: 'Skontaktuj się z administratorem usługi logowania. Twoje istniejące Homes pozostają bez zmian.' } },
    actions: { startAgain: 'Rozpocznij ponownie', openHome: ({ homeName }: { homeName: string }) => `Otwórz ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} jest połączony`, body: 'Logowanie zostało zapisane, a ten Home jest gotowy do użycia.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} nie jest jeszcze połączony z tym kontem`, signInAction: ({ homeName }: { homeName: string }) => `Zaloguj się do ${homeName}`, body: ({ homeName }: { homeName: string }) => `Zaloguj się bezpośrednio do ${homeName} albo zeskanuj jego kod QR lub wklej jego link Home.`, scanBody: ({ homeName }: { homeName: string }) => `Zeskanuj kod QR ${homeName} lub wklej jego link Home, aby go połączyć.` },
    noHomes: { body: 'To konto nie ma jeszcze żadnego Home. Odśwież po dodaniu Home w innym miejscu albo zeskanuj kod QR Home lub wklej jego link Home.' },
    approvalWait: { waitingBody: 'Zatwierdź to logowanie na innym zalogowanym urządzeniu.', cancelledTitle: 'Zakończono oczekiwanie na zatwierdzenie', cancelledBody: 'Logowanie pozostało zapisane, a istniejące Homes pozostały bez zmian.' },
} as const;

const ru = {
    title: 'Войдите, чтобы найти свои Homes',
    cancelNote: 'Отмена не приведёт к выходу из существующих Homes.', focusedHomePreserved: 'Текущий Home не изменится.',
    stages: { signingIn: 'Выполняется вход', findingHomes: 'Поиск ваших Homes', waitingApproval: 'Ожидание одобрения Home' },
    errors: { provider: { title: 'Провайдер не завершил вход', body: 'Начните вход заново.' }, expired: { title: 'Срок действия запроса на вход истёк', body: 'Начните вход заново.' }, identityChanged: { title: 'Идентификатор службы входа изменился', body: 'Убедитесь, что это нужная служба входа, прежде чем подключаться снова.' }, unavailable: { title: 'Служба входа недоступна', body: 'Проверьте службу и повторите попытку. Существующие Homes не изменятся.' }, exchange: { title: 'Не удалось завершить вход', body: 'Учётные данные службы входа не сохранены. Начните вход заново.' }, storage: { title: 'Не удалось сохранить вход', body: 'Учётные данные существующих Homes не изменятся. Начните вход заново.' }, homeLink: { title: 'Вход выполнен, но этот Home не удалось связать', body: 'Вход сохранён. Попробуйте связать этот Home ещё раз.' }, directoryRefresh: { title: 'Вход выполнен, но список Homes не удалось обновить', body: 'Подключение службы входа готово. Попробуйте обновить список Homes ещё раз.' }, homeEnrollment: { title: 'Вход выполнен, но личный Home не добавлен', body: 'Вход сохранён. Попробуйте добавить Home ещё раз.' }, invalid: { title: 'Этот запрос на вход больше недействителен', body: 'Начните вход заново.' }, accountDisabled: { title: 'Этот аккаунт отключён', body: 'Обратитесь к администратору службы входа. Ваши существующие Homes не изменятся.' } },
    actions: { startAgain: 'Начать заново', openHome: ({ homeName }: { homeName: string }) => `Открыть ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} подключён`, body: 'Вход сохранён, и этот Home готов к работе.' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} ещё не привязан к этому аккаунту`, signInAction: ({ homeName }: { homeName: string }) => `Войти в ${homeName}`, body: ({ homeName }: { homeName: string }) => `Войдите в ${homeName} напрямую или отсканируйте его QR-код либо вставьте его ссылку Home.`, scanBody: ({ homeName }: { homeName: string }) => `Отсканируйте QR-код ${homeName} или вставьте его ссылку Home, чтобы подключить его.` },
    noHomes: { body: 'У этого аккаунта пока нет Home. Обновите после добавления Home в другом месте или отсканируйте QR-код Home либо вставьте его ссылку Home.' },
    approvalWait: { waitingBody: 'Подтвердите этот вход на другом устройстве, где вы уже вошли.', cancelledTitle: 'Ожидание одобрения прекращено', cancelledBody: 'Вход сохранён, существующие Homes не изменились.' },
} as const;

const ja = {
    title: 'サインインして Home を見つける',
    cancelNote: 'キャンセルしても既存の Home からはサインアウトされません。', focusedHomePreserved: '現在の Home は変更されません。',
    stages: { signingIn: 'サインイン中', findingHomes: 'Home を検索中', waitingApproval: 'Home の承認を待っています' },
    errors: { provider: { title: 'プロバイダーがサインインを完了しませんでした', body: 'もう一度サインインしてください。' }, expired: { title: 'このサインイン要求は期限切れです', body: 'もう一度サインインしてください。' }, identityChanged: { title: 'サインインサービスの識別情報が変更されました', body: '再接続する前に、使うつもりのサインインサービスであることを確認してください。' }, unavailable: { title: 'サインインサービスを利用できません', body: 'サービスを確認して再試行してください。既存の Home は変更されません。' }, exchange: { title: 'サインインを完了できませんでした', body: 'サインインサービスの認証情報は保存されていません。もう一度サインインしてください。' }, storage: { title: 'サインインを保存できませんでした', body: '既存の Home の認証情報は変更されません。もう一度サインインしてください。' }, homeLink: { title: 'サインインしましたが、この Home をリンクできませんでした', body: 'サインインは保存されています。この Home のリンクをもう一度お試しください。' }, directoryRefresh: { title: 'サインインしましたが、Home 一覧を更新できませんでした', body: 'サインインサービスへの接続は完了しています。Home 一覧の更新をもう一度お試しください。' }, homeEnrollment: { title: 'サインインしましたが、パーソナル Home は追加されませんでした', body: 'サインインは保存されています。Home の追加をもう一度お試しください。' }, invalid: { title: 'このサインイン要求は無効です', body: 'もう一度サインインしてください。' }, accountDisabled: { title: 'このアカウントは無効化されています', body: 'サインインサービスの管理者に連絡してください。既存の Home は変更されません。' } },
    actions: { startAgain: 'やり直す', openHome: ({ homeName }: { homeName: string }) => `${homeName} を開く` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} に接続しました`, body: 'サインイン情報が保存され、この Home を使用できるようになりました。' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} はまだこのアカウントにリンクされていません`, signInAction: ({ homeName }: { homeName: string }) => `${homeName} にサインイン`, body: ({ homeName }: { homeName: string }) => `${homeName} に直接サインインするか、その QR コードをスキャンするか Home リンクを貼り付けてください。`, scanBody: ({ homeName }: { homeName: string }) => `${homeName} の QR コードをスキャンするか Home リンクを貼り付けて接続してください。` },
    noHomes: { body: 'このアカウントにはまだ Home がありません。別の場所で追加してから更新するか、Home の QR コードをスキャンするか Home リンクを貼り付けてください。' },
    approvalWait: { waitingBody: 'サインイン済みの別のデバイスでこのサインインを承認してください。', cancelledTitle: '承認の待機を終了しました', cancelledBody: 'サインインは保存されたままで、既存の Home は変更されません。' },
} as const;

const zhHans = {
    title: '登录以查找你的 Home',
    cancelNote: '取消不会退出你现有的 Home。', focusedHomePreserved: '当前聚焦的 Home 不会改变。',
    stages: { signingIn: '正在登录', findingHomes: '正在查找你的 Homes', waitingApproval: '正在等待 Home 批准' },
    errors: { provider: { title: '提供方未完成登录', body: '请重新开始登录。' }, expired: { title: '此登录请求已过期', body: '请重新开始登录。' }, identityChanged: { title: '登录服务身份已更改', body: '重新连接前，请确认这是你想使用的登录服务。' }, unavailable: { title: '登录服务不可用', body: '检查服务后重试。现有 Homes 不会改变。' }, exchange: { title: '无法完成登录', body: '未保存登录服务凭据。请重新开始登录。' }, storage: { title: '无法保存登录', body: '现有 Home 凭据不会改变。请重新开始登录。' }, homeLink: { title: '已登录，但无法关联此 Home', body: '你的登录已保存。请再次尝试关联此 Home。' }, directoryRefresh: { title: '已登录，但无法刷新 Home 列表', body: '登录服务连接已就绪。请再次尝试刷新 Home 列表。' }, homeEnrollment: { title: '已登录，但未添加个人 Home', body: '你的登录已保存。请再次尝试添加 Home。' }, invalid: { title: '此登录请求已失效', body: '请重新开始登录。' }, accountDisabled: { title: '此账户已被停用', body: '请联系登录服务的管理员。你现有的 Home 不会改变。' } },
    actions: { startAgain: '重新开始', openHome: ({ homeName }: { homeName: string }) => `打开 ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} 已连接`, body: '你的登录信息已保存，可以开始使用这个 Home。' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} 尚未关联到此账户`, signInAction: ({ homeName }: { homeName: string }) => `登录 ${homeName}`, body: ({ homeName }: { homeName: string }) => `直接登录 ${homeName}，或扫描它的二维码、粘贴它的 Home 链接。`, scanBody: ({ homeName }: { homeName: string }) => `扫描 ${homeName} 的二维码或粘贴它的 Home 链接以连接。` },
    noHomes: { body: '此账户还没有 Home。在其他地方添加后刷新，或扫描 Home 的二维码、粘贴其 Home 链接。' },
    approvalWait: { waitingBody: '在你另一台已登录的设备上批准这次登录。', cancelledTitle: '已停止等待批准', cancelledBody: '你的登录仍然保留，现有 Home 不会改变。' },
} as const;

const zhHant = {
    title: '登入以尋找你的 Home',
    cancelNote: '取消不會登出你現有的 Home。', focusedHomePreserved: '目前聚焦的 Home 不會變更。',
    stages: { signingIn: '正在登入', findingHomes: '正在尋找你的 Homes', waitingApproval: '正在等待 Home 核准' },
    errors: { provider: { title: '提供者未完成登入', body: '請重新開始登入。' }, expired: { title: '此登入要求已過期', body: '請重新開始登入。' }, identityChanged: { title: '登入服務身分已變更', body: '重新連接前，請確認這是你想使用的登入服務。' }, unavailable: { title: '登入服務無法使用', body: '檢查服務後再試一次。現有 Homes 不會變更。' }, exchange: { title: '無法完成登入', body: '未儲存登入服務憑證。請重新開始登入。' }, storage: { title: '無法儲存登入', body: '現有 Home 憑證不會變更。請重新開始登入。' }, homeLink: { title: '已登入，但無法連結此 Home', body: '你的登入已儲存。請再次嘗試連結此 Home。' }, directoryRefresh: { title: '已登入，但無法重新整理 Home 清單', body: '登入服務連線已就緒。請再次嘗試重新整理 Home 清單。' }, homeEnrollment: { title: '已登入，但未新增個人 Home', body: '你的登入已儲存。請再次嘗試新增 Home。' }, invalid: { title: '此登入要求已失效', body: '請重新開始登入。' }, accountDisabled: { title: '此帳戶已停用', body: '請聯絡登入服務的管理員。你現有的 Home 不會改變。' } },
    actions: { startAgain: '重新開始', openHome: ({ homeName }: { homeName: string }) => `開啟 ${homeName}` },
    success: { title: ({ homeName }: { homeName: string }) => `${homeName} 已連線`, body: '你的登入資訊已儲存，可以開始使用這個 Home。' },
    notLinked: { title: ({ homeName }: { homeName: string }) => `${homeName} 尚未連結到此帳號`, signInAction: ({ homeName }: { homeName: string }) => `登入 ${homeName}`, body: ({ homeName }: { homeName: string }) => `直接登入 ${homeName}，或掃描它的 QR 碼、貼上它的 Home 連結。`, scanBody: ({ homeName }: { homeName: string }) => `掃描 ${homeName} 的 QR 碼或貼上它的 Home 連結以連接。` },
    noHomes: { body: '此帳號還沒有 Home。在其他地方新增後重新整理，或掃描 Home 的 QR 碼、貼上其 Home 連結。' },
    approvalWait: { waitingBody: '在你另一部已登入的裝置上核准這次登入。', cancelledTitle: '已停止等待核准', cancelledBody: '你的登入仍然保留，現有 Home 不會改變。' },
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
