import type { TranslationKey } from '@/text';
import type { PluginUiDestinationPlacementV1 } from '@happier-dev/protocol/plugins/ui';
import type { PluginSurfaceDestinationBadge } from '@/components/plugins/surfaces/pluginSurfaceDestinations';
import type { PluginUiSurfacePlacementProjection } from '@/sync/domains/plugins/ui/projection';
import type { IconName } from '@/components/ui/icons/Icon';
import { SESSION_BOARD_DESTINATION } from '@/components/sessions/board/sessionBoardDestination';

export type RightSidebarScope = 'session' | 'project' | 'app';
export type RightSidebarPresentation = 'desktop' | 'mobile';

export type RightSidebarBuiltInTabId =
    | 'git'
    | 'files'
    | 'navigation'
    | 'agents'
    | 'collaboration'
    | 'board'
    | 'terminal'
    | 'browser'
    | 'services';

export type RightSidebarMobileSurface = 'agents' | 'collaboration' | 'browse' | 'git' | 'navigation' | 'board' | 'terminal' | 'browser' | 'services' | 'plugin';

export type RightSidebarTabOwner = 'builtin' | 'plugin';

/** What a tab works on, for the action rail's hairline groups: code · the session · the machine. */
export type RightSidebarRailGroup = 'code' | 'session' | 'machine';

export type RightSidebarTabBase = Readonly<{
    id: string;
    owner: RightSidebarTabOwner;
    icon: IconName;
    order: number;
    scopes: readonly RightSidebarScope[];
    mobileSurfaces?: Partial<Record<RightSidebarScope, RightSidebarMobileSurface>>;
    disabledReason?: string;
}>;

export type RightSidebarBuiltinTabDefinition = RightSidebarTabBase & Readonly<{
    id: RightSidebarBuiltInTabId;
    owner: 'builtin';
    labelKey: TranslationKey;
    railGroup: RightSidebarRailGroup;
    available?: (input: RightSidebarAvailabilityInput) => boolean;
}>;

export type RightSidebarPluginTabDefinition = RightSidebarTabBase & Readonly<{
    id: `plugin:${string}`;
    owner: 'plugin';
    label: string;
    /** Static presentation hints carried to host catalogs; they do not rank this sidebar. */
    badge?: PluginSurfaceDestinationBadge;
    requestedPlacement?: PluginUiDestinationPlacementV1;
    rankHint?: number;
    placement: PluginUiSurfacePlacementProjection;
    plugin: Readonly<{
        pluginId: string;
        descriptorId: string;
        generation: number | null;
    }>;
    retentionKey: string;
}>;

export type RightSidebarTabDefinition =
    | RightSidebarBuiltinTabDefinition
    | RightSidebarPluginTabDefinition;

export type RightSidebarTabDefinitionFor<TTabId extends string> =
    RightSidebarTabDefinition & Readonly<{ id: TTabId }>;

export type RightSidebarBuiltinTabDefinitionFor<TTabId extends RightSidebarBuiltInTabId> =
    RightSidebarBuiltinTabDefinition & Readonly<{ id: TTabId }>;

export type RightSidebarAvailabilityInput = Readonly<{
    scope: RightSidebarScope;
    terminalTabAvailable: boolean;
    presentation: RightSidebarPresentation;
    /**
     * The exact Home's `sessions.board` decision. Board availability is a feature
     * decision, not a content check: an empty Board still shows its tab, and a
     * missing or malformed decision fails closed.
     */
    boardFeatureEnabled: boolean;
    /** Normalized exact-Home Collaboration host admission; missing fails closed. */
    sessionSharingAvailable?: boolean;
    /**
     * False only for a no-folder session whose private folder is not a repository: Git appears
     * once the folder becomes one, and never offers to initialize it.
     */
    sourceControlTabAvailable: boolean;
}>;

export const RIGHT_SIDEBAR_BUILTIN_TABS: readonly RightSidebarBuiltinTabDefinition[] = [
    {
        id: 'git',
        owner: 'builtin',
        railGroup: 'code',
        labelKey: 'session.rightPanel.tabs.git',
        icon: 'git-branch',
        order: 10,
        scopes: ['session', 'project'],
        available: (input) => input.sourceControlTabAvailable,
        mobileSurfaces: {
            session: 'git',
            project: 'git',
        },
    },
    {
        id: 'files',
        owner: 'builtin',
        railGroup: 'code',
        labelKey: 'common.files',
        icon: 'folder',
        order: 20,
        scopes: ['session', 'project'],
        mobileSurfaces: {
            session: 'browse',
            project: 'browse',
        },
    },
    {
        id: 'agents',
        owner: 'builtin',
        railGroup: 'session',
        labelKey: 'sessionWork.title',
        icon: 'tree-structure',
        order: 30,
        scopes: ['session'],
        // The Work tab (ORC §3.8): one surface for desktop and phone, where everything this Session
        // leads is listed. The id stays `agents` so persisted pane state keeps its tab.
        mobileSurfaces: { session: 'agents' },
    },
    {
        id: 'collaboration',
        owner: 'builtin',
        railGroup: 'session',
        labelKey: 'session.collaboration.title',
        icon: 'users',
        order: 32,
        scopes: ['session'],
        mobileSurfaces: { session: 'collaboration' },
        available: (input) => input.sessionSharingAvailable === true,
    },
    {
        id: 'navigation',
        owner: 'builtin',
        railGroup: 'session',
        labelKey: 'session.transcriptNavigation.title',
        icon: 'list',
        order: 35,
        scopes: ['session'],
        // Session-only: the timeline is derived from one session's transcript, so there is
        // nothing for it to show in the project scope.
        mobileSurfaces: {
            session: 'navigation',
        },
    },
    {
        // The compact Board monitor/navigator. It sits after `navigation` (35) and
        // keeps the incumbent default selection: inserting a tab must not move the
        // pane someone already had open.
        id: SESSION_BOARD_DESTINATION.id,
        owner: 'builtin',
        railGroup: 'session',
        labelKey: SESSION_BOARD_DESTINATION.labelKey,
        icon: SESSION_BOARD_DESTINATION.icon,
        order: 37,
        scopes: ['session'],
        mobileSurfaces: {
            session: 'board',
        },
        available: (input) => input.boardFeatureEnabled,
    },
    {
        id: 'terminal',
        owner: 'builtin',
        railGroup: 'machine',
        labelKey: 'settings.terminal',
        icon: 'terminal',
        order: 40,
        scopes: ['session'],
        mobileSurfaces: {
            session: 'terminal',
        },
        available: (input) => input.terminalTabAvailable,
    },
    {
        id: 'browser',
        owner: 'builtin',
        railGroup: 'machine',
        labelKey: 'browserSurface.title',
        icon: 'globe',
        order: 50,
        scopes: ['session', 'project'],
        mobileSurfaces: {
            session: 'browser',
            project: 'browser',
        },
        // D1: the Browser surface is mobile-only. On desktop, Services is the single
        // services/launch surface; the redundant desktop Browser sidebar tab is removed while the
        // mobile full-screen browser surface (mobileSurfaces above) is kept.
        available: (input) => input.presentation === 'mobile',
    },
    {
        id: 'services',
        owner: 'builtin',
        railGroup: 'machine',
        labelKey: 'localServices.inventory.title',
        icon: 'hard-drives',
        order: 60,
        scopes: ['session', 'project'],
        mobileSurfaces: {
            session: 'services',
            project: 'services',
        },
    },
];
