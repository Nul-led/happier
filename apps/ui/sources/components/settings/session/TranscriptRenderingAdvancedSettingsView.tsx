import * as React from 'react';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { Switch } from '@/components/ui/forms/Switch';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { t } from '@/text';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { normalizeTranscriptMotionPreset } from '@/components/sessions/transcript/motion/TranscriptMotionContext';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { SettingAnchor, SettingRow } from '@/components/settings/shell/SettingRow';
import type { SettingRef } from '@/components/settings/catalog/settingDeclarations';
import { TRANSCRIPT_ADVANCED_SETTINGS } from '@/components/settings/session/transcriptAdvancedSettings';

/** Each number's accepted range; a typed value outside it is saved as the nearest bound. */
const BOUNDS = {
    COALESCE_WINDOW_MS: { min: 0, max: 200 },
    COALESCE_MAX_BATCH: { min: 1, max: 2000 },
    THINKING_STALE_MS: { min: 5000, max: 600_000 },
    MOTION_FRESHNESS_MS: { min: 0, max: 600_000 },
    PIN_OFFSET_PX: { min: 0, max: 400 },
    JUMP_MIN_NEW_COUNT: { min: 1, max: 999 },
} as const;

function clampInt(value: number, bounds: Readonly<{ min: number; max: number }>): number {
    if (!Number.isFinite(value)) return bounds.min;
    return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

function formatInteger(value: unknown): string {
    return typeof value === 'number' && Number.isFinite(value) ? String(Math.trunc(value)) : '';
}

/**
 * A declared whole-number setting on this page: the shared inline field (`FieldValueItem`), with the
 * typed number moved to the setting's bounds before it is saved.
 */
function BoundedIntegerSettingRow(props: Readonly<{
    setting: SettingRef;
    value: unknown;
    bounds: Readonly<{ min: number; max: number }>;
    onCommit: (next: number) => void;
    disabled?: boolean;
    testID?: string;
    showDivider?: boolean;
}>) {
    const saved = formatInteger(props.value);
    const { bounds, onCommit } = props;
    const commit = React.useCallback((draft: string) => {
        const next = clampInt(Number(draft), bounds);
        if (String(next) !== saved) onCommit(next);
        return String(next);
    }, [bounds, onCommit, saved]);
    return (
        <SettingAnchor setting={props.setting} showDivider={props.showDivider}>
            <FieldValueItem
                title={t(props.setting.titleKey)}
                subtitle={props.setting.descriptionKey ? t(props.setting.descriptionKey) : undefined}
                kind="integer"
                disabled={props.disabled}
                fieldTestID={props.testID}
                value={saved}
                onCommit={commit}
            />
        </SettingAnchor>
    );
}

export const TranscriptRenderingAdvancedSettingsView = React.memo(function TranscriptRenderingAdvancedSettingsView() {
    const settings = TRANSCRIPT_ADVANCED_SETTINGS.settings;

    const [transcriptStreamingCoalesceEnabled, setTranscriptStreamingCoalesceEnabled] = useSettingMutable('transcriptStreamingCoalesceEnabled');
    const [transcriptStreamingCoalesceWindowMs, setTranscriptStreamingCoalesceWindowMs] = useSettingMutable('transcriptStreamingCoalesceWindowMs');
    const [transcriptStreamingCoalesceMaxBatchSize, setTranscriptStreamingCoalesceMaxBatchSize] = useSettingMutable('transcriptStreamingCoalesceMaxBatchSize');
    const [transcriptStreamingPartialOutputEnabled, setTranscriptStreamingPartialOutputEnabled] = useSettingMutable('transcriptStreamingPartialOutputEnabled');
    const [transcriptThinkingPulseStaleMs, setTranscriptThinkingPulseStaleMs] = useSettingMutable('transcriptThinkingPulseStaleMs');

    const [transcriptMotionPreset] = useSettingMutable('transcriptMotionPreset');
    const normalizedMotionPreset = normalizeTranscriptMotionPreset(transcriptMotionPreset);

    const [transcriptMotionFreshnessMs, setTranscriptMotionFreshnessMs] = useSettingMutable('transcriptMotionFreshnessMs');
    const [transcriptAnimateNewItemsEnabled, setTranscriptAnimateNewItemsEnabled] = useSettingMutable('transcriptAnimateNewItemsEnabled');
    const [transcriptAnimateToolExpandCollapseEnabled, setTranscriptAnimateToolExpandCollapseEnabled] = useSettingMutable('transcriptAnimateToolExpandCollapseEnabled');
    const [transcriptAnimateToolExpandCollapseFreshOnly, setTranscriptAnimateToolExpandCollapseFreshOnly] = useSettingMutable('transcriptAnimateToolExpandCollapseFreshOnly');
    const [transcriptAnimateThinkingEnabled, setTranscriptAnimateThinkingEnabled] = useSettingMutable('transcriptAnimateThinkingEnabled');

    const [transcriptScrollPinOffsetThresholdPx, setTranscriptScrollPinOffsetThresholdPx] = useSettingMutable('transcriptScrollPinOffsetThresholdPx');
    const [transcriptScrollAutoFollowWhenPinned, setTranscriptScrollAutoFollowWhenPinned] = useSettingMutable('transcriptScrollAutoFollowWhenPinned');
    const [transcriptScrollJumpToBottomMinNewCount, setTranscriptScrollJumpToBottomMinNewCount] = useSettingMutable('transcriptScrollJumpToBottomMinNewCount');
    const [transcriptScrollJumpToBottomAnimateScroll, setTranscriptScrollJumpToBottomAnimateScroll] = useSettingMutable('transcriptScrollJumpToBottomAnimateScroll');

    // Motion timing only matters while transcript animations are on.
    const canAdjustMotion = normalizedMotionPreset !== 'off';

    return (
        <ItemList style={{ paddingTop: 0 }}>
            <SettingsPageHeader description={t('settingsSessionPages.transcript.advancedPageDescription')} />
            <ItemGroup
                title={t('settingsSession.transcript.advanced.performanceTitle')}
                description={t('settingsSession.transcript.advanced.performanceFooter')}
            >
                <SettingRow
                    setting={settings.coalesceEnabled}
                    rightElement={
                        <Switch
                            value={transcriptStreamingCoalesceEnabled === true}
                            onValueChange={(v) => setTranscriptStreamingCoalesceEnabled(Boolean(v) as any)}
                        />
                    }
                    showChevron={false}
                    onPress={() => setTranscriptStreamingCoalesceEnabled((transcriptStreamingCoalesceEnabled !== true) as any)}
                />
                <BoundedIntegerSettingRow
                    setting={settings.coalesceWindow}
                    testID="settings-transcript-advanced-coalesce-window"
                    value={transcriptStreamingCoalesceWindowMs}
                    bounds={BOUNDS.COALESCE_WINDOW_MS}
                    onCommit={(next) => setTranscriptStreamingCoalesceWindowMs(next as any)}
                />
                <BoundedIntegerSettingRow
                    setting={settings.coalesceMaxBatch}
                    testID="settings-transcript-advanced-coalesce-max-batch"
                    value={transcriptStreamingCoalesceMaxBatchSize}
                    bounds={BOUNDS.COALESCE_MAX_BATCH}
                    onCommit={(next) => setTranscriptStreamingCoalesceMaxBatchSize(next as any)}
                />
                <SettingRow
                    setting={settings.streamingPartialOutput}
                    rightElement={
                        <Switch
                            value={transcriptStreamingPartialOutputEnabled !== false}
                            onValueChange={(v) => setTranscriptStreamingPartialOutputEnabled(Boolean(v) as any)}
                        />
                    }
                    showChevron={false}
                    onPress={() => setTranscriptStreamingPartialOutputEnabled((transcriptStreamingPartialOutputEnabled === false) as any)}
                />
                <BoundedIntegerSettingRow
                    setting={settings.thinkingPulseStale}
                    testID="settings-transcript-advanced-thinking-stale"
                    value={transcriptThinkingPulseStaleMs}
                    bounds={BOUNDS.THINKING_STALE_MS}
                    onCommit={(next) => setTranscriptThinkingPulseStaleMs(next as any)}
                />
            </ItemGroup>

            <ItemGroup
                title={t('settingsSession.transcript.motionTitle')}
                description={canAdjustMotion
                    ? t('settingsSession.transcript.advanced.motionFooter')
                    : t('settingsSessionPages.transcript.advancedMotionOff')}
            >
                <BoundedIntegerSettingRow
                    setting={settings.freshness}
                    testID="settings-transcript-advanced-freshness"
                    value={transcriptMotionFreshnessMs}
                    bounds={BOUNDS.MOTION_FRESHNESS_MS}
                    disabled={!canAdjustMotion}
                    onCommit={(next) => setTranscriptMotionFreshnessMs(next as any)}
                />
                <SettingRow
                    setting={settings.animateNewItems}
                    disabled={!canAdjustMotion}
                    rightElement={
                        <Switch
                            value={transcriptAnimateNewItemsEnabled === true}
                            onValueChange={(v) => setTranscriptAnimateNewItemsEnabled(Boolean(v) as any)}
                            disabled={!canAdjustMotion}
                        />
                    }
                    showChevron={false}
                    onPress={() => {
                        if (!canAdjustMotion) return;
                        setTranscriptAnimateNewItemsEnabled((transcriptAnimateNewItemsEnabled !== true) as any);
                    }}
                />
                <SettingRow
                    setting={settings.animateToolExpandCollapse}
                    disabled={!canAdjustMotion}
                    rightElement={
                        <Switch
                            value={transcriptAnimateToolExpandCollapseEnabled === true}
                            onValueChange={(v) => setTranscriptAnimateToolExpandCollapseEnabled(Boolean(v) as any)}
                            disabled={!canAdjustMotion}
                        />
                    }
                    showChevron={false}
                    onPress={() => {
                        if (!canAdjustMotion) return;
                        setTranscriptAnimateToolExpandCollapseEnabled((transcriptAnimateToolExpandCollapseEnabled !== true) as any);
                    }}
                />
                <SettingRow
                    setting={settings.animateToolExpandCollapseFreshOnly}
                    disabled={!canAdjustMotion || transcriptAnimateToolExpandCollapseEnabled !== true}
                    rightElement={
                        <Switch
                            value={transcriptAnimateToolExpandCollapseFreshOnly === true}
                            onValueChange={(v) => setTranscriptAnimateToolExpandCollapseFreshOnly(Boolean(v) as any)}
                            disabled={!canAdjustMotion || transcriptAnimateToolExpandCollapseEnabled !== true}
                        />
                    }
                    showChevron={false}
                    onPress={() => {
                        if (!canAdjustMotion) return;
                        if (transcriptAnimateToolExpandCollapseEnabled !== true) return;
                        setTranscriptAnimateToolExpandCollapseFreshOnly((transcriptAnimateToolExpandCollapseFreshOnly !== true) as any);
                    }}
                />
                <SettingRow
                    setting={settings.animateThinking}
                    disabled={!canAdjustMotion}
                    rightElement={
                        <Switch
                            value={transcriptAnimateThinkingEnabled === true}
                            onValueChange={(v) => setTranscriptAnimateThinkingEnabled(Boolean(v) as any)}
                            disabled={!canAdjustMotion}
                        />
                    }
                    showChevron={false}
                    onPress={() => {
                        if (!canAdjustMotion) return;
                        setTranscriptAnimateThinkingEnabled((transcriptAnimateThinkingEnabled !== true) as any);
                    }}
                />
            </ItemGroup>

            <ItemGroup
                title={t('settingsSession.transcript.scrollTitle')}
                description={t('settingsSession.transcript.advanced.scrollFooter')}
            >
                <BoundedIntegerSettingRow
                    setting={settings.pinOffset}
                    testID="settings-transcript-advanced-pin-offset"
                    value={transcriptScrollPinOffsetThresholdPx}
                    bounds={BOUNDS.PIN_OFFSET_PX}
                    onCommit={(next) => setTranscriptScrollPinOffsetThresholdPx(next as any)}
                />
                <SettingRow
                    setting={settings.autoFollow}
                    rightElement={
                        <Switch
                            value={transcriptScrollAutoFollowWhenPinned === true}
                            onValueChange={(v) => setTranscriptScrollAutoFollowWhenPinned(Boolean(v) as any)}
                        />
                    }
                    showChevron={false}
                    onPress={() => setTranscriptScrollAutoFollowWhenPinned((transcriptScrollAutoFollowWhenPinned !== true) as any)}
                />
                <BoundedIntegerSettingRow
                    setting={settings.jumpMinNewCount}
                    testID="settings-transcript-advanced-jump-min-count"
                    value={transcriptScrollJumpToBottomMinNewCount}
                    bounds={BOUNDS.JUMP_MIN_NEW_COUNT}
                    onCommit={(next) => setTranscriptScrollJumpToBottomMinNewCount(next as any)}
                />
                <SettingRow
                    setting={settings.jumpAnimateScroll}
                    rightElement={
                        <Switch
                            value={transcriptScrollJumpToBottomAnimateScroll === true}
                            onValueChange={(v) => setTranscriptScrollJumpToBottomAnimateScroll(Boolean(v) as any)}
                        />
                    }
                    showChevron={false}
                    onPress={() => setTranscriptScrollJumpToBottomAnimateScroll((transcriptScrollJumpToBottomAnimateScroll !== true) as any)}
                />
            </ItemGroup>
        </ItemList>
    );
});

export default TranscriptRenderingAdvancedSettingsView;
