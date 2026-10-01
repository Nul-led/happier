import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';
import { DocumentTabStrip, type DocumentTabPresentation, type DocumentTabStripTestIds } from '@/components/ui/navigation/DocumentTabStrip';
import { FileIcon } from '@/components/ui/media/FileIcon';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import type { AppPaneScopeApi } from '@/components/appShell/panes/hooks/useAppPaneScope';
import { DETAILS_TAB_STRIP_METRICS as M } from '@/components/appShell/panes/details/header/detailsTabHeaderMetrics';
import { t } from '@/text';
import { toTestIdSafeValue } from '@/utils/ui/toTestIdSafeValue';
import type { DetailsTabState, DetailsWorkspaceGroupView } from './detailsWorkspaceTypes';

export type DetailsTabStripTestIds = DocumentTabStripTestIds;
export type DetailsTabPresentation = DocumentTabPresentation;
export type DetailsTabStripProps = Readonly<{
    pane: Pick<AppPaneScopeApi, 'setActiveDetailsTab' | 'pinDetailsTab' | 'unpinDetailsTab' | 'closeDetailsTab'>;
    group: DetailsWorkspaceGroupView;
    resolveTabIconName?: ((tab: DetailsTabState) => string | null | undefined) | null;
    resolveTabPresentation?: ((tab: DetailsTabState) => DetailsTabPresentation | null | undefined) | null;
    unsavedTabKeys?: ReadonlySet<string>;
    testIds?: DetailsTabStripTestIds;
}>;

export function detailsTabNativeId(groupId: string, tabKey: string): string {
    return `details-${toTestIdSafeValue(groupId)}-tab-${toTestIdSafeValue(tabKey)}`;
}

export function detailsTabPanelNativeId(groupId: string, tabKey: string): string {
    return `details-${toTestIdSafeValue(groupId)}-panel-${toTestIdSafeValue(tabKey)}`;
}

/** Details owns resource semantics; DocumentTabStrip owns the shared document chrome. */
export const DetailsTabStrip = React.memo((props: DetailsTabStripProps) => {
    const { theme } = useUnistyles();
    return <DocumentTabStrip
        tabs={props.group.tabs}
        activeTabKey={props.group.activeTabKey}
        accessibilityLabel={t('common.details')}
        onActivate={props.pane.setActiveDetailsTab}
        onPin={props.pane.pinDetailsTab}
        onUnpin={props.pane.unpinDetailsTab}
        onClose={props.pane.closeDetailsTab}
        resolveTabPresentation={props.resolveTabPresentation}
        unsavedTabKeys={props.unsavedTabKeys}
        testIds={props.testIds}
        tabNativeId={(key) => detailsTabNativeId(props.group.id, key)}
        panelNativeId={(key) => detailsTabPanelNativeId(props.group.id, key)}
        renderLeadingIcon={(tab, active) => {
            if (tab.kind === 'file') return <FileIcon fileName={tab.title} size={M.tabGlyphPx}
                testID={`session-details-tab-file-icon-${toTestIdSafeValue(tab.key)}`} />;
            const iconName = props.resolveTabIconName?.(tab) ?? ({
                commit: 'git-commit', scmReview: 'diff', scmStash: 'archive',
                scmPullRequest: 'git-pull-request', terminal: 'terminal', executionRunLauncher: 'play',
            }[tab.kind] ?? 'circle');
            return <Icon name={iconName as IconName} size={M.tabGlyphPx}
                color={active ? theme.colors.text.primary : theme.colors.text.secondary} />;
        }}
    />;
});
