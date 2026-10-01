/**
 * Copy for the direct-connection Settings rows (Account › Connections and a machine's Connection
 * section). Outcome words only: the reader chooses whether their devices connect directly, not a
 * transport or route kind.
 */

type MachineParams = { machine: string };

const en = {
    sectionTitle: 'Connections',
    sectionDescription: 'How your devices reach your machines.',
    directTitle: 'Connect directly when possible',
    directOnDescription: 'Previews, live views and file transfers go straight between your devices when they can reach each other, and through Happier when they can’t.',
    directOffDescription: 'Everything goes through Happier. Nothing connects to your machines directly; on the same network this is a little slower.',
    serverDenied: 'Your Home’s server sends everything through Happier, so there’s nothing to choose here.',
    machineSectionTitle: 'Connection',
    machineTitle: ({ machine }: MachineParams) => `Connect to ${machine}`,
    machineOptionDefault: 'Default',
    machineOptionDirect: 'Directly',
    machineOptionRelay: 'Through Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Follows your account: directly when ${machine} can be reached, otherwise through Happier.`,
    machineDefaultOffDescription: 'Follows your account: always through Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Directly when ${machine} can be reached, even if your account says otherwise.`,
    machineRelayDescription: 'Always through Happier, even on the same network.',
};

const de = {
    sectionTitle: 'Verbindungen',
    sectionDescription: 'Wie deine Geräte deine Maschinen erreichen.',
    directTitle: 'Wenn möglich direkt verbinden',
    directOnDescription: 'Vorschauen, Live-Ansichten und Dateiübertragungen laufen direkt zwischen deinen Geräten, wenn sie sich erreichen, sonst über Happier.',
    directOffDescription: 'Alles läuft über Happier. Nichts verbindet sich direkt mit deinen Maschinen; im selben Netzwerk ist das etwas langsamer.',
    serverDenied: 'Der Server deines Home leitet alles über Happier, daher gibt es hier nichts zu wählen.',
    machineSectionTitle: 'Verbindung',
    machineTitle: ({ machine }: MachineParams) => `Verbindung zu ${machine}`,
    machineOptionDefault: 'Standard',
    machineOptionDirect: 'Direkt',
    machineOptionRelay: 'Über Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Folgt deinem Konto: direkt, wenn ${machine} erreichbar ist, sonst über Happier.`,
    machineDefaultOffDescription: 'Folgt deinem Konto: immer über Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Direkt, wenn ${machine} erreichbar ist, auch wenn dein Konto etwas anderes vorgibt.`,
    machineRelayDescription: 'Immer über Happier, auch im selben Netzwerk.',
};

const es = {
    sectionTitle: 'Conexiones',
    sectionDescription: 'Cómo llegan tus dispositivos a tus máquinas.',
    directTitle: 'Conectar directamente cuando sea posible',
    directOnDescription: 'Las vistas previas, las vistas en directo y las transferencias de archivos van directamente entre tus dispositivos cuando se alcanzan, y a través de Happier cuando no.',
    directOffDescription: 'Todo pasa por Happier. Nada se conecta directamente a tus máquinas; en la misma red es un poco más lento.',
    serverDenied: 'El servidor de tu Home envía todo a través de Happier, así que aquí no hay nada que elegir.',
    machineSectionTitle: 'Conexión',
    machineTitle: ({ machine }: MachineParams) => `Conectar con ${machine}`,
    machineOptionDefault: 'Predeterminado',
    machineOptionDirect: 'Directamente',
    machineOptionRelay: 'A través de Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Sigue tu cuenta: directamente cuando se puede llegar a ${machine}, si no a través de Happier.`,
    machineDefaultOffDescription: 'Sigue tu cuenta: siempre a través de Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Directamente cuando se puede llegar a ${machine}, aunque tu cuenta diga lo contrario.`,
    machineRelayDescription: 'Siempre a través de Happier, incluso en la misma red.',
};

