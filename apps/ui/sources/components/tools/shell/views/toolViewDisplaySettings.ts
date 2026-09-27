import type { Settings } from '@/sync/domains/settings/settings';
import { useSetting } from '@/sync/domains/state/storage';

/**
 * The account settings that decide how a tool call looks in the transcript (card and feed row). The
 * transcript reads them from the store; a surface that shows tool calls outside a session (the
 * settings pages' previews) passes them as props instead, so it never follows live settings.
 */
export type ToolViewDisplaySettings = Readonly<Pick<Settings,
    | 'toolViewDetailLevelDefault'
    | 'toolViewDetailLevelDefaultLocalControl'
    | 'toolViewDetailLevelByToolName'
    | 'toolViewExpandedDetailLevelDefault'
    | 'toolViewExpandedDetailLevelByToolName'
    | 'toolViewTimelineFeedDefaultExpanded'
    | 'toolViewTapAction'
    | 'permissionPromptSurface'
>>;

/** What a tool card reads; the feed row also reads `toolViewTimelineFeedDefaultExpanded`. */
export type ToolCardDisplaySettings = Omit<ToolViewDisplaySettings, 'toolViewTimelineFeedDefaultExpanded'>;

export function useToolCardDisplaySettings(): ToolCardDisplaySettings {
    return {
        toolViewDetailLevelDefault: useSetting('toolViewDetailLevelDefault'),
        toolViewDetailLevelDefaultLocalControl: useSetting('toolViewDetailLevelDefaultLocalControl'),
        toolViewDetailLevelByToolName: useSetting('toolViewDetailLevelByToolName'),
        toolViewExpandedDetailLevelDefault: useSetting('toolViewExpandedDetailLevelDefault'),
        toolViewExpandedDetailLevelByToolName: useSetting('toolViewExpandedDetailLevelByToolName'),
        toolViewTapAction: useSetting('toolViewTapAction'),
        permissionPromptSurface: useSetting('permissionPromptSurface'),
    };
}

export function useToolFeedRowDisplaySettings(): ToolViewDisplaySettings {
    return {
        ...useToolCardDisplaySettings(),
        toolViewTimelineFeedDefaultExpanded: useSetting('toolViewTimelineFeedDefaultExpanded'),
    };
}
