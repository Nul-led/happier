import * as React from 'react';

import { AutomationsLatestRunsSection } from '@/components/automations/home/AutomationsLatestRunsSection';
import type { IconName } from '@/components/ui/icons/Icon';
import type { WidgetFrameStyle } from '@/components/widgets/frame/WidgetFrame';
import type { WidgetCandidate } from '@/components/widgets/widgetCatalog';
import { t } from '@/text';

import { HubAttentionSection } from './HubAttentionSection';
import { HubComposerSection } from './composer/HubComposerSection';
import { HubMachinesSection } from './HubMachinesSection';
import { HubSetupSection } from './HubSetupSection';
import { HubUsageSection } from './HubUsageSection';
import type { HomeHubBuiltinDefinition, HomeHubSection } from './layout/homeHubLayout';

/**
 * The app home's built-in sections, in their default order: the one table the home, its section
 * menu and Customize read. A new built-in section (Automations' or Workflows' latest runs) is one
 * row here. Plugin widgets are not rows: they join the same list from the installed widget
 * inventory.
 */
export type HomeHubBuiltinSection = HomeHubBuiltinDefinition & Readonly<{
    title: () => string;
    /** Customize names each section with a glyph and where it comes from. */
    icon: IconName;
    description: () => string;
    /** A card like a widget's: Home tiles consecutive cards two to a row. */
    card?: boolean;
    render: (input: Readonly<{ menu: React.ReactNode; placeholder: string; frameStyle: WidgetFrameStyle }>) => React.ReactNode;
}>;

export const HOME_HUB_BUILTIN_SECTIONS: readonly HomeHubBuiltinSection[] = Object.freeze([
    {
        id: 'start',
        hideable: false,
        icon: 'arrow-up',
        description: () => t('homeIndex.startDescription'),
        title: () => t('settingsOverview.homeStartSection'),
        // The real New Session composer; it keeps its own placeholder, as on `/new`.
        render: () => <HubComposerSection />,
    },
    {
        id: 'attention',
        hideable: false,
        icon: 'bell',
        description: () => t('homeIndex.attentionDescription'),
        title: () => t('settingsOverview.attentionTitle'),
        render: ({ menu }) => <HubAttentionSection menu={menu} />,
    },
    {
        id: 'setup',
        hideable: true,
        icon: 'check-circle',
        description: () => t('homeIndex.builtIn'),
        title: () => t('settingsOverview.setupTitle'),
        render: ({ menu }) => <HubSetupSection menu={menu} />,
    },
    {
        id: 'automations',
        hideable: true,
        afterWidgets: true,
        card: true,
        icon: 'timer',
        description: () => t('navigation.automations'),
        title: () => t('homeWidgets.latestRunsTitle'),
        render: ({ menu, frameStyle }) => <AutomationsLatestRunsSection menu={menu} frameStyle={frameStyle} />,
    },
    {
        id: 'machines',
        hideable: true,
        afterWidgets: true,
        icon: 'desktop',
        description: () => t('homeIndex.machinesDescription'),
        // Off until turned on in Customize; shown, it is a grid of the machines.
        defaultHidden: true,
        title: () => t('settingsOverview.machinesTitle'),
        render: ({ menu }) => <HubMachinesSection menu={menu} />,
    },
    {
        id: 'usage',
        hideable: true,
        afterWidgets: true,
        icon: 'speedometer',
        description: () => t('homeIndex.builtIn'),
        title: () => t('settingsOverview.usageTitle'),
        render: ({ menu }) => <HubUsageSection menu={menu} />,
    },
]);

const BUILTIN_BY_ID: ReadonlyMap<string, HomeHubBuiltinSection> = new Map(
    HOME_HUB_BUILTIN_SECTIONS.map((section) => [section.id, section]),
);

export function findHomeHubBuiltinSection(id: string): HomeHubBuiltinSection | null {
    return BUILTIN_BY_ID.get(id) ?? null;
}

/** Widgets and card-like built-ins (Latest runs) share Home's two-column card rows. */
export function isHomeHubCardSection(section: HomeHubSection<WidgetCandidate>): boolean {
    return section.kind === 'widget' || findHomeHubBuiltinSection(section.id)?.card === true;
}

/** What a section is called in its menu and in Customize. */
export function homeHubSectionTitle(section: HomeHubSection<WidgetCandidate>): string {
    return section.kind === 'widget'
        ? section.widget.title
        : findHomeHubBuiltinSection(section.id)?.title() ?? section.id;
}
