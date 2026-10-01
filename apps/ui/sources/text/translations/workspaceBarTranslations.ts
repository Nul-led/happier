type WorkspaceBarTranslation = Readonly<{
    workspaceBar: Readonly<{
        tabsLabel: string;
        tabMenuLabel: string;
        pinTab: string;
        unpinTab: string;
        splitRight: string;
        splitDown: string;
        maximizePane: string;
        restorePane: string;
        closeTab: string;
        closeOtherTabs: string;
        closeTabsToRight: string;
        moreTabs: (params: Readonly<{ count: number }>) => string;
        searchTabs: string;
        splitPane: string;
        openInNewTab: string;
        openToRight: string;
        openBelow: string;
    }>;
}>;

const en: WorkspaceBarTranslation = {
    workspaceBar: {
        tabsLabel: 'Open tabs',
        tabMenuLabel: 'Tab options',
        pinTab: 'Pin tab',
        unpinTab: 'Unpin tab',
        splitRight: 'Split right',
        splitDown: 'Split down',
        maximizePane: 'Maximize pane',
        restorePane: 'Restore pane',
        closeTab: 'Close tab',
        closeOtherTabs: 'Close other tabs',
        closeTabsToRight: 'Close tabs to the right',
        moreTabs: ({ count }) => (count === 1 ? '1 more tab' : `${count} more tabs`),
        searchTabs: 'Search tabs',
        splitPane: 'Split the focused pane',
        openInNewTab: 'Open in new tab',
        openToRight: 'Open to the right',
        openBelow: 'Open below',
    },
};

