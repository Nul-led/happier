import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { Switch } from '@/components/ui/forms/Switch';
import {
  readLocalDirectVoiceSettings,
  voiceSettingsParse,
  writeLocalDirectVoiceSettings,
  type VoiceSettings,
} from '@/sync/domains/settings/voiceSettings';
import { t } from '@/text';
import { parseLocalVoiceSttSettings } from '@/voice/local/localVoiceSettings';
import { LocalVoiceTtsGroup } from '@/voice/settings/panels/localTts/LocalVoiceTtsGroup';
import { LocalVoiceSttGroup } from '@/voice/settings/panels/localStt/LocalVoiceSttGroup';
import { resolveVoiceProviderIdFromSettings } from '@/voice/settings/resolveVoiceProviderId';
import type { VoiceDaemonRouteDiagnosticReason } from '@/voice/settings/voiceProviderLocalAvailability';

export function LocalDirectSection(props: {
  voice: VoiceSettings;
  setVoice: (next: VoiceSettings) => void;
  popoverBoundaryRef?: React.RefObject<any> | null;
  daemonRouteDiagnosticReason?: VoiceDaemonRouteDiagnosticReason | null;
}) {
  const voice = voiceSettingsParse(props.voice);
  const enabled = resolveVoiceProviderIdFromSettings(voice) === 'local_direct';
  if (!enabled) return null;

  const cfg = readLocalDirectVoiceSettings(voice);

  const setCfg = (patch: Partial<typeof cfg>) => {
    props.setVoice(writeLocalDirectVoiceSettings(voice, { ...cfg, ...patch }));
  };

  const sttProvider = parseLocalVoiceSttSettings(cfg.stt).provider;

  return (
    <>
      <LocalVoiceSttGroup
        cfgStt={cfg.stt}
        setStt={(next) => setCfg({ stt: next })}
        voice={voice}
        setVoice={props.setVoice}
        popoverBoundaryRef={props.popoverBoundaryRef}
        daemonRouteDiagnosticReason={props.daemonRouteDiagnosticReason}
      />

      {sttProvider === 'device' ? (
        <ItemGroup title={t('settingsVoice.local.conversation.handsFree.title')}>
          <Item
            title={t('settingsVoice.local.conversation.handsFree.enableTitle')}
            rightElement={
              <Switch
                accessibilityLabel={t('settingsVoice.local.conversation.handsFree.enableTitle')}
                value={cfg.handsFree.enabled}
                onValueChange={(v) => setCfg({ handsFree: { ...cfg.handsFree, enabled: v } })}
              />
            }
          />
          <FieldValueItem
            title={t('settingsVoice.local.conversation.handsFree.silenceTitle')}
            fieldTestID="settings.voice.localDirect.handsFree.silenceMs.field"
            kind="integer"
            value={String(cfg.handsFree.endpointing.silenceMs)}
            onCommit={(draft) => {
              const next = Math.max(0, Math.min(5000, Math.floor(Number(draft))));
              setCfg({ handsFree: { ...cfg.handsFree, endpointing: { ...cfg.handsFree.endpointing, silenceMs: next } } });
              return String(next);
            }}
          />
          <FieldValueItem
            title={t('settingsVoice.local.conversation.handsFree.minSpeechTitle')}
            fieldTestID="settings.voice.localDirect.handsFree.minSpeechMs.field"
            kind="integer"
            value={String(cfg.handsFree.endpointing.minSpeechMs)}
            onCommit={(draft) => {
              const next = Math.max(0, Math.min(5000, Math.floor(Number(draft))));
              setCfg({ handsFree: { ...cfg.handsFree, endpointing: { ...cfg.handsFree.endpointing, minSpeechMs: next } } });
              return String(next);
            }}
          />
        </ItemGroup>
      ) : null}

      <LocalVoiceTtsGroup
        cfgTts={cfg.tts}
        setTts={(next) => setCfg({ tts: next })}
        voice={voice}
        setVoice={props.setVoice}
        networkTimeoutMs={cfg.networkTimeoutMs}
        popoverBoundaryRef={props.popoverBoundaryRef}
        daemonRouteDiagnosticReason={props.daemonRouteDiagnosticReason}
      />

      <ItemGroup title={t('settingsVoice.local.conversation.network.title')}>
        <FieldValueItem
          title={t('settingsVoice.local.conversation.network.timeoutTitle')}
          subtitle={t('settingsVoice.local.conversation.network.timeoutPromptBody')}
          fieldTestID="settings.voice.localDirect.networkTimeoutMs.field"
          kind="integer"
          value={String(cfg.networkTimeoutMs)}
          onCommit={(draft) => {
            const next = Math.max(1000, Math.min(60000, Math.floor(Number(draft))));
            setCfg({ networkTimeoutMs: next });
            return String(next);
          }}
        />
      </ItemGroup>
    </>
  );
}
