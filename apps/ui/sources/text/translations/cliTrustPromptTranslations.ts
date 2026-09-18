/**
 * The one ask before this app approves a pairing request from a command line its own install path
 * did not place — a repo checkout, an env override, or a binary someone dropped into the managed
 * directory without installing it.
 *
 * The managed case never reaches here: it is approved silently, so ordinary first-run onboarding
 * stays zero-interaction. What arrives here would otherwise be a dead end — setup could only fail
 * and offer a Retry that failed identically forever, which locks out every developer and fork
 * running a CLI they built themselves.
 *
 * The question names the resolved binary because that is the fact the person can actually judge.
 * The marker this app reads is an install-ownership record, not proof of publisher identity, so a
 * human — not a plain text file — is the right authority for the unattended case it does not cover.
 *
 * `Happier` is a product name and the command path is a filesystem path: both stay byte-identical
 * in every locale.
 */

const en = {
    title: 'Approve this command line?',
    body: ({ command }: { command: string }) => `Happier didn’t install the command line at ${command}. Approving lets it read and write this account’s sessions. Only approve one you put there yourself.`,
    bodyUnknownCommand: 'Happier didn’t install this command line. Approving lets it read and write this account’s sessions. Only approve one you put there yourself.',
    approve: 'Approve',
};

const de = {
    title: 'Diese Befehlszeile freigeben?',
    body: ({ command }: { command: string }) => `Happier hat die Befehlszeile unter ${command} nicht installiert. Mit der Freigabe kann sie die Sitzungen dieses Kontos lesen und schreiben. Gib nur frei, was du selbst dort abgelegt hast.`,
    bodyUnknownCommand: 'Happier hat diese Befehlszeile nicht installiert. Mit der Freigabe kann sie die Sitzungen dieses Kontos lesen und schreiben. Gib nur frei, was du selbst dort abgelegt hast.',
    approve: 'Freigeben',
};

const es = {
    title: '¿Aprobar esta línea de comandos?',
    body: ({ command }: { command: string }) => `Happier no instaló la línea de comandos en ${command}. Aprobarla le permite leer y escribir las sesiones de esta cuenta. Aprueba solo la que hayas puesto tú.`,
    bodyUnknownCommand: 'Happier no instaló esta línea de comandos. Aprobarla le permite leer y escribir las sesiones de esta cuenta. Aprueba solo la que hayas puesto tú.',
    approve: 'Aprobar',
};

const fr = {
    title: 'Approuver cette ligne de commande ?',
    body: ({ command }: { command: string }) => `Happier n’a pas installé la ligne de commande située à ${command}. L’approuver lui permet de lire et d’écrire les sessions de ce compte. N’approuvez que celle que vous y avez placée vous-même.`,
    bodyUnknownCommand: 'Happier n’a pas installé cette ligne de commande. L’approuver lui permet de lire et d’écrire les sessions de ce compte. N’approuvez que celle que vous y avez placée vous-même.',
    approve: 'Approuver',
};

const it = {
    title: 'Approvare questa riga di comando?',
    body: ({ command }: { command: string }) => `Happier non ha installato la riga di comando in ${command}. Approvarla le consente di leggere e scrivere le sessioni di questo account. Approva solo quella che hai messo tu.`,
    bodyUnknownCommand: 'Happier non ha installato questa riga di comando. Approvarla le consente di leggere e scrivere le sessioni di questo account. Approva solo quella che hai messo tu.',
    approve: 'Approva',
};

const ja = {
    title: 'このコマンドラインを承認しますか？',
    body: ({ command }: { command: string }) => `${command} のコマンドラインは Happier がインストールしたものではありません。承認すると、このアカウントのセッションを読み書きできるようになります。自分で配置したものだけを承認してください。`,
    bodyUnknownCommand: 'このコマンドラインは Happier がインストールしたものではありません。承認すると、このアカウントのセッションを読み書きできるようになります。自分で配置したものだけを承認してください。',
    approve: '承認',
};

const pl = {
    title: 'Zatwierdzić ten wiersz poleceń?',
    body: ({ command }: { command: string }) => `Happier nie zainstalował wiersza poleceń w ${command}. Zatwierdzenie pozwoli mu odczytywać i zapisywać sesje tego konta. Zatwierdź tylko ten, który sam tam umieściłeś.`,
    bodyUnknownCommand: 'Happier nie zainstalował tego wiersza poleceń. Zatwierdzenie pozwoli mu odczytywać i zapisywać sesje tego konta. Zatwierdź tylko ten, który sam tam umieściłeś.',
    approve: 'Zatwierdź',
};

const pt = {
    title: 'Aprovar esta linha de comandos?',
    body: ({ command }: { command: string }) => `O Happier não instalou a linha de comandos em ${command}. Aprová-la permite-lhe ler e escrever as sessões desta conta. Aprove apenas a que colocou você mesmo.`,
    bodyUnknownCommand: 'O Happier não instalou esta linha de comandos. Aprová-la permite-lhe ler e escrever as sessões desta conta. Aprove apenas a que colocou você mesmo.',
    approve: 'Aprovar',
};

const ru = {
    title: 'Разрешить эту командную строку?',
    body: ({ command }: { command: string }) => `Happier не устанавливал командную строку в ${command}. Разрешение даст ей доступ на чтение и запись сессий этой учётной записи. Разрешайте только ту, что поместили туда сами.`,
    bodyUnknownCommand: 'Happier не устанавливал эту командную строку. Разрешение даст ей доступ на чтение и запись сессий этой учётной записи. Разрешайте только ту, что поместили туда сами.',
    approve: 'Разрешить',
};

const ca = {
    title: 'Voleu aprovar aquesta línia d’ordres?',
    body: ({ command }: { command: string }) => `El Happier no ha instal·lat la línia d’ordres a ${command}. Aprovar-la li permet llegir i escriure les sessions d’aquest compte. Aproveu només la que hi hàgiu posat vosaltres.`,
    bodyUnknownCommand: 'El Happier no ha instal·lat aquesta línia d’ordres. Aprovar-la li permet llegir i escriure les sessions d’aquest compte. Aproveu només la que hi hàgiu posat vosaltres.',
    approve: 'Aprova',
};

const zhHans = {
    title: '要批准此命令行吗？',
    body: ({ command }: { command: string }) => `${command} 处的命令行不是 Happier 安装的。批准后它可以读写此账户的会话。请仅批准你自己放在那里的程序。`,
    bodyUnknownCommand: '此命令行不是 Happier 安装的。批准后它可以读写此账户的会话。请仅批准你自己放在那里的程序。',
    approve: '批准',
};

const zhHant = {
    title: '要核准此命令列嗎？',
    body: ({ command }: { command: string }) => `${command} 處的命令列不是 Happier 安裝的。核准後它可以讀寫此帳戶的對話。請僅核准你自己放在那裡的程式。`,
    bodyUnknownCommand: '此命令列不是 Happier 安裝的。核准後它可以讀寫此帳戶的對話。請僅核准你自己放在那裡的程式。',
    approve: '核准',
};

export const cliTrustPromptTranslations = {
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
