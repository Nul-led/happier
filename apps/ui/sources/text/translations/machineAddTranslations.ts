type MachineAddTranslation = Readonly<{
    newMachine: string;
    waiting: string;
    connected: string;
    failed: string;
    cancelled: string;
    cannotReachHost: string;
    choosePath: string;
    switchHome: string;
}>;

export const machineAddTranslations = {
    en: { newMachine: 'New machine', waiting: 'Waiting for it to connect', connected: 'Connected', failed: 'Could not add this machine', cancelled: 'Cancelled', cannotReachHost: 'Cannot reach the host. Check the address and SSH access.', choosePath: 'Choose how to add a machine', switchHome: 'Return to this Home to continue' },
    ru: { newMachine: 'Новая машина', waiting: 'Ожидание подключения', connected: 'Подключено', failed: 'Не удалось добавить машину', cancelled: 'Отменено', cannotReachHost: 'Не удалось связаться с хостом. Проверьте адрес и доступ по SSH.', choosePath: 'Выберите способ добавления машины', switchHome: 'Вернитесь в этот дом, чтобы продолжить' },
    pl: { newMachine: 'Nowa maszyna', waiting: 'Oczekiwanie na połączenie', connected: 'Połączono', failed: 'Nie udało się dodać maszyny', cancelled: 'Anulowano', cannotReachHost: 'Nie można połączyć się z hostem. Sprawdź adres i dostęp SSH.', choosePath: 'Wybierz sposób dodania maszyny', switchHome: 'Wróć do tego domu, aby kontynuować' },
    es: { newMachine: 'Nueva máquina', waiting: 'Esperando a que se conecte', connected: 'Conectada', failed: 'No se pudo añadir esta máquina', cancelled: 'Cancelado', cannotReachHost: 'No se puede acceder al host. Comprueba la dirección y el acceso SSH.', choosePath: 'Elige cómo añadir una máquina', switchHome: 'Vuelve a este hogar para continuar' },
    fr: { newMachine: 'Nouvelle machine', waiting: 'En attente de connexion', connected: 'Connectée', failed: 'Impossible d’ajouter cette machine', cancelled: 'Annulé', cannotReachHost: 'Hôte inaccessible. Vérifiez l’adresse et l’accès SSH.', choosePath: 'Choisissez comment ajouter une machine', switchHome: 'Revenez à ce foyer pour continuer' },
    it: { newMachine: 'Nuova macchina', waiting: 'In attesa della connessione', connected: 'Connessa', failed: 'Impossibile aggiungere questa macchina', cancelled: 'Annullato', cannotReachHost: 'Host non raggiungibile. Controlla l’indirizzo e l’accesso SSH.', choosePath: 'Scegli come aggiungere una macchina', switchHome: 'Torna a questa Home per continuare' },
    pt: { newMachine: 'Nova máquina', waiting: 'A aguardar ligação', connected: 'Ligada', failed: 'Não foi possível adicionar esta máquina', cancelled: 'Cancelado', cannotReachHost: 'Não foi possível aceder ao host. Verifique o endereço e o acesso SSH.', choosePath: 'Escolha como adicionar uma máquina', switchHome: 'Volte a esta casa para continuar' },
    ca: { newMachine: 'Màquina nova', waiting: 'Esperant que es connecti', connected: 'Connectada', failed: 'No s’ha pogut afegir aquesta màquina', cancelled: 'Cancel·lat', cannotReachHost: 'No es pot accedir a l’amfitrió. Comprova l’adreça i l’accés SSH.', choosePath: 'Tria com afegir una màquina', switchHome: 'Torna a aquesta llar per continuar' },
    de: { newMachine: 'Neue Maschine', waiting: 'Warten auf die Verbindung', connected: 'Verbunden', failed: 'Diese Maschine konnte nicht hinzugefügt werden', cancelled: 'Abgebrochen', cannotReachHost: 'Host nicht erreichbar. Prüfe die Adresse und den SSH-Zugang.', choosePath: 'Wähle, wie du eine Maschine hinzufügst', switchHome: 'Kehre zu diesem Home zurück, um fortzufahren' },
    'zh-Hans': { newMachine: '新机器', waiting: '等待连接', connected: '已连接', failed: '无法添加这台机器', cancelled: '已取消', cannotReachHost: '无法连接主机。请检查地址和 SSH 访问权限。', choosePath: '选择添加机器的方式', switchHome: '返回此 Home 以继续' },
    'zh-Hant': { newMachine: '新機器', waiting: '等待連線', connected: '已連線', failed: '無法新增這台機器', cancelled: '已取消', cannotReachHost: '無法連線至主機。請檢查位址和 SSH 存取權限。', choosePath: '選擇新增機器的方式', switchHome: '返回此 Home 以繼續' },
    ja: { newMachine: '新しいマシン', waiting: '接続を待っています', connected: '接続済み', failed: 'このマシンを追加できませんでした', cancelled: 'キャンセル済み', cannotReachHost: 'ホストに接続できません。アドレスと SSH アクセスを確認してください。', choosePath: 'マシンの追加方法を選んでください', switchHome: '続行するにはこの Home に戻ってください' },
} satisfies Record<'en' | 'ru' | 'pl' | 'es' | 'fr' | 'it' | 'pt' | 'ca' | 'de' | 'zh-Hans' | 'zh-Hant' | 'ja', MachineAddTranslation>;
