/**
 * Folder-less sessions: the new-session composer's folder chip (`newSession.folder`) and how a
 * session without a user folder reads everywhere it appears (`session.folderless`).
 *
 * "Private" means "not chosen by you and not shared with other people on this computer". None of
 * this copy promises isolation, and none of it names the mechanism ("managed", "allocation").
 */

const en = {
    composer: {
        addFolder: 'Add folder',
        noFolder: 'No folder',
        noFolderDescription: 'Happier keeps a private folder for this chat',
        removeFolder: 'Remove folder',
        a11y: {
            folder: ({ path }: { path: string }) => `Folder: ${path}. Opens folder choices.`,
            none: 'No folder. Happier keeps a private folder for this chat. Add folder.',
            loading: 'Folder loading',
            noFolderRow: 'No folder, private folder for this chat',
            removed: 'Folder removed',
            set: ({ path }: { path: string }) => `Folder set to ${path}`,
        },
    },
    display: {
        chats: 'Chats',
        untitledChat: 'New chat',
        folder: 'Folder',
        privateToSession: 'Private to this session',
        sessionFiles: 'Session files',
        privateFolderOn: ({ machine }: { machine: string }) => `Private folder on ${machine}`,
    },
};

type FolderlessSessionTranslations = typeof en;

const de: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Ordner hinzufügen',
        noFolder: 'Kein Ordner',
        noFolderDescription: 'Happier legt für diesen Chat einen privaten Ordner an',
        removeFolder: 'Ordner entfernen',
        a11y: {
            folder: ({ path }) => `Ordner: ${path}. Öffnet die Ordnerauswahl.`,
            none: 'Kein Ordner. Happier legt für diesen Chat einen privaten Ordner an. Ordner hinzufügen.',
            loading: 'Ordner wird geladen',
            noFolderRow: 'Kein Ordner, privater Ordner für diesen Chat',
            removed: 'Ordner entfernt',
            set: ({ path }) => `Ordner auf ${path} gesetzt`,
        },
    },
    display: {
        chats: 'Chats',
        untitledChat: 'Neuer Chat',
        folder: 'Ordner',
        privateToSession: 'Nur für diese Sitzung',
        sessionFiles: 'Sitzungsdateien',
        privateFolderOn: ({ machine }) => `Privater Ordner auf ${machine}`,
    },
};

const es: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Añadir carpeta',
        noFolder: 'Sin carpeta',
        noFolderDescription: 'Happier guarda una carpeta privada para este chat',
        removeFolder: 'Quitar carpeta',
        a11y: {
            folder: ({ path }) => `Carpeta: ${path}. Abre las opciones de carpeta.`,
            none: 'Sin carpeta. Happier guarda una carpeta privada para este chat. Añadir carpeta.',
            loading: 'Cargando carpeta',
            noFolderRow: 'Sin carpeta, carpeta privada para este chat',
            removed: 'Carpeta quitada',
            set: ({ path }) => `Carpeta establecida en ${path}`,
        },
    },
    display: {
        chats: 'Chats',
        untitledChat: 'Nuevo chat',
        folder: 'Carpeta',
        privateToSession: 'Solo de esta sesión',
        sessionFiles: 'Archivos de la sesión',
        privateFolderOn: ({ machine }) => `Carpeta privada en ${machine}`,
    },
};

const fr: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Ajouter un dossier',
        noFolder: 'Aucun dossier',
        noFolderDescription: 'Happier garde un dossier privé pour cette discussion',
        removeFolder: 'Retirer le dossier',
        a11y: {
            folder: ({ path }) => `Dossier : ${path}. Ouvre le choix du dossier.`,
            none: 'Aucun dossier. Happier garde un dossier privé pour cette discussion. Ajouter un dossier.',
            loading: 'Chargement du dossier',
            noFolderRow: 'Aucun dossier, dossier privé pour cette discussion',
            removed: 'Dossier retiré',
            set: ({ path }) => `Dossier défini sur ${path}`,
        },
    },
    display: {
        chats: 'Discussions',
        untitledChat: 'Nouvelle discussion',
        folder: 'Dossier',
        privateToSession: 'Propre à cette session',
        sessionFiles: 'Fichiers de la session',
        privateFolderOn: ({ machine }) => `Dossier privé sur ${machine}`,
    },
};

