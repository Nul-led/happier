import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { SettingAnchor, SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';
import { VOICE_PRIVACY_SETTINGS } from '@/voice/settings/voiceSettingsDeclarations';
import { Switch } from '@/components/ui/forms/Switch';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import type { VoiceSettings } from '@/sync/domains/settings/voiceSettings';
import { t } from '@/text';

export function VoicePrivacySection(props: { voice: VoiceSettings; setVoice: (next: VoiceSettings) => void }) {
  const privacy = props.voice.privacy;
  const currentUiContextModeOptions = React.useMemo(() => [
    { id: 'off' as const, label: t('settingsVoice.privacy.currentUiContextMode.offTitle'), description: t('settingsVoice.privacy.currentUiContextMode.offSubtitle') },
    { id: 'on_demand' as const, label: t('settingsVoice.privacy.currentUiContextMode.onDemandTitle'), description: t('settingsVoice.privacy.currentUiContextMode.onDemandSubtitle') },
    { id: 'automatic' as const, label: t('settingsVoice.privacy.currentUiContextMode.automaticTitle'), description: t('settingsVoice.privacy.currentUiContextMode.automaticSubtitle') },
  ], []);

  const setPrivacy = (patch: Partial<VoiceSettings['privacy']>) => {
    props.setVoice({
      ...props.voice,
      privacy: { ...privacy, ...patch },
    });
  };

  return (
    <SettingSection section={VOICE_PRIVACY_SETTINGS.sectionRefs.contextSharing}>
      <ItemGroup
        title={t('settingsVoice.privacy.title')}
        description={t('settingsVoice.privacy.footer')}
      >
        <SettingAnchor setting={VOICE_PRIVACY_SETTINGS.settings.currentUiContextMode}>
          <SegmentedChoiceItem<VoiceSettings['privacy']['currentUiContextMode']>
            testID="settings.voice.privacy.currentUiContextMode"
            testIDPrefix="settings.voice.privacy.currentUiContextMode"
            title={t('settingsVoice.privacy.currentUiContextModeTitle')}
            subtitleLines={0}
            value={privacy.currentUiContextMode}
            options={currentUiContextModeOptions}
            onChange={(currentUiContextMode) => setPrivacy({ currentUiContextMode })}
          />
        </SettingAnchor>
        <SettingRow
          setting={VOICE_PRIVACY_SETTINGS.settings.shareSessionSummary}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.privacy.shareSessionSummary')}
              value={privacy.shareSessionSummary}
              onValueChange={(v) => setPrivacy({ shareSessionSummary: v })}
            />
          )}
        />
        <SettingRow
          setting={VOICE_PRIVACY_SETTINGS.settings.shareRecentMessages}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.privacy.shareRecentMessages')}
              value={privacy.shareRecentMessages}
              onValueChange={(v) => setPrivacy({ shareRecentMessages: v })}
            />
          )}
        />
        {privacy.shareRecentMessages ? (
          <FieldValueItem
            title={t('settingsVoice.privacy.recentMessagesCount')}
            subtitle={t('settingsVoice.privacy.recentMessagesCountSubtitle')}
            fieldTestID="settings.voice.privacy.recentMessagesCount.field"
            kind="integer"
            value={String(privacy.recentMessagesCount)}
            onCommit={(draft) => {
              const next = Math.max(0, Math.min(50, Math.floor(Number(draft))));
              setPrivacy({ recentMessagesCount: next });
              return String(next);
            }}
          />
        ) : null}
        <SettingRow
          setting={VOICE_PRIVACY_SETTINGS.settings.shareToolNames}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.privacy.shareToolNames')}
              value={privacy.shareToolNames}
              onValueChange={(v) => setPrivacy({ shareToolNames: v })}
            />
          )}
        />
        <SettingRow
          setting={VOICE_PRIVACY_SETTINGS.settings.shareDeviceInventory}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.privacy.shareDeviceInventory')}
              value={privacy.shareDeviceInventory}
              onValueChange={(v) => setPrivacy({ shareDeviceInventory: v })}
            />
          )}
        />
        <SettingRow
          setting={VOICE_PRIVACY_SETTINGS.settings.sharePermissionRequests}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.privacy.sharePermissionRequests')}
              value={privacy.sharePermissionRequests}
              onValueChange={(v) => setPrivacy({ sharePermissionRequests: v })}
            />
          )}
        />
      </ItemGroup>
    </SettingSection>
  );
}