const fr = {
    sectionTitle: 'Connexions',
    sectionDescription: 'Comment vos appareils joignent vos machines.',
    directTitle: 'Se connecter directement si possible',
    directOnDescription: 'Les aperçus, les vues en direct et les transferts de fichiers passent directement entre vos appareils quand ils se joignent, et par Happier sinon.',
    directOffDescription: 'Tout passe par Happier. Rien ne se connecte directement à vos machines ; sur le même réseau, c’est un peu plus lent.',
    serverDenied: 'Le serveur de votre Home fait tout passer par Happier : il n’y a rien à choisir ici.',
    machineSectionTitle: 'Connexion',
    machineTitle: ({ machine }: MachineParams) => `Connexion à ${machine}`,
    machineOptionDefault: 'Par défaut',
    machineOptionDirect: 'Directement',
    machineOptionRelay: 'Par Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Suit votre compte : directement quand ${machine} est joignable, sinon par Happier.`,
    machineDefaultOffDescription: 'Suit votre compte : toujours par Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Directement quand ${machine} est joignable, même si votre compte dit le contraire.`,
    machineRelayDescription: 'Toujours par Happier, même sur le même réseau.',
};

const it = {
    sectionTitle: 'Connessioni',
    sectionDescription: 'Come i tuoi dispositivi raggiungono le tue macchine.',
    directTitle: 'Connetti direttamente quando possibile',
    directOnDescription: 'Anteprime, viste dal vivo e trasferimenti di file passano direttamente tra i tuoi dispositivi quando si raggiungono, altrimenti attraverso Happier.',
    directOffDescription: 'Tutto passa attraverso Happier. Niente si connette direttamente alle tue macchine; sulla stessa rete è un po’ più lento.',
    serverDenied: 'Il server della tua Home fa passare tutto attraverso Happier, quindi qui non c’è nulla da scegliere.',
    machineSectionTitle: 'Connessione',
    machineTitle: ({ machine }: MachineParams) => `Connessione a ${machine}`,
    machineOptionDefault: 'Predefinito',
    machineOptionDirect: 'Direttamente',
    machineOptionRelay: 'Tramite Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Segue il tuo account: direttamente quando ${machine} è raggiungibile, altrimenti tramite Happier.`,
    machineDefaultOffDescription: 'Segue il tuo account: sempre tramite Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Direttamente quando ${machine} è raggiungibile, anche se il tuo account dice diversamente.`,
    machineRelayDescription: 'Sempre tramite Happier, anche sulla stessa rete.',
};

const ja = {
    sectionTitle: '接続',
    sectionDescription: 'デバイスからマシンへの接続方法です。',
    directTitle: '可能なときは直接接続',
    directOnDescription: 'デバイス同士が到達できるときは、プレビュー、ライブ表示、ファイル転送を直接やり取りし、できないときは Happier を経由します。',
    directOffDescription: 'すべて Happier を経由します。マシンへ直接接続することはありません。同じネットワークでは少し遅くなります。',
    serverDenied: 'この Home のサーバーはすべて Happier を経由させるため、ここで選べることはありません。',
    machineSectionTitle: '接続',
    machineTitle: ({ machine }: MachineParams) => `${machine} への接続`,
    machineOptionDefault: 'デフォルト',
    machineOptionDirect: '直接',
    machineOptionRelay: 'Happier 経由',
    machineDefaultDescription: ({ machine }: MachineParams) => `アカウントの設定に従います。${machine} に到達できるときは直接、それ以外は Happier 経由です。`,
    machineDefaultOffDescription: 'アカウントの設定に従います。常に Happier 経由です。',
    machineDirectDescription: ({ machine }: MachineParams) => `アカウントの設定にかかわらず、${machine} に到達できるときは直接接続します。`,
    machineRelayDescription: '同じネットワーク上でも、常に Happier を経由します。',
};

