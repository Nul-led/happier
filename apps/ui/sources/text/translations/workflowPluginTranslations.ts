const en = { fromPlugins: 'From plugins', readOnly: 'Read-only · duplicate to your library to edit', duplicateToLibrary: 'Duplicate to your library' };
type Copy = typeof en;
export const workflowPluginTranslations: Record<'en'|'de'|'es'|'fr'|'it'|'pt'|'ca'|'pl'|'ru'|'ja'|'zhHans'|'zhHant', Copy> = {
    en,
    de: { fromPlugins: 'Aus Plugins', readOnly: 'Schreibgeschützt · zum Bearbeiten in deine Bibliothek kopieren', duplicateToLibrary: 'In deine Bibliothek kopieren' },
    es: { fromPlugins: 'De plugins', readOnly: 'Solo lectura · duplica en tu biblioteca para editar', duplicateToLibrary: 'Duplicar en tu biblioteca' },
    fr: { fromPlugins: 'Depuis les plugins', readOnly: 'Lecture seule · dupliquez dans votre bibliothèque pour modifier', duplicateToLibrary: 'Dupliquer dans votre bibliothèque' },
    it: { fromPlugins: 'Dai plugin', readOnly: 'Sola lettura · duplica nella tua libreria per modificare', duplicateToLibrary: 'Duplica nella tua libreria' },
    pt: { fromPlugins: 'De plugins', readOnly: 'Somente leitura · duplique na sua biblioteca para editar', duplicateToLibrary: 'Duplicar na sua biblioteca' },
    ca: { fromPlugins: 'Dels connectors', readOnly: 'Només lectura · duplica a la teva biblioteca per editar', duplicateToLibrary: 'Duplica a la teva biblioteca' },
    pl: { fromPlugins: 'Z wtyczek', readOnly: 'Tylko do odczytu · skopiuj do biblioteki, aby edytować', duplicateToLibrary: 'Skopiuj do swojej biblioteki' },
    ru: { fromPlugins: 'Из плагинов', readOnly: 'Только чтение · скопируйте в библиотеку для редактирования', duplicateToLibrary: 'Скопировать в вашу библиотеку' },
    ja: { fromPlugins: 'プラグインから', readOnly: '読み取り専用 · 編集するにはライブラリに複製', duplicateToLibrary: 'ライブラリに複製' },
    zhHans: { fromPlugins: '来自插件', readOnly: '只读 · 复制到你的库中以编辑', duplicateToLibrary: '复制到你的库' },
    zhHant: { fromPlugins: '來自外掛', readOnly: '唯讀 · 複製到你的程式庫以編輯', duplicateToLibrary: '複製到你的程式庫' },
};