const it: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Aggiungi cartella',
        noFolder: 'Nessuna cartella',
        noFolderDescription: 'Happier tiene una cartella privata per questa chat',
        removeFolder: 'Rimuovi cartella',
        a11y: {
            folder: ({ path }) => `Cartella: ${path}. Apre la scelta della cartella.`,
            none: 'Nessuna cartella. Happier tiene una cartella privata per questa chat. Aggiungi cartella.',
            loading: 'Caricamento cartella',
            noFolderRow: 'Nessuna cartella, cartella privata per questa chat',
            removed: 'Cartella rimossa',
            set: ({ path }) => `Cartella impostata su ${path}`,
        },
    },
    display: {
        chats: 'Chat',
        untitledChat: 'Nuova chat',
        folder: 'Cartella',
        privateToSession: 'Solo per questa sessione',
        sessionFiles: 'File della sessione',
        privateFolderOn: ({ machine }) => `Cartella privata su ${machine}`,
    },
};

const ja: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'フォルダを追加',
        noFolder: 'フォルダなし',
        noFolderDescription: 'Happier がこのチャット専用のフォルダを用意します',
        removeFolder: 'フォルダを外す',
        a11y: {
            folder: ({ path }) => `フォルダ: ${path}。フォルダの選択を開きます。`,
            none: 'フォルダなし。Happier がこのチャット専用のフォルダを用意します。フォルダを追加。',
            loading: 'フォルダを読み込み中',
            noFolderRow: 'フォルダなし、このチャット専用のフォルダ',
            removed: 'フォルダを外しました',
            set: ({ path }) => `フォルダを ${path} に設定しました`,
        },
    },
    display: {
        chats: 'チャット',
        untitledChat: '新しいチャット',
        folder: 'フォルダ',
        privateToSession: 'このセッション専用',
        sessionFiles: 'セッションのファイル',
        privateFolderOn: ({ machine }) => `${machine} の専用フォルダ`,
    },
};

const pl: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Dodaj folder',
        noFolder: 'Bez folderu',
        noFolderDescription: 'Happier prowadzi prywatny folder dla tego czatu',
        removeFolder: 'Usuń folder',
        a11y: {
            folder: ({ path }) => `Folder: ${path}. Otwiera wybór folderu.`,
            none: 'Bez folderu. Happier prowadzi prywatny folder dla tego czatu. Dodaj folder.',
            loading: 'Wczytywanie folderu',
            noFolderRow: 'Bez folderu, prywatny folder dla tego czatu',
            removed: 'Folder usunięty',
            set: ({ path }) => `Ustawiono folder ${path}`,
        },
    },
    display: {
        chats: 'Czaty',
        untitledChat: 'Nowy czat',
        folder: 'Folder',
        privateToSession: 'Tylko dla tej sesji',
        sessionFiles: 'Pliki sesji',
        privateFolderOn: ({ machine }) => `Prywatny folder na ${machine}`,
    },
};

const pt: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Adicionar pasta',
        noFolder: 'Sem pasta',
        noFolderDescription: 'O Happier mantém uma pasta privada para este chat',
        removeFolder: 'Remover pasta',
        a11y: {
            folder: ({ path }) => `Pasta: ${path}. Abre a escolha de pasta.`,
            none: 'Sem pasta. O Happier mantém uma pasta privada para este chat. Adicionar pasta.',
            loading: 'Carregando pasta',
            noFolderRow: 'Sem pasta, pasta privada para este chat',
            removed: 'Pasta removida',
            set: ({ path }) => `Pasta definida como ${path}`,
        },
    },
    display: {
        chats: 'Chats',
        untitledChat: 'Novo chat',
        folder: 'Pasta',
        privateToSession: 'Só desta sessão',
        sessionFiles: 'Arquivos da sessão',
        privateFolderOn: ({ machine }) => `Pasta privada em ${machine}`,
    },
};

