import * as React from 'react';

import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { SESSION_SETTINGS } from './sessionSettings';

type Source = 'recent' | 'list';

/**
 * The phone session bar's gestures, one row each (Settings › Session › Mobile session layout).
 * Every row is an ordinary account setting declared in `sessionSettings.ts`, so search reveals it
 * and agents change it through the declaration-backed settings Actions.
 */
export function SessionGestureSettingsRows(): React.ReactElement {
    const [sideways, setSideways] = useSettingMutable('sessionCockpitSwipeNavigationEnabled');
    const [always, setAlways] = useSettingMutable('sessionCockpitSwipeAlwaysSessionsEnabled');
    const [dragUp, setDragUp] = useSettingMutable('sessionSwitcherDragUpEnabled');
    const [dragUpSource, setDragUpSource] = useSettingMutable('sessionSwitcherDragUpSource');
    const [swipeSource, setSwipeSource] = useSettingMutable('sessionCockpitSwipeSource');
    const [flick, setFlick] = useSettingMutable('sessionSwitcherFlickEnabled');
    const [hold, setHold] = useSettingMutable('sessionSwitcherHoldToDockEnabled');
    const [pull, setPull] = useSettingMutable('sessionHeaderPullAllTabsEnabled');
    const settings = SESSION_SETTINGS.settings;
    const sidewaysOn = sideways !== false;
    const alwaysOn = always === true;

    const switchRow = (
        setting: (typeof settings)[keyof typeof settings],
        id: string,
        value: boolean,
        onChange: (next: boolean) => void,
        subtitle: string,
        disabled = false,
    ) => (
        <SettingAnchor setting={setting}>
            <Item
                title={t(setting.titleKey)}
                subtitle={subtitle}
                subtitleLines={0}
                disabled={disabled}
                showChevron={false}
                rightElement={<Switch testID={`settings-session-${id}-switch`} value={value} disabled={disabled} onValueChange={onChange} />}
                onPress={disabled ? undefined : () => onChange(!value)}
                testID={`settings-session-${id}-trigger`}
            />
        </SettingAnchor>
    );

    const sourceOptions = (first: Source) => {
        const recent = { id: 'recent' as const, label: t('phoneNav.settings.sourceRecent') };
        const list = { id: 'list' as const, label: t('phoneNav.settings.sourceList') };
        return first === 'recent' ? [recent, list] : [list, recent];
    };

    return (
        <>
            {switchRow(settings.swipeSideways, 'swipeSideways', sidewaysOn, setSideways,
                t(alwaysOn ? 'phoneNav.settings.swipeSidewaysAlwaysDescription' : 'phoneNav.settings.swipeSidewaysScrollsDescription'))}
            {switchRow(settings.alwaysSwipe, 'alwaysSwipe', alwaysOn, setAlways,
                t(alwaysOn ? 'phoneNav.settings.alwaysSwipeOnDescription' : 'phoneNav.settings.alwaysSwipeOffDescription'),
                !sidewaysOn)}
            {switchRow(settings.dragUp, 'dragUp', dragUp !== false, setDragUp, t('phoneNav.settings.dragUpDescription'))}
            <SettingAnchor setting={settings.dragUpSource}>
                <SegmentedChoiceItem<Source>
                    title={t(settings.dragUpSource.titleKey)}
                    subtitle={t(dragUpSource === 'list'
                        ? 'phoneNav.settings.dragUpSourceListDescription'
                        : 'phoneNav.settings.dragUpSourceRecentDescription')}
                    subtitleLines={0}
                    testIDPrefix="settings-session-dragUpSource"
                    options={sourceOptions('recent')}
                    value={dragUpSource === 'list' ? 'list' : 'recent'}
                    disabled={dragUp === false && flick === false}
                    onChange={setDragUpSource}
                />
            </SettingAnchor>
            <SettingAnchor setting={settings.swipeSource}>
                <SegmentedChoiceItem<Source>
                    title={t(settings.swipeSource.titleKey)}
                    subtitle={t(swipeSource === 'recent'
                        ? 'phoneNav.settings.swipeSourceRecentDescription'
                        : 'phoneNav.settings.swipeSourceListDescription')}
                    subtitleLines={0}
                    testIDPrefix="settings-session-swipeSource"
                    options={sourceOptions('list')}
                    value={swipeSource === 'recent' ? 'recent' : 'list'}
                    disabled={!sidewaysOn}
                    onChange={setSwipeSource}
                />
            </SettingAnchor>
            {switchRow(settings.flick, 'flick', flick !== false, setFlick, t('phoneNav.settings.flickDescription'))}
            {switchRow(settings.holdToDock, 'holdToDock', hold !== false, setHold, t('phoneNav.settings.holdToDockDescription'))}
            {switchRow(settings.pullAllTabs, 'pullAllTabs', pull !== false, setPull, t('phoneNav.settings.pullAllTabsDescription'))}
        </>
    );
}
