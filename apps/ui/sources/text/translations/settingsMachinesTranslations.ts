/**
 * The Machines collection in Settings: its purpose line, this computer, adding a machine, and the
 * background service section.
 */
const en = {
    pageDescription: 'The computers your sessions run on, and the pools that choose between them.',
    thisComputerTitle: 'This computer',
    thisComputerRowSubtitle: 'Background service and command line',
    thisComputerPageDescription: 'The Happier background service and command line on this device.',
    setupSectionTitle: 'Setup',
    setupRowSubtitle: 'Install Happier here and connect it to your Home.',
    addPageDescription: 'Connect a computer so agents can run your sessions on it.',
    addFromComputerTitle: 'Add machines from a computer',
    addFromComputerDescription: 'Open Happier on the computer you want to add, or connect one over SSH from Happier on a desktop or in a browser.',
    searchPlaceholder: 'Search machines',
    count: ({ count }: { count: number }) => (count === 1 ? '1 machine' : `${count} machines`),
    daemonTitle: 'Background service',
    daemonDescription: 'Runs your sessions on this computer and keeps it connected to your Home.',
};

const de: typeof en = {
    pageDescription: 'Die Computer, auf denen deine Sitzungen laufen, und die Pools, die zwischen ihnen wählen.',
    thisComputerTitle: 'Dieser Computer',
    thisComputerRowSubtitle: 'Hintergrunddienst und Befehlszeile',
    thisComputerPageDescription: 'Der Happier-Hintergrunddienst und die Befehlszeile auf diesem Gerät.',
    setupSectionTitle: 'Einrichtung',
    setupRowSubtitle: 'Installiere Happier hier und verbinde es mit deinem Home.',
    addPageDescription: 'Verbinde einen Computer, damit Agents deine Sitzungen darauf ausführen können.',
    addFromComputerTitle: 'Maschinen von einem Computer aus hinzufügen',
    addFromComputerDescription: 'Öffne Happier auf dem Computer, den du hinzufügen möchtest, oder verbinde einen per SSH aus Happier auf dem Desktop oder im Browser.',
    searchPlaceholder: 'Maschinen durchsuchen',
    count: ({ count }: { count: number }) => (count === 1 ? '1 Maschine' : `${count} Maschinen`),
    daemonTitle: 'Hintergrunddienst',
    daemonDescription: 'Führt deine Sitzungen auf diesem Computer aus und hält ihn mit deinem Home verbunden.',
};

const es: typeof en = {
    pageDescription: 'Los ordenadores donde se ejecutan tus sesiones y los grupos que eligen entre ellos.',
    thisComputerTitle: 'Este ordenador',
    thisComputerRowSubtitle: 'Servicio en segundo plano y línea de comandos',
    thisComputerPageDescription: 'El servicio en segundo plano y la línea de comandos de Happier en este dispositivo.',
    setupSectionTitle: 'Configuración',
    setupRowSubtitle: 'Instala Happier aquí y conéctalo a tu Home.',
    addPageDescription: 'Conecta un ordenador para que los agentes ejecuten tus sesiones en él.',
    addFromComputerTitle: 'Añade máquinas desde un ordenador',
    addFromComputerDescription: 'Abre Happier en el ordenador que quieras añadir, o conecta uno por SSH desde Happier en el escritorio o en un navegador.',
    searchPlaceholder: 'Buscar máquinas',
    count: ({ count }: { count: number }) => (count === 1 ? '1 máquina' : `${count} máquinas`),
    daemonTitle: 'Servicio en segundo plano',
    daemonDescription: 'Ejecuta tus sesiones en este ordenador y lo mantiene conectado a tu Home.',
};

const fr: typeof en = {
    pageDescription: 'Les ordinateurs sur lesquels vos sessions s’exécutent, et les pools qui choisissent entre eux.',
    thisComputerTitle: 'Cet ordinateur',
    thisComputerRowSubtitle: 'Service d’arrière-plan et ligne de commande',
    thisComputerPageDescription: 'Le service d’arrière-plan et la ligne de commande Happier sur cet appareil.',
    setupSectionTitle: 'Configuration',
    setupRowSubtitle: 'Installez Happier ici et connectez-le à votre Home.',
    addPageDescription: 'Connectez un ordinateur pour que les agents y exécutent vos sessions.',
    addFromComputerTitle: 'Ajoutez des machines depuis un ordinateur',
    addFromComputerDescription: 'Ouvrez Happier sur l’ordinateur à ajouter, ou connectez-en un en SSH depuis Happier sur ordinateur ou dans un navigateur.',
    searchPlaceholder: 'Rechercher des machines',
    count: ({ count }: { count: number }) => (count === 1 ? '1 machine' : `${count} machines`),
    daemonTitle: 'Service d’arrière-plan',
    daemonDescription: 'Exécute vos sessions sur cet ordinateur et le garde connecté à votre Home.',
};

