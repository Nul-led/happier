import * as React from 'react';
import { useWindowDimensions } from 'react-native';
import { t } from '@/text';
import { layout } from '@/components/ui/layout/layout';
import { resolveFloatingTabBarSlotCount } from '@/components/ui/navigation/FloatingTabBarSurface';
import { resolveTabBarMetrics } from '@/components/ui/navigation/tabBarMetrics';
import { useSetting } from '@/sync/domains/state/storage';
import type { ProjectMobileSurface } from '@/components/workspaceCockpit/project/projectCockpitState';
import { CockpitTabBar, type CockpitTabBarTabDefinition } from './CockpitTabBar';

type ProjectCockpitTabBarProps = Readonly<{
    workspaceRefId: string;
    activeSurface: ProjectMobileSurface;
    onSurfacePress: (surface: ProjectMobileSurface) => void;
}>;

type ProjectCockpitTabDefinition = Readonly<{
    id: ProjectMobileSurface;
    label: string;
    icon: CockpitTabBarTabDefinition<ProjectMobileSurface>['icon'];
}>;

export const ProjectCockpitTabBar = React.memo((props: ProjectCockpitTabBarProps) => {
    const tabs: readonly ProjectCockpitTabDefinition[] = [
        { id: 'overview', label: t('diagnosis.sections.overview'), icon: 'grid-four' },
        { id: 'browse', label: t('common.files'), icon: 'folder' },
        { id: 'git', label: t('session.rightPanel.tabs.git'), icon: 'git-branch' },
        { id: 'tabs', label: t('phoneNav.bar.openFiles'), icon: 'files' },
        { id: 'browser', label: t('browserSurface.title'), icon: 'globe' },
        { id: 'services', label: t('localServices.inventory.title'), icon: 'hard-drives' },
        { id: 'terminal', label: t('settings.terminal'), icon: 'terminal' },
    ];
    // One bar policy with the Session bar: tabs that do not fit the capsule scroll (Overview stays put).
    const windowWidth = useWindowDimensions().width;
    const tabMinWidth = resolveTabBarMetrics(useSetting('tabBarSize'), useSetting('tabBarShowLabels')).tabMinWidth;
    const slotCount = resolveFloatingTabBarSlotCount({ windowWidth, maxWidth: layout.maxWidth, tabMinWidth });

    return (
        <CockpitTabBar
            activeSurface={props.activeSurface}
            barTestId={`project-cockpit-tabbar-${props.workspaceRefId}`}
            tabs={tabs}
            tabTestIdPrefix="project-cockpit-tab-"
            layout={tabs.length > slotCount ? 'scroll' : 'fit'}
            onSurfacePress={props.onSurfacePress}
        />
    );
});
