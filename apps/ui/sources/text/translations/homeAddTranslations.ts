type HomeAddTranslation = Readonly<{
    addressIsSignInService: string;
    mixedContent: string;
    connectedToHome: (params: Readonly<{ home: string }>) => string;
    openHome: (params: Readonly<{ home: string }>) => string;
    showAllHomes: string;
    otherSignInService: string;
    otherSignInServiceSubtitle: string;
    signInServiceAddress: string;
}>;

const en: HomeAddTranslation = {
    addressIsSignInService: 'This address is a sign-in service. Sign in through it to find your Homes.',
    mixedContent: 'This browser cannot connect to an HTTP Home from an HTTPS page. Open Happier over HTTP or use an HTTPS Home address.',
    connectedToHome: ({ home }) => `${home} is connected to this device.`,
    openHome: ({ home }) => `Open ${home}`,
    showAllHomes: 'Show All Homes',
    otherSignInService: 'Another sign-in service',
    otherSignInServiceSubtitle: 'A self-hosted or company service',
    signInServiceAddress: 'Service address',
};

export const homeAddTranslations = {
    en,
    ca: {
        addressIsSignInService: 'Aquesta adreça és un servei d’inici de sessió. Inicia-hi la sessió per trobar els teus Homes.',
        mixedContent: 'Aquest navegador no pot connectar-se a un Home HTTP des d’una pàgina HTTPS. Obre Happier amb HTTP o fes servir una adreça HTTPS per al Home.',
        connectedToHome: ({ home }) => `${home} està connectat a aquest dispositiu.`,
        openHome: ({ home }) => `Obre ${home}`,
        showAllHomes: 'Mostra tots els Homes',
        otherSignInService: 'Un altre servei d’inici de sessió',
        otherSignInServiceSubtitle: 'Un servei autoallotjat o d’empresa',
        signInServiceAddress: 'Adreça del servei',
    },
    de: {
        addressIsSignInService: 'Diese Adresse gehört zu einem Anmeldedienst. Melde dich dort an, um deine Homes zu finden.',
        mixedContent: 'Dieser Browser kann von einer HTTPS-Seite aus keine Verbindung zu einem HTTP-Home herstellen. Öffne Happier über HTTP oder verwende eine HTTPS-Adresse für das Home.',
        connectedToHome: ({ home }) => `${home} ist mit diesem Gerät verbunden.`,
        openHome: ({ home }) => `${home} öffnen`,
        showAllHomes: 'Alle Homes anzeigen',
        otherSignInService: 'Anderer Anmeldedienst',
        otherSignInServiceSubtitle: 'Ein selbst gehosteter oder Firmendienst',
        signInServiceAddress: 'Adresse des Dienstes',
    },
    es: {
        addressIsSignInService: 'Esta dirección corresponde a un servicio de inicio de sesión. Inicia sesión allí para encontrar tus Homes.',
        mixedContent: 'Este navegador no puede conectarse a un Home HTTP desde una página HTTPS. Abre Happier mediante HTTP o utiliza una dirección HTTPS para el Home.',
        connectedToHome: ({ home }) => `${home} está conectado a este dispositivo.`,
        openHome: ({ home }) => `Abrir ${home}`,
        showAllHomes: 'Mostrar todos los Homes',
        otherSignInService: 'Otro servicio de inicio de sesión',
        otherSignInServiceSubtitle: 'Un servicio autoalojado o de empresa',
        signInServiceAddress: 'Dirección del servicio',
    },
    fr: {
        addressIsSignInService: 'Cette adresse correspond à un service de connexion. Connectez-vous à ce service pour retrouver vos Homes.',
        mixedContent: 'Ce navigateur ne peut pas se connecter à un Home HTTP depuis une page HTTPS. Ouvrez Happier en HTTP ou utilisez une adresse HTTPS pour le Home.',
        connectedToHome: ({ home }) => `${home} est connecté à cet appareil.`,
        openHome: ({ home }) => `Ouvrir ${home}`,
        showAllHomes: 'Afficher tous les Homes',
        otherSignInService: 'Autre service de connexion',
        otherSignInServiceSubtitle: 'Un service auto-hébergé ou d’entreprise',
        signInServiceAddress: 'Adresse du service',
    },
    it: {
        addressIsSignInService: 'Questo indirizzo appartiene a un servizio di accesso. Accedi tramite questo servizio per trovare i tuoi Home.',
        mixedContent: 'Questo browser non può connettersi a un Home HTTP da una pagina HTTPS. Apri Happier tramite HTTP oppure usa un indirizzo HTTPS per il Home.',
        connectedToHome: ({ home }) => `${home} è connesso a questo dispositivo.`,
        openHome: ({ home }) => `Apri ${home}`,
        showAllHomes: 'Mostra tutti i Home',
        otherSignInService: 'Altro servizio di accesso',
        otherSignInServiceSubtitle: 'Un servizio self-hosted o aziendale',
        signInServiceAddress: 'Indirizzo del servizio',
    },
    pt: {
        addressIsSignInService: 'Este endereço pertence a um serviço de início de sessão. Inicie sessão através dele para encontrar os seus Homes.',
        mixedContent: 'Este navegador não pode ligar-se a um Home HTTP a partir de uma página HTTPS. Abra o Happier através de HTTP ou utilize um endereço HTTPS para o Home.',
        connectedToHome: ({ home }) => `${home} está ligado a este dispositivo.`,
        openHome: ({ home }) => `Abrir ${home}`,
        showAllHomes: 'Mostrar todos os Homes',
        otherSignInService: 'Outro serviço de início de sessão',
        otherSignInServiceSubtitle: 'Um serviço auto-hospedado ou da empresa',
        signInServiceAddress: 'Endereço do serviço',
    },
    ja: {
        addressIsSignInService: 'このアドレスはサインインサービスです。このサービスにサインインして、あなたのHomeを見つけてください。',
        mixedContent: 'このブラウザーでは、HTTPSページからHTTPのHomeに接続できません。HappierをHTTPで開くか、HomeのHTTPSアドレスを使用してください。',
        connectedToHome: ({ home }) => `${home}がこのデバイスに接続されました。`,
        openHome: ({ home }) => `${home}を開く`,
        showAllHomes: 'すべてのHomeを表示',
        otherSignInService: '別のサインインサービス',
        otherSignInServiceSubtitle: 'セルフホストまたは会社のサービス',
        signInServiceAddress: 'サービスのアドレス',
    },
    pl: {
        addressIsSignInService: 'Ten adres należy do usługi logowania. Zaloguj się przez nią, aby znaleźć swoje Home.',
        mixedContent: 'Ta przeglądarka nie może połączyć się z Home przez HTTP ze strony HTTPS. Otwórz Happier przez HTTP lub użyj adresu HTTPS dla Home.',
        connectedToHome: ({ home }) => `${home} jest połączony z tym urządzeniem.`,
        openHome: ({ home }) => `Otwórz ${home}`,
        showAllHomes: 'Pokaż wszystkie Home',
        otherSignInService: 'Inna usługa logowania',
        otherSignInServiceSubtitle: 'Usługa hostowana samodzielnie lub firmowa',
        signInServiceAddress: 'Adres usługi',
    },
    ru: {
        addressIsSignInService: 'Этот адрес принадлежит сервису входа. Войдите через него, чтобы найти свои Home.',
        mixedContent: 'Этот браузер не может подключиться к Home по HTTP со страницы HTTPS. Откройте Happier по HTTP или используйте HTTPS-адрес Home.',
        connectedToHome: ({ home }) => `${home} подключён к этому устройству.`,
        openHome: ({ home }) => `Открыть ${home}`,
        showAllHomes: 'Показать все Home',
        otherSignInService: 'Другая служба входа',
        otherSignInServiceSubtitle: 'Собственная или корпоративная служба',
        signInServiceAddress: 'Адрес службы',
    },
    'zh-Hans': {
        addressIsSignInService: '此地址是登录服务。请通过该服务登录，以查找你的 Home。',
        mixedContent: '此浏览器无法从 HTTPS 页面连接到 HTTP Home。请通过 HTTP 打开 Happier，或使用 Home 的 HTTPS 地址。',
        connectedToHome: ({ home }) => `${home} 已连接到此设备。`,
        openHome: ({ home }) => `打开 ${home}`,
        showAllHomes: '显示所有 Home',
        otherSignInService: '其他登录服务',
        otherSignInServiceSubtitle: '自托管或公司服务',
        signInServiceAddress: '服务地址',
    },
    'zh-Hant': {
        addressIsSignInService: '此位址是登入服務。請透過該服務登入，以尋找你的 Home。',
        mixedContent: '此瀏覽器無法從 HTTPS 頁面連線至 HTTP Home。請透過 HTTP 開啟 Happier，或使用 Home 的 HTTPS 位址。',
        connectedToHome: ({ home }) => `${home} 已連線至此裝置。`,
        openHome: ({ home }) => `開啟 ${home}`,
        showAllHomes: '顯示所有 Home',
        otherSignInService: '其他登入服務',
        otherSignInServiceSubtitle: '自行託管或公司服務',
        signInServiceAddress: '服務位址',
    },
} satisfies Record<string, HomeAddTranslation>;