const it: typeof en = {
    pageDescription: 'I computer su cui girano le tue sessioni e i pool che scelgono tra di essi.',
    thisComputerTitle: 'Questo computer',
    thisComputerRowSubtitle: 'Servizio in background e riga di comando',
    thisComputerPageDescription: 'Il servizio in background e la riga di comando di Happier su questo dispositivo.',
    setupSectionTitle: 'Configurazione',
    setupRowSubtitle: 'Installa Happier qui e collegalo alla tua Home.',
    addPageDescription: 'Collega un computer così gli agenti possono eseguirvi le tue sessioni.',
    addFromComputerTitle: 'Aggiungi macchine da un computer',
    addFromComputerDescription: 'Apri Happier sul computer da aggiungere, oppure collegane uno via SSH da Happier su desktop o nel browser.',
    searchPlaceholder: 'Cerca macchine',
    count: ({ count }: { count: number }) => (count === 1 ? '1 macchina' : `${count} macchine`),
    daemonTitle: 'Servizio in background',
    daemonDescription: 'Esegue le tue sessioni su questo computer e lo mantiene collegato alla tua Home.',
};

const ja: typeof en = {
    pageDescription: 'セッションを実行するコンピューターと、その中から選ぶプール。',
    thisComputerTitle: 'このコンピューター',
    thisComputerRowSubtitle: 'バックグラウンドサービスとコマンドライン',
    thisComputerPageDescription: 'このデバイス上の Happier バックグラウンドサービスとコマンドライン。',
    setupSectionTitle: 'セットアップ',
    setupRowSubtitle: 'ここに Happier をインストールして Home に接続します。',
    addPageDescription: 'コンピューターを接続すると、エージェントがそこでセッションを実行できます。',
    addFromComputerTitle: 'コンピューターからマシンを追加',
    addFromComputerDescription: '追加したいコンピューターで Happier を開くか、デスクトップ版またはブラウザの Happier から SSH で接続してください。',
    searchPlaceholder: 'マシンを検索',
    count: ({ count }: { count: number }) => `${count} 台のマシン`,
    daemonTitle: 'バックグラウンドサービス',
    daemonDescription: 'このコンピューターでセッションを実行し、Home との接続を保ちます。',
};

const pl: typeof en = {
    pageDescription: 'Komputery, na których działają Twoje sesje, i pule, które wybierają spośród nich.',
    thisComputerTitle: 'Ten komputer',
    thisComputerRowSubtitle: 'Usługa w tle i wiersz poleceń',
    thisComputerPageDescription: 'Usługa w tle i wiersz poleceń Happier na tym urządzeniu.',
    setupSectionTitle: 'Konfiguracja',
    setupRowSubtitle: 'Zainstaluj tu Happier i połącz go ze swoim Home.',
    addPageDescription: 'Połącz komputer, aby agenci mogli uruchamiać na nim Twoje sesje.',
    addFromComputerTitle: 'Dodawaj maszyny z komputera',
    addFromComputerDescription: 'Otwórz Happier na komputerze, który chcesz dodać, albo połącz go przez SSH z Happier na komputerze lub w przeglądarce.',
    searchPlaceholder: 'Szukaj maszyn',
    count: ({ count }: { count: number }) => {
        if (count === 1) return '1 maszyna';
        const lastDigit = count % 10;
        const lastTwo = count % 100;
        return lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14) ? `${count} maszyny` : `${count} maszyn`;
    },
    daemonTitle: 'Usługa w tle',
    daemonDescription: 'Uruchamia Twoje sesje na tym komputerze i utrzymuje jego połączenie z Home.',
};

const pt: typeof en = {
    pageDescription: 'Os computadores onde as suas sessões são executadas e os pools que escolhem entre eles.',
    thisComputerTitle: 'Este computador',
    thisComputerRowSubtitle: 'Serviço em segundo plano e linha de comando',
    thisComputerPageDescription: 'O serviço em segundo plano e a linha de comando do Happier neste dispositivo.',
    setupSectionTitle: 'Configuração',
    setupRowSubtitle: 'Instale o Happier aqui e ligue-o ao seu Home.',
    addPageDescription: 'Ligue um computador para que os agentes executem as suas sessões nele.',
    addFromComputerTitle: 'Adicione máquinas a partir de um computador',
    addFromComputerDescription: 'Abra o Happier no computador que quer adicionar, ou ligue um por SSH a partir do Happier no computador ou num navegador.',
    searchPlaceholder: 'Pesquisar máquinas',
    count: ({ count }: { count: number }) => (count === 1 ? '1 máquina' : `${count} máquinas`),
    daemonTitle: 'Serviço em segundo plano',
    daemonDescription: 'Executa as suas sessões neste computador e mantém-no ligado ao seu Home.',
};

