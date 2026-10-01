import * as React from 'react';

import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { FieldTextInput } from '@/components/ui/forms/FieldTextInput';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { t } from '@/text';
import { useSettingMutable } from '@/sync/domains/state/storage';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { SettingAnchor, SettingRow } from '@/components/settings/shell/SettingRow';
import { SESSION_PROVIDER_LIMITS_SETTINGS } from '@/components/settings/session/sessionProviderLimitsSettings';

export const SessionProviderLimitsSettingsView = React.memo(function SessionProviderLimitsSettingsView() {
    const popoverBoundaryRef = React.useRef<any>(null);
    const usageLimitRecoveryEnabled = useFeatureEnabled('sessions.usageLimitRecovery');
    const connectedServiceQuotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const [usageLimitRecoverySettings, setUsageLimitRecoverySettings] = useSettingMutable('usageLimitRecoverySettingsV1');
    const [sessionProviderUsageGaugeMode, setSessionProviderUsageGaugeMode] = useSettingMutable('sessionProviderUsageGaugeMode');
    const [sessionProviderUsageGaugeWindowMode, setSessionProviderUsageGaugeWindowMode] = useSettingMutable('sessionProviderUsageGaugeWindowMode');
    const [openProviderUsageGaugeWindowMenu, setOpenProviderUsageGaugeWindowMenu] = React.useState(false);
    const usageLimitRecoveryMode = usageLimitRecoverySettings?.mode === 'auto_wait' ? 'auto_wait' : 'ask';
    const usageLimitRecoveryAutoWait = usageLimitRecoveryMode === 'auto_wait';
    const usageLimitRecoveryResumePromptMode =
        usageLimitRecoverySettings?.resumePromptMode === 'off' || usageLimitRecoverySettings?.resumePromptMode === 'custom'
            ? usageLimitRecoverySettings.resumePromptMode
            : 'standard';
    const usageLimitRecoveryCustomResumePrompt = usageLimitRecoverySettings?.customResumePrompt ?? '';
    const [customResumePromptDraft, setCustomResumePromptDraft] = React.useState(usageLimitRecoveryCustomResumePrompt);
    const customResumePromptDraftRef = React.useRef(customResumePromptDraft);
    const updateCustomResumePromptDraft = React.useCallback((text: string) => {
        customResumePromptDraftRef.current = text;
        setCustomResumePromptDraft(text);
    }, []);
    React.useEffect(() => {
        customResumePromptDraftRef.current = usageLimitRecoveryCustomResumePrompt;
        setCustomResumePromptDraft(usageLimitRecoveryCustomResumePrompt);
    }, [usageLimitRecoveryCustomResumePrompt]);
    const writeUsageLimitRecoverySettings = React.useCallback((next: Readonly<{
        mode: 'ask' | 'auto_wait';
        resumePromptMode: 'standard' | 'off' | 'custom';
        customResumePrompt: string;
    }>) => {
        const customResumePrompt = next.customResumePrompt.trim().slice(0, 2000);
        setUsageLimitRecoverySettings({
            v: 1,
            mode: next.mode,
            promptMode: 'standard',
            resumePromptMode: next.resumePromptMode,
            ...(customResumePrompt.length > 0 ? { customResumePrompt } : {}),
        });
    }, [setUsageLimitRecoverySettings]);
    const commitCustomResumePromptDraft = React.useCallback((draft: string) => {
        writeUsageLimitRecoverySettings({
            mode: usageLimitRecoveryMode,
            resumePromptMode: usageLimitRecoveryResumePromptMode,
            customResumePrompt: draft,
        });
    }, [writeUsageLimitRecoverySettings, usageLimitRecoveryMode, usageLimitRecoveryResumePromptMode]);
    const providerUsageGaugeVisible = sessionProviderUsageGaugeMode !== 'hidden';
    const providerUsageGaugeWindowMode =
        sessionProviderUsageGaugeWindowMode === 'daily'
        || sessionProviderUsageGaugeWindowMode === 'weekly'
        || sessionProviderUsageGaugeWindowMode === 'session'
        || sessionProviderUsageGaugeWindowMode === 'primary'
        || sessionProviderUsageGaugeWindowMode === 'secondary'
            ? sessionProviderUsageGaugeWindowMode
            : 'most_constrained';
    const providerUsageGaugeWindowOptions = [
        { id: 'most_constrained', title: t('settingsSession.providerUsageGauge.windowMostConstrainedTitle'), subtitle: t('settingsSession.providerUsageGauge.windowMostConstrainedSubtitle') },
        { id: 'daily', title: t('settingsSession.providerUsageGauge.windowDailyTitle'), subtitle: t('settingsSession.providerUsageGauge.windowDailySubtitle') },
        { id: 'weekly', title: t('settingsSession.providerUsageGauge.windowWeeklyTitle'), subtitle: t('settingsSession.providerUsageGauge.windowWeeklySubtitle') },
        { id: 'session', title: t('settingsSession.providerUsageGauge.windowSessionTitle'), subtitle: t('settingsSession.providerUsageGauge.windowSessionSubtitle') },
        { id: 'primary', title: t('settingsSession.providerUsageGauge.windowPrimaryTitle'), subtitle: t('settingsSession.providerUsageGauge.windowPrimarySubtitle') },
        { id: 'secondary', title: t('settingsSession.providerUsageGauge.windowSecondaryTitle'), subtitle: t('settingsSession.providerUsageGauge.windowSecondarySubtitle') },
    ] as const;

    return (
        <ItemList ref={popoverBoundaryRef} style={{ paddingTop: 0 }} presentation="page">
            <SettingsPageHeader description={t('settingsSessionPages.providerLimits.pageDescription')} />
            {usageLimitRecoveryEnabled ? (
                <ItemGroup
                    title={t('settingsSession.usageLimitRecovery.title')}
                    description={t('settingsSessionPages.providerLimits.recoveryDescription')}
                >
                    <SettingRow
                        setting={SESSION_PROVIDER_LIMITS_SETTINGS.settings.autoWait}
                        testID="settings-session-usage-limit-recovery"
                        subtitle={t(usageLimitRecoveryAutoWait
                            ? 'settingsSession.usageLimitRecovery.autoWaitEnabledSubtitle'
                            : 'settingsSession.usageLimitRecovery.autoWaitDisabledSubtitle')}
                        rightElement={<Switch value={usageLimitRecoveryAutoWait} onValueChange={(next) => writeUsageLimitRecoverySettings({ mode: next ? 'auto_wait' : 'ask', resumePromptMode: usageLimitRecoveryResumePromptMode, customResumePrompt: usageLimitRecoveryCustomResumePrompt })} />}
                        showChevron={false}
                        onPress={() => writeUsageLimitRecoverySettings({ mode: usageLimitRecoveryAutoWait ? 'ask' : 'auto_wait', resumePromptMode: usageLimitRecoveryResumePromptMode, customResumePrompt: usageLimitRecoveryCustomResumePrompt })}
                    />
                    <SettingAnchor setting={SESSION_PROVIDER_LIMITS_SETTINGS.settings.resumePrompt}>
                        <SegmentedChoiceItem<'standard' | 'custom' | 'off'>
                            subtitleLines={0}
                            testID="settings-session-usage-limit-recovery-resume-prompt"
                            testIDPrefix="settings-session-usage-limit-recovery-resume-prompt"
                            title={t(SESSION_PROVIDER_LIMITS_SETTINGS.settings.resumePrompt.titleKey)}
                            options={[
                                { id: 'standard', label: t('settingsSession.usageLimitRecovery.resumePromptStandardTitle'), description: t('settingsSession.usageLimitRecovery.resumePromptStandardSubtitle') },
                                { id: 'custom', label: t('settingsSessionPages.providerLimits.resumePromptCustom'), description: t('settingsSession.usageLimitRecovery.resumePromptCustomSubtitle') },
                                { id: 'off', label: t('settingsSession.usageLimitRecovery.resumePromptOffTitle'), description: t('settingsSession.usageLimitRecovery.resumePromptOffSubtitle') },
                            ]}
                            value={usageLimitRecoveryResumePromptMode}
                            onChange={(id) => writeUsageLimitRecoverySettings({ mode: usageLimitRecoveryMode, resumePromptMode: id, customResumePrompt: usageLimitRecoveryCustomResumePrompt })}
                        />
                    </SettingAnchor>
                    {usageLimitRecoveryResumePromptMode === 'custom' ? (
                        <Item
                            testID="settings-session-usageLimitRecovery-customResumePrompt"
                            title={t('settingsSession.usageLimitRecovery.customResumePromptTitle')}
                            accessoryLayout="stacked"
                            showChevron={false}
                            rightElement={(
                                <FieldTextInput
                                    testID="settings-session-usageLimitRecovery-customResumePrompt-input"
                                    accessibilityLabel={t('settingsSession.usageLimitRecovery.customResumePromptTitle')}
                                    value={customResumePromptDraft}
                                    onChangeText={updateCustomResumePromptDraft}
                                    onBlur={() => commitCustomResumePromptDraft(customResumePromptDraftRef.current)}
                                    onSubmitEditing={() => commitCustomResumePromptDraft(customResumePromptDraftRef.current)}
                                    placeholder={t('settingsSession.usageLimitRecovery.customResumePromptPlaceholder')}
                                    autoCapitalize="sentences"
                                    maxLength={2000}
                                    multiline
                                    minLines={2}
                                />
                            )}
                        />
                    ) : null}
                </ItemGroup>
            ) : null}
            {connectedServiceQuotasEnabled ? (
                <ItemGroup title={t('settingsSession.providerUsageGauge.title')} description={t('settingsSession.providerUsageGauge.footer')}>
                    <SettingRow
                        setting={SESSION_PROVIDER_LIMITS_SETTINGS.settings.gaugeVisible}
                        testID="settings-session-providerUsageGauge-visibility"
                        subtitle={providerUsageGaugeVisible ? t('settingsSession.providerUsageGauge.visibilityEnabledSubtitle') : t('settingsSession.providerUsageGauge.visibilityHiddenSubtitle')}
                        rightElement={<Switch testID="settings-session-providerUsageGauge-visibility-toggle" value={providerUsageGaugeVisible} onValueChange={(next) => setSessionProviderUsageGaugeMode(next ? 'auto' : 'hidden')} />}
                        showChevron={false}
                        onPress={() => setSessionProviderUsageGaugeMode(providerUsageGaugeVisible ? 'hidden' : 'auto')}
                    />
                    <SettingAnchor setting={SESSION_PROVIDER_LIMITS_SETTINGS.settings.gaugeWindow}>
                        <DropdownMenu
                            open={openProviderUsageGaugeWindowMenu}
                            onOpenChange={setOpenProviderUsageGaugeWindowMenu}
                            variant="selectable"
                            search={false}
                            selectedId={providerUsageGaugeWindowMode}
                            showCategoryTitles={false}
                            matchTriggerWidth={true}
                            connectToTrigger={true}
                            rowKind="item"
                            popoverBoundaryRef={popoverBoundaryRef}
                            itemTrigger={{
                                title: t(SESSION_PROVIDER_LIMITS_SETTINGS.settings.gaugeWindow.titleKey),
                                subtitle: providerUsageGaugeWindowOptions.find((option) => option.id === providerUsageGaugeWindowMode)?.subtitle,
                                showSelectedSubtitle: false,
                                itemProps: { testID: 'settings-session-providerUsageGauge-window-trigger' },
                            }}
                            items={providerUsageGaugeWindowOptions}
                            onSelect={(id) => {
                                if (!providerUsageGaugeWindowOptions.some((option) => option.id === id)) return;
                                setSessionProviderUsageGaugeWindowMode(id as typeof providerUsageGaugeWindowOptions[number]['id']);
                                setOpenProviderUsageGaugeWindowMenu(false);
                            }}
                        />
                    </SettingAnchor>
                </ItemGroup>
            ) : null}
            {!usageLimitRecoveryEnabled && !connectedServiceQuotasEnabled ? (
                <ItemGroup>
                    <Item
                        testID="settings-session-provider-limits-unavailable"
                        title={t('settingsSessionPages.providerLimits.unavailableTitle')}
                        subtitle={t('settingsSessionPages.providerLimits.unavailableDescription')}
                        subtitleLines={0}
                        showChevron={false}
                    />
                </ItemGroup>
            ) : null}
        </ItemList>
    );
});

export default SessionProviderLimitsSettingsView;
