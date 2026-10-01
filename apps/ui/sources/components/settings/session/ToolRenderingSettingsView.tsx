import * as React from 'react';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { t } from '@/text';
import { useSettingMutable } from '@/sync/domains/state/storage';
import {
    TOOL_DETAIL_LEVEL_WITH_DEFAULT_OPTIONS,
    type ToolViewDetailLevel,
} from '@/components/settings/session/toolRendering/toolRenderingSettingOptions';
import { TOOL_RENDERING_OVERRIDE_ENTRIES } from '@/components/settings/session/toolRendering/toolRenderingOverrideEntries';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { TOOL_RENDERING_SETTINGS } from '@/components/settings/session/toolRenderingSettings';

type ExpandedOverride = 'default' | 'summary' | 'full';

export const ToolRenderingSettingsView = React.memo(function ToolRenderingSettingsView() {
    const popoverBoundaryRef = React.useRef<any>(null);

    const [toolViewDetailLevelByToolName, setToolViewDetailLevelByToolName] = useSettingMutable('toolViewDetailLevelByToolName');
    const [toolViewExpandedDetailLevelByToolName, setToolViewExpandedDetailLevelByToolName] = useSettingMutable('toolViewExpandedDetailLevelByToolName');

    const [openToolDetailMenu, setOpenToolDetailMenu] = React.useState<null | string>(null);
    const tToolDetail = t as (key: any) => string;
    // One row per tool: the section says what the choice means, so the rows carry only the value.
    const expandedOptions = React.useMemo(() => [
        { id: 'default' as const, label: t('settingsSession.toolDetailLevel.defaultTitle') },
        { id: 'summary' as const, label: t('settingsSession.toolDetailLevel.summaryTitle') },
        { id: 'full' as const, label: t('settingsSession.toolDetailLevel.fullTitle') },
    ], []);

    return (
        <ItemList ref={popoverBoundaryRef} style={{ paddingTop: 0 }} presentation="page">
            <SettingsPageHeader description={t('settingsSessionPages.toolRendering.pageDescription')} />
            <SettingAnchor setting={TOOL_RENDERING_SETTINGS.settings.collapsedOverrides}>
                <ItemGroup
                    title={t('settingsSession.toolDetailOverrides.title')}
                    description={t('settingsSessionPages.toolRendering.collapsedDescription')}
                >
                    {TOOL_RENDERING_OVERRIDE_ENTRIES.map((toolKey) => {
                        const override = (toolViewDetailLevelByToolName as any)?.[toolKey.toolName] as ToolViewDetailLevel | undefined;
                        const selected = override ?? 'default';

                        return (
                            <DropdownMenu
                                key={toolKey.toolName}
                                open={openToolDetailMenu === `toolOverride:${toolKey.toolName}`}
                                onOpenChange={(next) => setOpenToolDetailMenu(next ? `toolOverride:${toolKey.toolName}` : null)}
                                variant="selectable"
                                search={false}
                                selectedId={selected as any}
                                showCategoryTitles={false}
                                matchTriggerWidth={true}
                                connectToTrigger={true}
                                rowKind="item"
                                popoverBoundaryRef={popoverBoundaryRef}
                                itemTrigger={{
                                    title: toolKey.title,
                                    showSelectedSubtitle: false,
                                    itemProps: { testID: `settings-tool-rendering-collapsed-${toolKey.toolName}` },
                                }}
                                items={TOOL_DETAIL_LEVEL_WITH_DEFAULT_OPTIONS.map((opt) => ({
                                    id: opt.key,
                                    title: tToolDetail(opt.titleKey),
                                    subtitle: tToolDetail(opt.subtitleKey),
                                }))}
                                onSelect={(id) => {
                                    const next = id as ToolViewDetailLevel | 'default';
                                    const current = (toolViewDetailLevelByToolName ?? {}) as Record<string, ToolViewDetailLevel>;
                                    const nextRecord: Record<string, ToolViewDetailLevel> = { ...current };
                                    if (next === 'default') {
                                        delete nextRecord[toolKey.toolName];
                                    } else {
                                        nextRecord[toolKey.toolName] = next;
                                    }
                                    setToolViewDetailLevelByToolName(nextRecord as any);
                                    setOpenToolDetailMenu(null);
                                }}
                            />
                        );
                    })}
                </ItemGroup>
            </SettingAnchor>

            <SettingAnchor setting={TOOL_RENDERING_SETTINGS.settings.expandedOverrides}>
                <ItemGroup
                    title={t('settingsSession.toolDetailOverrides.expandedTitle')}
                    description={t('settingsSession.toolDetailOverrides.expandedFooter')}
                >
                    {TOOL_RENDERING_OVERRIDE_ENTRIES.map((toolKey) => {
                        const override = (toolViewExpandedDetailLevelByToolName as any)?.[toolKey.toolName] as 'summary' | 'full' | undefined;
                        return (
                            <SegmentedChoiceItem<ExpandedOverride>
                                key={toolKey.toolName}
                                testID={`settings-tool-rendering-expanded-${toolKey.toolName}`}
                                testIDPrefix={`settings-tool-rendering-expanded-${toolKey.toolName}`}
                                title={toolKey.title}
                                options={expandedOptions}
                                value={override ?? 'default'}
                                onChange={(next) => {
                                    const current = (toolViewExpandedDetailLevelByToolName ?? {}) as Record<string, 'summary' | 'full'>;
                                    const nextRecord: Record<string, 'summary' | 'full'> = { ...current };
                                    if (next === 'default') {
                                        delete nextRecord[toolKey.toolName];
                                    } else {
                                        nextRecord[toolKey.toolName] = next;
                                    }
                                    setToolViewExpandedDetailLevelByToolName(nextRecord as any);
                                }}
                            />
                        );
                    })}
                </ItemGroup>
            </SettingAnchor>
        </ItemList>
    );
});

export default ToolRenderingSettingsView;