/** The workspace bar: tab menus, overflow and split controls in the window's top strip. */
export const workspaceBarTranslations: Readonly<Record<'en' | 'ca' | 'de' | 'es' | 'fr' | 'it' | 'ja' | 'pl' | 'pt' | 'ru' | 'zh-Hans' | 'zh-Hant', WorkspaceBarTranslation>> = {
    en,
    ca: { workspaceBar: { tabsLabel: 'Pestanyes obertes', tabMenuLabel: 'Opcions de la pestanya', pinTab: 'Fixa la pestanya', unpinTab: 'Deixa de fixar la pestanya', splitRight: 'Divideix a la dreta', splitDown: 'Divideix cap avall', maximizePane: 'Maximitza el panell', restorePane: 'Restaura el panell', closeTab: 'Tanca la pestanya', closeOtherTabs: 'Tanca les altres pestanyes', closeTabsToRight: 'Tanca les pestanyes de la dreta', moreTabs: ({ count }) => (count === 1 ? '1 pestanya més' : `${count} pestanyes més`), searchTabs: 'Cerca pestanyes', splitPane: 'Divideix el panell actiu', openInNewTab: 'Obre en una pestanya nova', openToRight: 'Obre a la dreta', openBelow: 'Obre a sota' } },
    de: { workspaceBar: { tabsLabel: 'Offene Tabs', tabMenuLabel: 'Tab-Optionen', pinTab: 'Tab anheften', unpinTab: 'Tab lösen', splitRight: 'Rechts teilen', splitDown: 'Unten teilen', maximizePane: 'Bereich maximieren', restorePane: 'Bereich wiederherstellen', closeTab: 'Tab schließen', closeOtherTabs: 'Andere Tabs schließen', closeTabsToRight: 'Tabs rechts schließen', moreTabs: ({ count }) => (count === 1 ? '1 weiterer Tab' : `${count} weitere Tabs`), searchTabs: 'Tabs durchsuchen', splitPane: 'Aktiven Bereich teilen', openInNewTab: 'In neuem Tab öffnen', openToRight: 'Rechts öffnen', openBelow: 'Unten öffnen' } },
    es: { workspaceBar: { tabsLabel: 'Pestañas abiertas', tabMenuLabel: 'Opciones de pestaña', pinTab: 'Fijar pestaña', unpinTab: 'Desfijar pestaña', splitRight: 'Dividir a la derecha', splitDown: 'Dividir hacia abajo', maximizePane: 'Maximizar panel', restorePane: 'Restaurar panel', closeTab: 'Cerrar pestaña', closeOtherTabs: 'Cerrar las demás pestañas', closeTabsToRight: 'Cerrar pestañas a la derecha', moreTabs: ({ count }) => (count === 1 ? '1 pestaña más' : `${count} pestañas más`), searchTabs: 'Buscar pestañas', splitPane: 'Dividir el panel activo', openInNewTab: 'Abrir en una pestaña nueva', openToRight: 'Abrir a la derecha', openBelow: 'Abrir debajo' } },
    fr: { workspaceBar: { tabsLabel: 'Onglets ouverts', tabMenuLabel: 'Options de l’onglet', pinTab: 'Épingler l’onglet', unpinTab: 'Désépingler l’onglet', splitRight: 'Diviser à droite', splitDown: 'Diviser en bas', maximizePane: 'Agrandir le volet', restorePane: 'Restaurer le volet', closeTab: 'Fermer l’onglet', closeOtherTabs: 'Fermer les autres onglets', closeTabsToRight: 'Fermer les onglets à droite', moreTabs: ({ count }) => (count === 1 ? '1 onglet de plus' : `${count} onglets de plus`), searchTabs: 'Rechercher des onglets', splitPane: 'Diviser le volet actif', openInNewTab: 'Ouvrir dans un nouvel onglet', openToRight: 'Ouvrir à droite', openBelow: 'Ouvrir en dessous' } },
    it: { workspaceBar: { tabsLabel: 'Schede aperte', tabMenuLabel: 'Opzioni della scheda', pinTab: 'Fissa scheda', unpinTab: 'Sblocca scheda', splitRight: 'Dividi a destra', splitDown: 'Dividi in basso', maximizePane: 'Massimizza riquadro', restorePane: 'Ripristina riquadro', closeTab: 'Chiudi scheda', closeOtherTabs: 'Chiudi le altre schede', closeTabsToRight: 'Chiudi le schede a destra', moreTabs: ({ count }) => (count === 1 ? '1 altra scheda' : `Altre ${count} schede`), searchTabs: 'Cerca schede', splitPane: 'Dividi il riquadro attivo', openInNewTab: 'Apri in una nuova scheda', openToRight: 'Apri a destra', openBelow: 'Apri sotto' } },
    ja: { workspaceBar: { tabsLabel: '開いているタブ', tabMenuLabel: 'タブのオプション', pinTab: 'タブを固定', unpinTab: 'タブの固定を解除', splitRight: '右に分割', splitDown: '下に分割', maximizePane: 'ペインを最大化', restorePane: 'ペインを元に戻す', closeTab: 'タブを閉じる', closeOtherTabs: '他のタブを閉じる', closeTabsToRight: '右側のタブを閉じる', moreTabs: ({ count }) => `ほか ${count} 個のタブ`, searchTabs: 'タブを検索', splitPane: 'アクティブなペインを分割', openInNewTab: '新しいタブで開く', openToRight: '右に開く', openBelow: '下に開く' } },
    pl: { workspaceBar: { tabsLabel: 'Otwarte karty', tabMenuLabel: 'Opcje karty', pinTab: 'Przypnij kartę', unpinTab: 'Odepnij kartę', splitRight: 'Podziel w prawo', splitDown: 'Podziel w dół', maximizePane: 'Maksymalizuj panel', restorePane: 'Przywróć panel', closeTab: 'Zamknij kartę', closeOtherTabs: 'Zamknij pozostałe karty', closeTabsToRight: 'Zamknij karty po prawej', moreTabs: ({ count }) => (count === 1 ? 'Jeszcze 1 karta' : `Jeszcze ${count} kart`), searchTabs: 'Szukaj kart', splitPane: 'Podziel aktywny panel', openInNewTab: 'Otwórz w nowej karcie', openToRight: 'Otwórz po prawej', openBelow: 'Otwórz poniżej' } },
    pt: { workspaceBar: { tabsLabel: 'Abas abertas', tabMenuLabel: 'Opções da aba', pinTab: 'Fixar aba', unpinTab: 'Desafixar aba', splitRight: 'Dividir à direita', splitDown: 'Dividir abaixo', maximizePane: 'Maximizar painel', restorePane: 'Restaurar painel', closeTab: 'Fechar aba', closeOtherTabs: 'Fechar as outras abas', closeTabsToRight: 'Fechar abas à direita', moreTabs: ({ count }) => (count === 1 ? 'Mais 1 aba' : `Mais ${count} abas`), searchTabs: 'Pesquisar abas', splitPane: 'Dividir o painel ativo', openInNewTab: 'Abrir em nova aba', openToRight: 'Abrir à direita', openBelow: 'Abrir abaixo' } },
    ru: { workspaceBar: { tabsLabel: 'Открытые вкладки', tabMenuLabel: 'Параметры вкладки', pinTab: 'Закрепить вкладку', unpinTab: 'Открепить вкладку', splitRight: 'Разделить вправо', splitDown: 'Разделить вниз', maximizePane: 'Развернуть панель', restorePane: 'Восстановить панель', closeTab: 'Закрыть вкладку', closeOtherTabs: 'Закрыть другие вкладки', closeTabsToRight: 'Закрыть вкладки справа', moreTabs: ({ count }) => `Ещё вкладок: ${count}`, searchTabs: 'Поиск вкладок', splitPane: 'Разделить активную панель', openInNewTab: 'Открыть в новой вкладке', openToRight: 'Открыть справа', openBelow: 'Открыть снизу' } },
    'zh-Hans': { workspaceBar: { tabsLabel: '打开的标签页', tabMenuLabel: '标签页选项', pinTab: '固定标签页', unpinTab: '取消固定标签页', splitRight: '向右拆分', splitDown: '向下拆分', maximizePane: '最大化窗格', restorePane: '还原窗格', closeTab: '关闭标签页', closeOtherTabs: '关闭其他标签页', closeTabsToRight: '关闭右侧标签页', moreTabs: ({ count }) => `另外 ${count} 个标签页`, searchTabs: '搜索标签页', splitPane: '拆分当前窗格', openInNewTab: '在新标签页中打开', openToRight: '在右侧打开', openBelow: '在下方打开' } },
    'zh-Hant': { workspaceBar: { tabsLabel: '開啟的分頁', tabMenuLabel: '分頁選項', pinTab: '釘選分頁', unpinTab: '取消釘選分頁', splitRight: '向右分割', splitDown: '向下分割', maximizePane: '最大化窗格', restorePane: '還原窗格', closeTab: '關閉分頁', closeOtherTabs: '關閉其他分頁', closeTabsToRight: '關閉右側分頁', moreTabs: ({ count }) => `另外 ${count} 個分頁`, searchTabs: '搜尋分頁', splitPane: '分割目前的窗格', openInNewTab: '在新分頁中開啟', openToRight: '在右側開啟', openBelow: '在下方開啟' } },
};