const pl = {
    sectionTitle: 'Połączenia',
    sectionDescription: 'Jak twoje urządzenia docierają do twoich maszyn.',
    directTitle: 'Łącz bezpośrednio, gdy to możliwe',
    directOnDescription: 'Podglądy, widoki na żywo i przesyłanie plików idą bezpośrednio między twoimi urządzeniami, gdy mogą się połączyć, a w przeciwnym razie przez Happier.',
    directOffDescription: 'Wszystko idzie przez Happier. Nic nie łączy się bezpośrednio z twoimi maszynami; w tej samej sieci jest to nieco wolniejsze.',
    serverDenied: 'Serwer twojego Home kieruje wszystko przez Happier, więc nie ma tu nic do wyboru.',
    machineSectionTitle: 'Połączenie',
    machineTitle: ({ machine }: MachineParams) => `Połączenie z ${machine}`,
    machineOptionDefault: 'Domyślnie',
    machineOptionDirect: 'Bezpośrednio',
    machineOptionRelay: 'Przez Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Zgodnie z kontem: bezpośrednio, gdy ${machine} jest osiągalny, w przeciwnym razie przez Happier.`,
    machineDefaultOffDescription: 'Zgodnie z kontem: zawsze przez Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Bezpośrednio, gdy ${machine} jest osiągalny, nawet jeśli konto mówi inaczej.`,
    machineRelayDescription: 'Zawsze przez Happier, nawet w tej samej sieci.',
};

const pt = {
    sectionTitle: 'Conexões',
    sectionDescription: 'Como seus dispositivos chegam às suas máquinas.',
    directTitle: 'Conectar diretamente quando possível',
    directOnDescription: 'Prévias, visualizações ao vivo e transferências de arquivos vão direto entre seus dispositivos quando eles se alcançam, e pelo Happier quando não.',
    directOffDescription: 'Tudo passa pelo Happier. Nada se conecta diretamente às suas máquinas; na mesma rede, isso fica um pouco mais lento.',
    serverDenied: 'O servidor do seu Home envia tudo pelo Happier, então não há nada para escolher aqui.',
    machineSectionTitle: 'Conexão',
    machineTitle: ({ machine }: MachineParams) => `Conexão com ${machine}`,
    machineOptionDefault: 'Padrão',
    machineOptionDirect: 'Diretamente',
    machineOptionRelay: 'Pelo Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Segue sua conta: diretamente quando ${machine} está acessível, senão pelo Happier.`,
    machineDefaultOffDescription: 'Segue sua conta: sempre pelo Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Diretamente quando ${machine} está acessível, mesmo que sua conta diga o contrário.`,
    machineRelayDescription: 'Sempre pelo Happier, mesmo na mesma rede.',
};

const ru = {
    sectionTitle: 'Подключения',
    sectionDescription: 'Как ваши устройства подключаются к вашим машинам.',
    directTitle: 'Подключаться напрямую, когда возможно',
    directOnDescription: 'Превью, трансляции и передача файлов идут напрямую между вашими устройствами, когда они доступны друг другу, а иначе через Happier.',
    directOffDescription: 'Всё идёт через Happier. Ничто не подключается к вашим машинам напрямую; в одной сети это немного медленнее.',
    serverDenied: 'Сервер вашего Home направляет всё через Happier, поэтому здесь нечего выбирать.',
    machineSectionTitle: 'Подключение',
    machineTitle: ({ machine }: MachineParams) => `Подключение к ${machine}`,
    machineOptionDefault: 'По умолчанию',
    machineOptionDirect: 'Напрямую',
    machineOptionRelay: 'Через Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Как в аккаунте: напрямую, когда ${machine} доступен, иначе через Happier.`,
    machineDefaultOffDescription: 'Как в аккаунте: всегда через Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Напрямую, когда ${machine} доступен, даже если в аккаунте указано иначе.`,
    machineRelayDescription: 'Всегда через Happier, даже в одной сети.',
};

