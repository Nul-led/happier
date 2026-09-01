type WorkspaceSyncDiagnosticTranslation = Readonly<{
    diagnostics: Readonly<{
        title: string;
        relationshipId: string;
        controllerMachineId: string;
        alphaMachineId: string;
        betaMachineId: string;
        alphaRoot: string;
        betaRoot: string;
        engineMode: string;
        engineState: string;
        errorCode: string;
    }>;
    resolve: Readonly<{ unverifiedFile: string }>;
}>;

export const workspaceSyncDiagnosticTranslations = {
    de: {
        diagnostics: { title: 'Diagnose', relationshipId: 'Beziehungs-ID', controllerMachineId: 'ID des Controller-Rechners', alphaMachineId: 'ID des Quellrechners', betaMachineId: 'ID des Zielrechners', alphaRoot: 'Aktueller Quellordner', betaRoot: 'Aktueller Zielordner', engineMode: 'Engine-Modus', engineState: 'Engine-Status', errorCode: 'Fehlercode' },
        resolve: { unverifiedFile: 'Eine Version ohne aktuellen Datei-Fingerabdruck kann nicht sicher entfernt werden. Aktualisiere den Konflikt und versuch es erneut.' },
    },
    ru: {
        diagnostics: { title: 'Диагностика', relationshipId: 'Идентификатор связи', controllerMachineId: 'Идентификатор управляющего компьютера', alphaMachineId: 'Идентификатор исходного компьютера', betaMachineId: 'Идентификатор целевого компьютера', alphaRoot: 'Текущая исходная папка', betaRoot: 'Текущая целевая папка', engineMode: 'Режим движка', engineState: 'Состояние движка', errorCode: 'Код ошибки' },
        resolve: { unverifiedFile: 'Версию без актуального отпечатка файла нельзя безопасно удалить. Обновите конфликт и повторите попытку.' },
    },
    pl: {
        diagnostics: { title: 'Diagnostyka', relationshipId: 'Identyfikator relacji', controllerMachineId: 'Identyfikator komputera sterującego', alphaMachineId: 'Identyfikator komputera źródłowego', betaMachineId: 'Identyfikator komputera docelowego', alphaRoot: 'Bieżący katalog źródłowy', betaRoot: 'Bieżący katalog docelowy', engineMode: 'Tryb silnika', engineState: 'Stan silnika', errorCode: 'Kod błędu' },
        resolve: { unverifiedFile: 'Nie można bezpiecznie usunąć wersji bez aktualnego odcisku pliku. Odśwież konflikt i spróbuj ponownie.' },
    },
    es: {
        diagnostics: { title: 'Diagnóstico', relationshipId: 'ID de relación', controllerMachineId: 'ID del equipo controlador', alphaMachineId: 'ID del equipo de origen', betaMachineId: 'ID del equipo de destino', alphaRoot: 'Carpeta de origen actual', betaRoot: 'Carpeta de destino actual', engineMode: 'Modo del motor', engineState: 'Estado del motor', errorCode: 'Código de error' },
        resolve: { unverifiedFile: 'No se puede eliminar de forma segura una versión sin una huella actual del archivo. Actualiza el conflicto e inténtalo de nuevo.' },
    },
    fr: {
        diagnostics: { title: 'Diagnostic', relationshipId: 'ID de la relation', controllerMachineId: 'ID de la machine de contrôle', alphaMachineId: 'ID de la machine source', betaMachineId: 'ID de la machine de destination', alphaRoot: 'Dossier source actuel', betaRoot: 'Dossier de destination actuel', engineMode: 'Mode du moteur', engineState: 'État du moteur', errorCode: 'Code d’erreur' },
        resolve: { unverifiedFile: 'Une version sans empreinte de fichier actuelle ne peut pas être supprimée en toute sécurité. Actualise le conflit et réessaie.' },
    },
    it: {
        diagnostics: { title: 'Diagnostica', relationshipId: 'ID relazione', controllerMachineId: 'ID macchina di controllo', alphaMachineId: 'ID macchina sorgente', betaMachineId: 'ID macchina di destinazione', alphaRoot: 'Cartella sorgente attuale', betaRoot: 'Cartella di destinazione attuale', engineMode: 'Modalità motore', engineState: 'Stato motore', errorCode: 'Codice errore' },
        resolve: { unverifiedFile: 'Una versione senza un’impronta attuale del file non può essere rimossa in sicurezza. Aggiorna il conflitto e riprova.' },
    },
    pt: {
        diagnostics: { title: 'Diagnóstico', relationshipId: 'ID da relação', controllerMachineId: 'ID do computador controlador', alphaMachineId: 'ID do computador de origem', betaMachineId: 'ID do computador de destino', alphaRoot: 'Pasta de origem atual', betaRoot: 'Pasta de destino atual', engineMode: 'Modo do motor', engineState: 'Estado do motor', errorCode: 'Código de erro' },
        resolve: { unverifiedFile: 'Uma versão sem uma impressão digital atual do ficheiro não pode ser removida em segurança. Atualize o conflito e tente novamente.' },
    },
    ca: {
        diagnostics: { title: 'Diagnòstic', relationshipId: 'ID de la relació', controllerMachineId: 'ID de l’ordinador controlador', alphaMachineId: 'ID de l’ordinador d’origen', betaMachineId: 'ID de l’ordinador de destinació', alphaRoot: 'Carpeta d’origen actual', betaRoot: 'Carpeta de destinació actual', engineMode: 'Mode del motor', engineState: 'Estat del motor', errorCode: 'Codi d’error' },
        resolve: { unverifiedFile: 'No es pot eliminar de manera segura una versió sense una empremta actual del fitxer. Actualitza el conflicte i torna-ho a provar.' },
    },
    'zh-Hans': {
        diagnostics: { title: '诊断', relationshipId: '关系 ID', controllerMachineId: '控制机器 ID', alphaMachineId: '源机器 ID', betaMachineId: '目标机器 ID', alphaRoot: '当前源文件夹', betaRoot: '当前目标文件夹', engineMode: '引擎模式', engineState: '引擎状态', errorCode: '错误代码' },
        resolve: { unverifiedFile: '无法安全移除没有当前文件指纹的版本。请刷新冲突后重试。' },
    },
    'zh-Hant': {
        diagnostics: { title: '診斷', relationshipId: '關係 ID', controllerMachineId: '控制機器 ID', alphaMachineId: '來源機器 ID', betaMachineId: '目標機器 ID', alphaRoot: '目前來源資料夾', betaRoot: '目前目標資料夾', engineMode: '引擎模式', engineState: '引擎狀態', errorCode: '錯誤代碼' },
        resolve: { unverifiedFile: '無法安全移除沒有目前檔案指紋的版本。請重新整理衝突後再試一次。' },
    },
    ja: {
        diagnostics: { title: '診断', relationshipId: '関係 ID', controllerMachineId: '制御マシン ID', alphaMachineId: 'ソースマシン ID', betaMachineId: '宛先マシン ID', alphaRoot: '現在のソースフォルダー', betaRoot: '現在の宛先フォルダー', engineMode: 'エンジンモード', engineState: 'エンジン状態', errorCode: 'エラーコード' },
        resolve: { unverifiedFile: '現在のファイル指紋がないバージョンは安全に削除できません。競合を更新してから、もう一度お試しください。' },
    },
} as const satisfies Record<string, WorkspaceSyncDiagnosticTranslation>;