const ru: typeof en = {
    pageDescription: 'Компьютеры, на которых выполняются ваши сессии, и пулы, которые выбирают между ними.',
    thisComputerTitle: 'Этот компьютер',
    thisComputerRowSubtitle: 'Фоновая служба и командная строка',
    thisComputerPageDescription: 'Фоновая служба и командная строка Happier на этом устройстве.',
    setupSectionTitle: 'Настройка',
    setupRowSubtitle: 'Установите Happier здесь и подключите его к своему Home.',
    addPageDescription: 'Подключите компьютер, чтобы агенты могли выполнять на нём ваши сессии.',
    addFromComputerTitle: 'Добавляйте машины с компьютера',
    addFromComputerDescription: 'Откройте Happier на компьютере, который хотите добавить, или подключите его по SSH из Happier на компьютере или в браузере.',
    searchPlaceholder: 'Поиск машин',
    count: ({ count }: { count: number }) => {
        const lastDigit = count % 10;
        const lastTwo = count % 100;
        if (lastDigit === 1 && lastTwo !== 11) return `${count} машина`;
        if (lastDigit >= 2 && lastDigit <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} машины`;
        return `${count} машин`;
    },
    daemonTitle: 'Фоновая служба',
    daemonDescription: 'Выполняет ваши сессии на этом компьютере и поддерживает его связь с Home.',
};

const ca: typeof en = {
    pageDescription: 'Els ordinadors on s’executen les teves sessions i els grups que trien entre ells.',
    thisComputerTitle: 'Aquest ordinador',
    thisComputerRowSubtitle: 'Servei en segon pla i línia d’ordres',
    thisComputerPageDescription: 'El servei en segon pla i la línia d’ordres de Happier en aquest dispositiu.',
    setupSectionTitle: 'Configuració',
    setupRowSubtitle: 'Instal·la Happier aquí i connecta’l al teu Home.',
    addPageDescription: 'Connecta un ordinador perquè els agents hi executin les teves sessions.',
    addFromComputerTitle: 'Afegeix màquines des d’un ordinador',
    addFromComputerDescription: 'Obre Happier a l’ordinador que vulguis afegir, o connecta’n un per SSH des de Happier a l’escriptori o en un navegador.',
    searchPlaceholder: 'Cerca màquines',
    count: ({ count }: { count: number }) => (count === 1 ? '1 màquina' : `${count} màquines`),
    daemonTitle: 'Servei en segon pla',
    daemonDescription: 'Executa les teves sessions en aquest ordinador i el manté connectat al teu Home.',
};

const zhHans: typeof en = {
    pageDescription: '运行会话的计算机，以及在它们之间进行选择的机器池。',
    thisComputerTitle: '这台计算机',
    thisComputerRowSubtitle: '后台服务和命令行',
    thisComputerPageDescription: '此设备上的 Happier 后台服务和命令行。',
    setupSectionTitle: '设置',
    setupRowSubtitle: '在此安装 Happier 并将其连接到你的 Home。',
    addPageDescription: '连接一台计算机，让智能体在其上运行你的会话。',
    addFromComputerTitle: '从计算机添加机器',
    addFromComputerDescription: '在要添加的计算机上打开 Happier，或在桌面版或浏览器中的 Happier 通过 SSH 连接一台。',
    searchPlaceholder: '搜索机器',
    count: ({ count }: { count: number }) => `${count} 台机器`,
    daemonTitle: '后台服务',
    daemonDescription: '在这台计算机上运行你的会话，并保持它与 Home 的连接。',
};

const zhHant: typeof en = {
    pageDescription: '執行工作階段的電腦，以及在它們之間進行選擇的機器池。',
    thisComputerTitle: '這台電腦',
    thisComputerRowSubtitle: '背景服務和命令列',
    thisComputerPageDescription: '此裝置上的 Happier 背景服務和命令列。',
    setupSectionTitle: '設定',
    setupRowSubtitle: '在此安裝 Happier 並將其連線到你的 Home。',
    addPageDescription: '連線一台電腦，讓代理程式在其上執行你的工作階段。',
    addFromComputerTitle: '從電腦新增機器',
    addFromComputerDescription: '在要新增的電腦上開啟 Happier，或在桌面版或瀏覽器中的 Happier 透過 SSH 連線一台。',
    searchPlaceholder: '搜尋機器',
    count: ({ count }: { count: number }) => `${count} 台機器`,
    daemonTitle: '背景服務',
    daemonDescription: '在這台電腦上執行你的工作階段，並保持它與 Home 的連線。',
};

export const settingsMachinesTranslations = {
    en, de, es, fr, it, ja, pl, pt, ru, ca, zhHans, zhHant,
};
