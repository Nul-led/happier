const en = {
    title: ({ machine }: { machine: string }) => `This chat’s private folder is no longer on ${machine}.`,
    body: 'You can continue in a fresh, empty folder. Your chat history will stay here, but local files from the old folder will not be restored.',
    continue: 'Continue in a fresh folder',
    notNow: 'Not now',
    offlineDelete: ({ machine }: { machine: string }) => `Its private folder on ${machine} will be removed when that computer is next online.`,
};

export const sessionDirectoryRecoveryTranslations = {
    en,
    ca: {
        title: ({ machine }) => `La carpeta privada d’aquest xat ja no és a ${machine}.`,
        body: 'Pots continuar en una carpeta nova i buida. L’historial del xat es conservarà aquí, però no es restauraran els fitxers locals de la carpeta anterior.',
        continue: 'Continua en una carpeta nova', notNow: 'Ara no',
        offlineDelete: ({ machine }) => `La seva carpeta privada a ${machine} s’eliminarà quan l’ordinador torni a estar en línia.`,
    },
    de: {
        title: ({ machine }) => `Der private Ordner dieses Chats ist nicht mehr auf ${machine}.`,
        body: 'Du kannst in einem neuen, leeren Ordner fortfahren. Dein Chatverlauf bleibt hier erhalten, lokale Dateien aus dem alten Ordner werden jedoch nicht wiederhergestellt.',
        continue: 'In einem neuen Ordner fortfahren', notNow: 'Nicht jetzt',
        offlineDelete: ({ machine }) => `Der private Ordner auf ${machine} wird gelöscht, sobald der Computer wieder online ist.`,
    },
    es: {
        title: ({ machine }) => `La carpeta privada de este chat ya no está en ${machine}.`,
        body: 'Puedes continuar en una carpeta nueva y vacía. El historial del chat se conservará aquí, pero no se restaurarán los archivos locales de la carpeta anterior.',
        continue: 'Continuar en una carpeta nueva', notNow: 'Ahora no',
        offlineDelete: ({ machine }) => `Su carpeta privada en ${machine} se eliminará cuando ese ordenador vuelva a estar en línea.`,
    },
    fr: {
        title: ({ machine }) => `Le dossier privé de ce chat n’est plus sur ${machine}.`,
        body: 'Tu peux continuer dans un nouveau dossier vide. Ton historique restera ici, mais les fichiers locaux de l’ancien dossier ne seront pas restaurés.',
        continue: 'Continuer dans un nouveau dossier', notNow: 'Pas maintenant',
        offlineDelete: ({ machine }) => `Son dossier privé sur ${machine} sera supprimé quand cet ordinateur sera de nouveau en ligne.`,
    },
    it: {
        title: ({ machine }) => `La cartella privata di questa chat non è più su ${machine}.`,
        body: 'Puoi continuare in una cartella nuova e vuota. La cronologia della chat resterà qui, ma i file locali della vecchia cartella non verranno ripristinati.',
        continue: 'Continua in una nuova cartella', notNow: 'Non ora',
        offlineDelete: ({ machine }) => `La sua cartella privata su ${machine} verrà rimossa quando quel computer tornerà online.`,
    },
    ja: {
        title: ({ machine }) => `このチャットの専用フォルダーは ${machine} にありません。`,
        body: '新しい空のフォルダーで続行できます。チャット履歴はここに残りますが、以前のフォルダーのローカルファイルは復元されません。',
        continue: '新しいフォルダーで続行', notNow: '今はしない',
        offlineDelete: ({ machine }) => `${machine} の専用フォルダーは、そのコンピューターが次にオンラインになったときに削除されます。`,
    },
    pl: {
        title: ({ machine }) => `Prywatnego folderu tego czatu nie ma już na ${machine}.`,
        body: 'Możesz kontynuować w nowym, pustym folderze. Historia czatu pozostanie tutaj, ale lokalne pliki ze starego folderu nie zostaną przywrócone.',
        continue: 'Kontynuuj w nowym folderze', notNow: 'Nie teraz',
        offlineDelete: ({ machine }) => `Prywatny folder na ${machine} zostanie usunięty, gdy ten komputer ponownie będzie online.`,
    },
    pt: {
        title: ({ machine }) => `A pasta privada desta conversa já não está em ${machine}.`,
        body: 'Podes continuar numa pasta nova e vazia. O histórico da conversa ficará aqui, mas os ficheiros locais da pasta antiga não serão restaurados.',
        continue: 'Continuar numa pasta nova', notNow: 'Agora não',
        offlineDelete: ({ machine }) => `A pasta privada em ${machine} será removida quando esse computador voltar a estar online.`,
    },
    ru: {
        title: ({ machine }) => `Личной папки этого чата больше нет на ${machine}.`,
        body: 'Можно продолжить в новой пустой папке. История чата останется здесь, но локальные файлы из прежней папки не будут восстановлены.',
        continue: 'Продолжить в новой папке', notNow: 'Не сейчас',
        offlineDelete: ({ machine }) => `Личная папка на ${machine} будет удалена, когда этот компьютер снова появится в сети.`,
    },
    'zh-Hans': {
        title: ({ machine }) => `此聊天的专用文件夹已不在 ${machine} 上。`,
        body: '你可以在一个新的空文件夹中继续。聊天记录会保留在这里，但旧文件夹中的本地文件不会恢复。',
        continue: '在新文件夹中继续', notNow: '暂时不',
        offlineDelete: ({ machine }) => `${machine} 上的专用文件夹将在该电脑下次上线时删除。`,
    },
    'zh-Hant': {
        title: ({ machine }) => `此聊天的專用資料夾已不在 ${machine} 上。`,
        body: '你可以在一個新的空資料夾中繼續。聊天記錄會保留在這裡，但舊資料夾中的本機檔案不會復原。',
        continue: '在新資料夾中繼續', notNow: '暫時不要',
        offlineDelete: ({ machine }) => `${machine} 上的專用資料夾將在該電腦下次上線時刪除。`,
    },
} satisfies Record<import('../_all').SupportedLanguage, typeof en>;
