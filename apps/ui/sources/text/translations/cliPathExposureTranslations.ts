/**
 * Copy for the desktop "command line" settings group: exposing the managed `happier` binary on the
 * user's PATH, and undoing that. Provenance is a product promise here — Happier only ever touches
 * the entries it created — so every outcome string describes what the owner actually did.
 *
 * `happier`, `PATH` and `Happier Desktop` are a command, an environment variable and a product
 * name: they stay byte-identical in every locale.
 */

const en = {
    title: 'Command line',
    footer: 'Happier Desktop only adds or removes the PATH entries it created. Entries written by the shell installer stay untouched.',
    addTitle: 'Add happier to PATH',
    addSubtitle: 'Make the happier command available in new terminals.',
    removeTitle: 'Remove happier from PATH',
    removeSubtitle: 'Removes only the PATH entries Happier Desktop added.',
    working: 'Updating your shell profile…',
    added: 'Added. Open a new terminal to use happier.',
    alreadyPresent: 'happier is already on your PATH.',
    removed: 'Removed the PATH entries Happier Desktop added.',
    nothingToRemove: 'Happier Desktop has not added any PATH entries.',
};

const de = {
    title: 'Kommandozeile',
    footer: 'Happier Desktop fügt nur PATH-Einträge hinzu oder entfernt sie, die es selbst erstellt hat. Vom Shell-Installer geschriebene Einträge bleiben unberührt.',
    addTitle: 'happier zum PATH hinzufügen',
    addSubtitle: 'Macht den Befehl happier in neuen Terminals verfügbar.',
    removeTitle: 'happier aus dem PATH entfernen',
    removeSubtitle: 'Entfernt nur die PATH-Einträge, die Happier Desktop hinzugefügt hat.',
    working: 'Dein Shell-Profil wird aktualisiert…',
    added: 'Hinzugefügt. Öffne ein neues Terminal, um happier zu nutzen.',
    alreadyPresent: 'happier ist bereits in deinem PATH.',
    removed: 'Die von Happier Desktop hinzugefügten PATH-Einträge wurden entfernt.',
    nothingToRemove: 'Happier Desktop hat keine PATH-Einträge hinzugefügt.',
};

const es = {
    title: 'Línea de comandos',
    footer: 'Happier Desktop solo añade o elimina las entradas de PATH que creó. Las entradas escritas por el instalador de la shell no se tocan.',
    addTitle: 'Añadir happier al PATH',
    addSubtitle: 'Haz que el comando happier esté disponible en las terminales nuevas.',
    removeTitle: 'Quitar happier del PATH',
    removeSubtitle: 'Elimina solo las entradas de PATH que añadió Happier Desktop.',
    working: 'Actualizando tu perfil de shell…',
    added: 'Añadido. Abre una terminal nueva para usar happier.',
    alreadyPresent: 'happier ya está en tu PATH.',
    removed: 'Se eliminaron las entradas de PATH que añadió Happier Desktop.',
    nothingToRemove: 'Happier Desktop no ha añadido ninguna entrada de PATH.',
};

const fr = {
    title: 'Ligne de commande',
    footer: 'Happier Desktop ajoute ou supprime uniquement les entrées PATH qu’il a créées. Les entrées écrites par l’installateur du shell restent intactes.',
    addTitle: 'Ajouter happier au PATH',
    addSubtitle: 'Rends la commande happier disponible dans les nouveaux terminaux.',
    removeTitle: 'Retirer happier du PATH',
    removeSubtitle: 'Supprime uniquement les entrées PATH ajoutées par Happier Desktop.',
    working: 'Mise à jour de ton profil de shell…',
    added: 'Ajouté. Ouvre un nouveau terminal pour utiliser happier.',
    alreadyPresent: 'happier est déjà dans ton PATH.',
    removed: 'Les entrées PATH ajoutées par Happier Desktop ont été supprimées.',
    nothingToRemove: 'Happier Desktop n’a ajouté aucune entrée PATH.',
};

const it = {
    title: 'Riga di comando',
    footer: 'Happier Desktop aggiunge o rimuove solo le voci PATH che ha creato. Le voci scritte dall’installer della shell restano intatte.',
    addTitle: 'Aggiungi happier al PATH',
    addSubtitle: 'Rendi il comando happier disponibile nei nuovi terminali.',
    removeTitle: 'Rimuovi happier dal PATH',
    removeSubtitle: 'Rimuove solo le voci PATH aggiunte da Happier Desktop.',
    working: 'Aggiornamento del profilo della shell…',
    added: 'Aggiunto. Apri un nuovo terminale per usare happier.',
    alreadyPresent: 'happier è già nel tuo PATH.',
    removed: 'Le voci PATH aggiunte da Happier Desktop sono state rimosse.',
    nothingToRemove: 'Happier Desktop non ha aggiunto nessuna voce PATH.',
};

const pt = {
    title: 'Linha de comando',
    footer: 'O Happier Desktop só adiciona ou remove as entradas de PATH que criou. As entradas escritas pelo instalador do shell permanecem intactas.',
    addTitle: 'Adicionar happier ao PATH',
    addSubtitle: 'Deixe o comando happier disponível em novos terminais.',
    removeTitle: 'Remover happier do PATH',
    removeSubtitle: 'Remove apenas as entradas de PATH adicionadas pelo Happier Desktop.',
    working: 'Atualizando seu perfil de shell…',
    added: 'Adicionado. Abra um novo terminal para usar o happier.',
    alreadyPresent: 'O happier já está no seu PATH.',
    removed: 'As entradas de PATH adicionadas pelo Happier Desktop foram removidas.',
    nothingToRemove: 'O Happier Desktop não adicionou nenhuma entrada de PATH.',
};