const ca = {
    sectionTitle: 'Connexions',
    sectionDescription: 'Com arriben els teus dispositius a les teves màquines.',
    directTitle: 'Connecta directament quan sigui possible',
    directOnDescription: 'Les previsualitzacions, les vistes en directe i les transferències de fitxers van directament entre els teus dispositius quan s’arriben, i a través de Happier quan no.',
    directOffDescription: 'Tot passa per Happier. Res no es connecta directament a les teves màquines; a la mateixa xarxa és una mica més lent.',
    serverDenied: 'El servidor del teu Home ho fa passar tot per Happier, així que aquí no hi ha res a triar.',
    machineSectionTitle: 'Connexió',
    machineTitle: ({ machine }: MachineParams) => `Connexió amb ${machine}`,
    machineOptionDefault: 'Per defecte',
    machineOptionDirect: 'Directament',
    machineOptionRelay: 'A través de Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `Segueix el teu compte: directament quan ${machine} és accessible, si no a través de Happier.`,
    machineDefaultOffDescription: 'Segueix el teu compte: sempre a través de Happier.',
    machineDirectDescription: ({ machine }: MachineParams) => `Directament quan ${machine} és accessible, encara que el teu compte digui el contrari.`,
    machineRelayDescription: 'Sempre a través de Happier, fins i tot a la mateixa xarxa.',
};

const zhHans = {
    sectionTitle: '连接',
    sectionDescription: '你的设备如何连接到你的机器。',
    directTitle: '尽可能直接连接',
    directOnDescription: '当设备之间可以互相访问时，预览、实时画面和文件传输会直接在设备之间传输，否则通过 Happier。',
    directOffDescription: '所有内容都通过 Happier。不会直接连接到你的机器；在同一网络中会稍慢一些。',
    serverDenied: '你的 Home 服务器让所有内容都通过 Happier，因此这里无需选择。',
    machineSectionTitle: '连接',
    machineTitle: ({ machine }: MachineParams) => `连接到 ${machine}`,
    machineOptionDefault: '默认',
    machineOptionDirect: '直接',
    machineOptionRelay: '通过 Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `跟随你的账户：可以访问 ${machine} 时直接连接，否则通过 Happier。`,
    machineDefaultOffDescription: '跟随你的账户：始终通过 Happier。',
    machineDirectDescription: ({ machine }: MachineParams) => `可以访问 ${machine} 时直接连接，即使你的账户设置不同。`,
    machineRelayDescription: '始终通过 Happier，即使在同一网络中。',
};

const zhHant = {
    sectionTitle: '連線',
    sectionDescription: '你的裝置如何連線到你的機器。',
    directTitle: '盡可能直接連線',
    directOnDescription: '當裝置之間可以互相連線時，預覽、即時畫面和檔案傳輸會直接在裝置之間傳送，否則透過 Happier。',
    directOffDescription: '所有內容都透過 Happier。不會直接連線到你的機器；在同一網路中會稍慢一些。',
    serverDenied: '你的 Home 伺服器讓所有內容都透過 Happier，因此這裡無需選擇。',
    machineSectionTitle: '連線',
    machineTitle: ({ machine }: MachineParams) => `連線到 ${machine}`,
    machineOptionDefault: '預設',
    machineOptionDirect: '直接',
    machineOptionRelay: '透過 Happier',
    machineDefaultDescription: ({ machine }: MachineParams) => `跟隨你的帳戶：可以連線到 ${machine} 時直接連線，否則透過 Happier。`,
    machineDefaultOffDescription: '跟隨你的帳戶：一律透過 Happier。',
    machineDirectDescription: ({ machine }: MachineParams) => `可以連線到 ${machine} 時直接連線，即使你的帳戶設定不同。`,
    machineRelayDescription: '一律透過 Happier，即使在同一網路中。',
};

export const settingsConnectionsTranslations = {
    en, de, es, fr, it, ja, pl, pt, ru, ca, zhHans, zhHant,
};