const ru: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Добавить папку',
        noFolder: 'Без папки',
        noFolderDescription: 'Happier ведёт для этого чата отдельную папку',
        removeFolder: 'Убрать папку',
        a11y: {
            folder: ({ path }) => `Папка: ${path}. Открывает выбор папки.`,
            none: 'Без папки. Happier ведёт для этого чата отдельную папку. Добавить папку.',
            loading: 'Папка загружается',
            noFolderRow: 'Без папки, отдельная папка для этого чата',
            removed: 'Папка убрана',
            set: ({ path }) => `Выбрана папка ${path}`,
        },
    },
    display: {
        chats: 'Чаты',
        untitledChat: 'Новый чат',
        folder: 'Папка',
        privateToSession: 'Только для этой сессии',
        sessionFiles: 'Файлы сессии',
        privateFolderOn: ({ machine }) => `Отдельная папка на ${machine}`,
    },
};

const ca: FolderlessSessionTranslations = {
    composer: {
        addFolder: 'Afegeix una carpeta',
        noFolder: 'Sense carpeta',
        noFolderDescription: 'El Happier manté una carpeta privada per a aquest xat',
        removeFolder: 'Treu la carpeta',
        a11y: {
            folder: ({ path }) => `Carpeta: ${path}. Obre les opcions de carpeta.`,
            none: 'Sense carpeta. El Happier manté una carpeta privada per a aquest xat. Afegeix una carpeta.',
            loading: 'S’està carregant la carpeta',
            noFolderRow: 'Sense carpeta, carpeta privada per a aquest xat',
            removed: 'S’ha tret la carpeta',
            set: ({ path }) => `Carpeta establerta a ${path}`,
        },
    },
    display: {
        chats: 'Xats',
        untitledChat: 'Xat nou',
        folder: 'Carpeta',
        privateToSession: 'Només d’aquesta sessió',
        sessionFiles: 'Fitxers de la sessió',
        privateFolderOn: ({ machine }) => `Carpeta privada a ${machine}`,
    },
};

const zhHans: FolderlessSessionTranslations = {
    composer: {
        addFolder: '添加文件夹',
        noFolder: '不使用文件夹',
        noFolderDescription: 'Happier 会为此对话保留一个私有文件夹',
        removeFolder: '移除文件夹',
        a11y: {
            folder: ({ path }) => `文件夹：${path}。打开文件夹选项。`,
            none: '不使用文件夹。Happier 会为此对话保留一个私有文件夹。添加文件夹。',
            loading: '正在加载文件夹',
            noFolderRow: '不使用文件夹，此对话的私有文件夹',
            removed: '已移除文件夹',
            set: ({ path }) => `文件夹已设为 ${path}`,
        },
    },
    display: {
        chats: '对话',
        untitledChat: '新对话',
        folder: '文件夹',
        privateToSession: '仅限此会话',
        sessionFiles: '会话文件',
        privateFolderOn: ({ machine }) => `${machine} 上的私有文件夹`,
    },
};

const zhHant: FolderlessSessionTranslations = {
    composer: {
        addFolder: '新增資料夾',
        noFolder: '不使用資料夾',
        noFolderDescription: 'Happier 會為此對話保留一個私人資料夾',
        removeFolder: '移除資料夾',
        a11y: {
            folder: ({ path }) => `資料夾：${path}。開啟資料夾選項。`,
            none: '不使用資料夾。Happier 會為此對話保留一個私人資料夾。新增資料夾。',
            loading: '正在載入資料夾',
            noFolderRow: '不使用資料夾，此對話的私人資料夾',
            removed: '已移除資料夾',
            set: ({ path }) => `資料夾已設為 ${path}`,
        },
    },
    display: {
        chats: '對話',
        untitledChat: '新對話',
        folder: '資料夾',
        privateToSession: '僅限此工作階段',
        sessionFiles: '工作階段檔案',
        privateFolderOn: ({ machine }) => `${machine} 上的私人資料夾`,
    },
};

export const folderlessSessionTranslations = {
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