const ca = {
    title: 'Línia d’ordres',
    footer: 'El Happier Desktop només afegeix o elimina les entrades del PATH que ha creat. Les entrades escrites per l’instal·lador de l’intèrpret d’ordres no es toquen.',
    addTitle: 'Afegeix happier al PATH',
    addSubtitle: 'Fes que l’ordre happier estigui disponible als terminals nous.',
    removeTitle: 'Treu happier del PATH',
    removeSubtitle: 'Només elimina les entrades del PATH que ha afegit el Happier Desktop.',
    working: 'S’està actualitzant el perfil de l’intèrpret d’ordres…',
    added: 'Afegit. Obre un terminal nou per fer servir happier.',
    alreadyPresent: 'happier ja és al teu PATH.',
    removed: 'S’han eliminat les entrades del PATH que havia afegit el Happier Desktop.',
    nothingToRemove: 'El Happier Desktop no ha afegit cap entrada al PATH.',
};

const pl = {
    title: 'Wiersz poleceń',
    footer: 'Happier Desktop dodaje i usuwa tylko te wpisy PATH, które sam utworzył. Wpisy dodane przez instalator powłoki pozostają nietknięte.',
    addTitle: 'Dodaj happier do PATH',
    addSubtitle: 'Udostępnij polecenie happier w nowych terminalach.',
    removeTitle: 'Usuń happier z PATH',
    removeSubtitle: 'Usuwa tylko wpisy PATH dodane przez Happier Desktop.',
    working: 'Aktualizowanie profilu powłoki…',
    added: 'Dodano. Otwórz nowy terminal, aby używać happier.',
    alreadyPresent: 'happier jest już w twoim PATH.',
    removed: 'Usunięto wpisy PATH dodane przez Happier Desktop.',
    nothingToRemove: 'Happier Desktop nie dodał żadnych wpisów PATH.',
};

const ru = {
    title: 'Командная строка',
    footer: 'Happier Desktop добавляет и удаляет только те записи PATH, которые создал сам. Записи, добавленные установщиком оболочки, остаются нетронутыми.',
    addTitle: 'Добавить happier в PATH',
    addSubtitle: 'Сделайте команду happier доступной в новых терминалах.',
    removeTitle: 'Удалить happier из PATH',
    removeSubtitle: 'Удаляет только записи PATH, добавленные Happier Desktop.',
    working: 'Обновляем профиль оболочки…',
    added: 'Добавлено. Откройте новый терминал, чтобы использовать happier.',
    alreadyPresent: 'happier уже есть в вашем PATH.',
    removed: 'Записи PATH, добавленные Happier Desktop, удалены.',
    nothingToRemove: 'Happier Desktop не добавлял записей в PATH.',
};

const ja = {
    title: 'コマンドライン',
    footer: 'Happier Desktop は自分が作成した PATH エントリだけを追加・削除します。シェルのインストーラーが書き込んだエントリはそのままです。',
    addTitle: 'happier を PATH に追加',
    addSubtitle: '新しいターミナルで happier コマンドを使えるようにします。',
    removeTitle: 'happier を PATH から削除',
    removeSubtitle: 'Happier Desktop が追加した PATH エントリだけを削除します。',
    working: 'シェルプロファイルを更新しています…',
    added: '追加しました。新しいターミナルを開くと happier を使えます。',
    alreadyPresent: 'happier はすでに PATH にあります。',
    removed: 'Happier Desktop が追加した PATH エントリを削除しました。',
    nothingToRemove: 'Happier Desktop は PATH エントリを追加していません。',
};

const zhHans = {
    title: '命令行',
    footer: 'Happier Desktop 只会添加或移除它自己创建的 PATH 条目。Shell 安装脚本写入的条目不会被改动。',
    addTitle: '将 happier 添加到 PATH',
    addSubtitle: '让 happier 命令在新终端中可用。',
    removeTitle: '从 PATH 中移除 happier',
    removeSubtitle: '仅移除 Happier Desktop 添加的 PATH 条目。',
    working: '正在更新你的 shell 配置文件…',
    added: '已添加。打开新终端即可使用 happier。',
    alreadyPresent: 'happier 已经在你的 PATH 中。',
    removed: '已移除 Happier Desktop 添加的 PATH 条目。',
    nothingToRemove: 'Happier Desktop 没有添加任何 PATH 条目。',
};

const zhHant = {
    title: '命令列',
    footer: 'Happier Desktop 只會新增或移除它自己建立的 PATH 項目。由 Shell 安裝程式寫入的項目不會更動。',
    addTitle: '將 happier 加入 PATH',
    addSubtitle: '讓 happier 指令可在新的終端機中使用。',
    removeTitle: '從 PATH 移除 happier',
    removeSubtitle: '僅移除 Happier Desktop 新增的 PATH 項目。',
    working: '正在更新你的 shell 設定檔…',
    added: '已新增。開啟新的終端機即可使用 happier。',
    alreadyPresent: 'happier 已在你的 PATH 中。',
    removed: '已移除 Happier Desktop 新增的 PATH 項目。',
    nothingToRemove: 'Happier Desktop 尚未新增任何 PATH 項目。',
};

export const cliPathExposureTranslations = {
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
