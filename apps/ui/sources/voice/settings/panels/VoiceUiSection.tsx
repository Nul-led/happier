import * as React from 'react';
import { View } from 'react-native';

import { useUnistyles } from 'react-native-unistyles';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingAnchor, SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';
import { VOICE_ADVANCED_SETTINGS } from '@/voice/settings/voiceSettingsDeclarations';
import { SegmentedChoiceItem, type SegmentedChoiceOption } from '@/components/ui/lists/SegmentedChoiceItem';
import { Switch } from '@/components/ui/forms/Switch';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import type { VoiceSettings } from '@/sync/domains/settings/voiceSettings';
import { t } from '@/text';
import { Icon } from '@/components/ui/icons/Icon';

/**
 * Presentational only.
 *
 * `voice`/`setVoice` carry the **synced** Voice settings; `voiceOrbEnabled`/`setVoiceOrbEnabled`
 * carry a **device-local** preference. The section renders both and owns neither — the Voice
 * settings route reads MMKV through `useLocalSettingMutable` and hands the pair down. Reading
 * storage here would put a second owner behind the same switch.
 */
export function VoiceUiSection(props: {
  voice: VoiceSettings;
  setVoice: (next: VoiceSettings) => void;
  voiceOrbEnabled: boolean;
  setVoiceOrbEnabled: (next: boolean) => void;
  popoverBoundaryRef?: React.RefObject<any> | null;
}) {
  const { theme } = useUnistyles();
  const ui = props.voice.ui;
  const [openMenu, setOpenMenu] = React.useState<null | 'snippetsMaxMessages'>(null);

  const setUi = (patch: Partial<typeof ui>) => {
    props.setVoice({ ...props.voice, ui: { ...ui, ...patch } });
  };

  const updates = ui.updates;
  const showSnippetsOptions = updates.activeSession === 'snippets' || updates.otherSessions === 'snippets';
  const showOtherSessionsSnippetMode = updates.otherSessions === 'snippets';

  const setUpdatePatch = (patch: Partial<typeof updates>) => {
    setUi({ updates: { ...updates, ...patch } });
  };
  const updateLevelOptions = [
    { id: 'none', label: t('settingsVoice.ui.updates.level.noneTitle'), description: t('settingsVoice.ui.updates.level.noneSubtitle') },
    { id: 'activity', label: t('settingsVoice.ui.updates.level.activityTitle'), description: t('settingsVoice.ui.updates.level.activitySubtitle') },
    { id: 'summaries', label: t('settingsVoice.ui.updates.level.summariesTitle'), description: t('settingsVoice.ui.updates.level.summariesSubtitle') },
    { id: 'snippets', label: t('settingsVoice.ui.updates.level.snippetsTitle'), description: t('settingsVoice.ui.updates.level.snippetsSubtitle') },
  ] as const satisfies ReadonlyArray<SegmentedChoiceOption<typeof updates.activeSession>>;

  return (
    <>
      <SettingSection section={VOICE_ADVANCED_SETTINGS.sectionRefs.surface}>
        <ItemGroup title={t('settingsVoice.ui.title')} description={t('settingsVoice.ui.footer')}>
          <SettingRow
            setting={VOICE_ADVANCED_SETTINGS.settings.activityFeedEnabled}
            subtitleLines={0}
            rightElement={
              <Switch
                testID="settings.voice.ui.activityFeedEnabled"
                accessibilityLabel={t('settingsVoice.ui.activityFeedEnabled')}
                value={ui.activityFeedEnabled}
                onValueChange={(v) => setUi({ activityFeedEnabled: v })}
              />
            }
          />

          {ui.activityFeedEnabled ? (
            <SettingRow
              setting={VOICE_ADVANCED_SETTINGS.settings.activityFeedAutoExpandOnStart}
              subtitleLines={0}
              rightElement={
                <Switch
                  accessibilityLabel={t('settingsVoice.ui.activityFeedAutoExpandOnStart')}
                  value={ui.activityFeedAutoExpandOnStart}
                  onValueChange={(v) => setUi({ activityFeedAutoExpandOnStart: v })}
                />
              }
            />
          ) : null}

          <SettingRow
            setting={VOICE_ADVANCED_SETTINGS.settings.orbEnabled}
            subtitleLines={0}
            rightElement={
              <Switch
                testID="settings.voice.ui.orbEnabled"
                accessibilityLabel={t('settingsVoice.ui.orbEnabled')}
                value={props.voiceOrbEnabled}
                onValueChange={props.setVoiceOrbEnabled}
              />
            }
          />

          <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.scopeDefault}>
            <SegmentedChoiceItem
              title={t('settingsVoice.ui.scopeTitle')}
              subtitleLines={0}
              testIDPrefix="settings.voice.ui.scopeDefault"
              value={ui.scopeDefault}
              onChange={(scopeDefault) => setUi({ scopeDefault })}
              options={[
                { id: 'global', label: t('settingsVoice.ui.scopeGlobal'), description: t('settingsVoice.ui.scopeGlobalSubtitle') },
                { id: 'session', label: t('settingsVoice.ui.scopeSession'), description: t('settingsVoice.ui.scopeSessionSubtitle') },
              ]}
            />
          </SettingAnchor>

          <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.surfaceLocation}>
            <SegmentedChoiceItem
              testID="settings.voice.ui.surfaceLocation"
              title={t('settingsVoice.ui.surfaceLocationTitle')}
              subtitleLines={0}
              testIDPrefix="settings.voice.ui.surfaceLocation"
              value={ui.surfaceLocation}
              onChange={(surfaceLocation) => setUi({ surfaceLocation })}
              options={[
                { id: 'auto', label: t('settingsVoice.ui.surfaceLocation.autoTitle'), description: t('settingsVoice.ui.surfaceLocation.autoSubtitle') },
                { id: 'sidebar', label: t('settingsVoice.ui.surfaceLocation.sidebarTitle'), description: t('settingsVoice.ui.surfaceLocation.sidebarSubtitle') },
                { id: 'session', label: t('settingsVoice.ui.surfaceLocation.sessionTitle'), description: t('settingsVoice.ui.surfaceLocation.sessionSubtitle') },
              ]}
            />
          </SettingAnchor>
        </ItemGroup>
      </SettingSection>

      <SettingSection section={VOICE_ADVANCED_SETTINGS.sectionRefs.updates}>
        <ItemGroup title={t('settingsVoice.ui.updates.title')} description={t('settingsVoice.ui.updates.footer')}>
          <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.activeSession}>
            <SegmentedChoiceItem
              title={t('settingsVoice.ui.updates.activeSessionTitle')}
              subtitleLines={0}
              testIDPrefix="settings.voice.ui.updates.activeSession"
              value={updates.activeSession}
              onChange={(activeSession) => setUpdatePatch({ activeSession })}
              options={updateLevelOptions}
            />
          </SettingAnchor>

          <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.otherSessions}>
            <SegmentedChoiceItem
              title={t('settingsVoice.ui.updates.otherSessionsTitle')}
              subtitleLines={0}
              testIDPrefix="settings.voice.ui.updates.otherSessions"
              value={updates.otherSessions}
              onChange={(otherSessions) => setUpdatePatch({ otherSessions })}
              options={updateLevelOptions}
            />
          </SettingAnchor>

          {showSnippetsOptions ? (
            <>
              <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.snippetsMaxMessages}>
                <DropdownMenu
                  open={openMenu === 'snippetsMaxMessages'}
                  onOpenChange={(next) => setOpenMenu(next ? 'snippetsMaxMessages' : null)}
                  variant="selectable"
                  search={false}
                  selectedId={String(updates.snippetsMaxMessages)}
                  showCategoryTitles={false}
                  matchTriggerWidth={true}
                  connectToTrigger={true}
                  rowKind="item"
                  popoverBoundaryRef={props.popoverBoundaryRef}
                  itemTrigger={{
                    title: t(VOICE_ADVANCED_SETTINGS.settings.snippetsMaxMessages.titleKey),
                    subtitle: t('settingsVoice.ui.updates.snippetsMaxMessagesSubtitle'),
                    showSelectedSubtitle: false,
                    itemProps: { subtitleLines: 0 },
                  }}
                  items={Array.from({ length: 10 }, (_, idx) => {
                    const n = idx + 1;
                    return {
                      id: String(n),
                      title: String(n),
                      subtitle: undefined,
                      icon: (
                        <View style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="list" size={20} color={theme.colors.text.secondary} />
                        </View>
                      ),
                    };
                  })}
                  onSelect={(id) => {
                    const n = Number(id);
                    if (!Number.isFinite(n)) return;
                    setUpdatePatch({ snippetsMaxMessages: Math.max(1, Math.min(10, Math.floor(n))) });
                    setOpenMenu(null);
                  }}
                />
              </SettingAnchor>

              <SettingRow
                setting={VOICE_ADVANCED_SETTINGS.settings.includeUserMessagesInSnippets}
                subtitleLines={0}
                rightElement={
                  <Switch
                    accessibilityLabel={t('settingsVoice.ui.updates.includeUserMessagesInSnippetsTitle')}
                    value={updates.includeUserMessagesInSnippets}
                    onValueChange={(v) => setUpdatePatch({ includeUserMessagesInSnippets: v })}
                  />
                }
              />
            </>
          ) : null}

          {showOtherSessionsSnippetMode ? (
            <>
              <SettingAnchor setting={VOICE_ADVANCED_SETTINGS.settings.otherSessionsSnippetsMode}>
                <SegmentedChoiceItem
                  title={t(VOICE_ADVANCED_SETTINGS.settings.otherSessionsSnippetsMode.titleKey)}
                  subtitleLines={0}
                  testIDPrefix="settings.voice.ui.updates.otherSessionsSnippetsMode"
                  value={updates.otherSessionsSnippetsMode}
                  onChange={(otherSessionsSnippetsMode) => setUpdatePatch({ otherSessionsSnippetsMode })}
                  options={[
                    { id: 'never', label: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.neverTitle'), description: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.neverSubtitle') },
                    { id: 'on_demand_only', label: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.onDemandTitle'), description: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.onDemandSubtitle') },
                    { id: 'auto', label: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.autoTitle'), description: t('settingsVoice.ui.updates.otherSessionsSnippetsMode.autoSubtitle') },
                  ]}
                />
              </SettingAnchor>
            </>
          ) : null}
        </ItemGroup>
      </SettingSection>
    </>
  );
}
