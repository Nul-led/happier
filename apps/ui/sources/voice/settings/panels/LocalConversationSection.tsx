import { useAuthoringMemoryField } from '@/sync/domains/state/storage';
import * as React from 'react';

import { useUnistyles } from 'react-native-unistyles';

import { DEFAULT_AGENT_ID, getAgentCore, isBundledAgentId, type AgentId } from '@/agents/catalog/catalog';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { getResolvedAgentCatalogEntries } from '@/agents/backendCatalog/agentCatalogProjection';
import { useDaemonMergedProjectionInputs } from '@/agents/backendCatalog/useDaemonMergedProjectionInputs';
import { AgentCatalogIdentityIcon } from '@/agents/presentation/AgentCatalogIdentityIcon';
import { getModelDropdownMenuItems, REFRESH_MODELS_DROPDOWN_ITEM_ID } from '@/components/settings/pickers/modelDropdownItems';
import { renderDropdownItemIcon } from '@/components/settings/pickers/renderDropdownItemIcon';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { FieldValueItem } from '@/components/ui/forms/FieldValueItem';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { Modal } from '@/modal';
import {
  readLocalConversationVoiceSettings,
  voiceSettingsParse,
  writeLocalConversationVoiceSettings,
  type VoiceSettings,
} from '@/sync/domains/settings/voiceSettings';
import { t } from '@/text';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { parseLocalVoiceSttSettings, parseLocalVoiceTtsSettings } from '@/voice/local/localVoiceSettings';
import { LocalVoiceSttGroup } from '@/voice/settings/panels/localStt/LocalVoiceSttGroup';
import { LocalVoiceTtsGroup } from '@/voice/settings/panels/localTts/LocalVoiceTtsGroup';
import {
  DaemonVoiceModelCatalogSection,
  type DaemonVoiceModelCatalogController,
} from '@/voice/settings/panels/modelCatalog/DaemonVoiceModelCatalogSection';
import type { VoiceDaemonRouteDiagnosticReason } from '@/voice/settings/voiceProviderLocalAvailability';
import { resetGlobalVoiceAgentPersistence } from '@/voice/agent/resetGlobalVoiceAgentPersistence';
import { canAgentResume } from '@/agents/runtime/resumeCapabilities';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { useNewSessionPreflightModelsState } from '@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { useAllMachines } from '@/sync/store/hooks';
import { useSetting, useSettings } from '@/sync/domains/state/storage';
import { resolvePreferredMachineId } from '@/components/settings/pickers/resolvePreferredMachineId';
import { resolveVoiceProviderIdFromSettings } from '@/voice/settings/resolveVoiceProviderId';
import { applyVoiceWelcomeSelection, resolveVoiceWelcomeSelection } from '@/voice/settings/welcome';
import { Icon } from '@/components/ui/icons/Icon';
import {
  completeLegacyVoiceOpenAiChatAgentSelection,
  LEGACY_VOICE_OPENAI_CHAT_COMPATIBLE_AGENT_ID,
} from '@/voice/adapters/localConversation/migrateLegacyOpenAiChatProvider';


export function LocalConversationSection(props: {
  voice: VoiceSettings;
  setVoice: (next: VoiceSettings) => void;
  popoverBoundaryRef?: React.RefObject<any> | null;
  daemonModelCatalog?: DaemonVoiceModelCatalogController;
  daemonRouteDiagnosticReason?: VoiceDaemonRouteDiagnosticReason | null;
}) {
  const { theme } = useUnistyles();
  const voiceAgentEnabled = useFeatureEnabled('voice.agent');
  const enabledAgentIds = useEnabledAgentIds();
  const settings = useSettings();
  // "Custom…" in a model or agent menu opens an inline field under that menu, not a prompt.
  const [customEntry, setCustomEntry] = React.useState<null | 'agentId' | 'chatModelId' | 'commitModelId'>(null);
  const [openMenu, setOpenMenu] = React.useState<
    | null
    | 'mediatorAgentId'
    | 'providerChatAgentSelection'
    | 'mediatorResumabilityMode'
    | 'mediatorReplayStrategy'
    | 'mediatorChatModelId'
    | 'mediatorCommitModelId'
  >(null);

  const voice = voiceSettingsParse(props.voice);
  const cfg = readLocalConversationVoiceSettings(voice);
  const hasConfiguredProviderChat = cfg.agent.providerChat?.status === 'configured';
  const executionMachine = voice.executionMachine;
  const enabled = resolveVoiceProviderIdFromSettings(voice) === 'local_conversation';
  const machines = useAllMachines();
  const recentMachinePaths = useAuthoringMemoryField('recentMachinePaths');

  const selectedAgentIdForDropdown = React.useMemo(() => {
    const raw = String(cfg.agent.agentId ?? '').trim();
    return raw.length > 0 ? raw : null;
  }, [cfg.agent.agentId]);

  // The configured voice Agent may be any installed Agent, bundled or plugin-contributed, so its
  // id goes to the model preflight as-is. Narrowing to the bundled ids here would preflight the
  // default Agent's catalog and offer models the selected Agent cannot run.
  const selectedAgentIdForModelOptions = React.useMemo(() => {
    if (cfg.agent.agentSource !== 'agent') return null;
    const raw = String(cfg.agent.agentId ?? '').trim();
    return raw.length > 0 ? raw : null;
  }, [cfg.agent.agentId, cfg.agent.agentSource]);
  const effectiveAgentIdForModelOptions = selectedAgentIdForModelOptions ?? DEFAULT_AGENT_ID;

  const preflightMachineId = React.useMemo(() => {
    if (executionMachine.mode === 'fixed') {
      const machineId = String(executionMachine.machineId ?? '').trim();
      return machineId.length > 0 ? machineId : null;
    }

    return resolvePreferredMachineId({
      machines,
      recentMachinePaths: Array.isArray(recentMachinePaths) ? recentMachinePaths : [],
    });
  }, [executionMachine.machineId, executionMachine.mode, machines, recentMachinePaths]);

  const capabilityServerId = String(getActiveServerSnapshot().serverId ?? '').trim();
  const daemonMergedProjection = useDaemonMergedProjectionInputs({
    machineId: preflightMachineId,
    serverId: capabilityServerId,
    enabled: Boolean(preflightMachineId),
  });
  const currentDaemonProjectionInputs = daemonMergedProjection.phase === 'ready'
    ? daemonMergedProjection.inputs
    : null;
  const enabledBuiltInAgentIds = React.useMemo(
    () => new Set<string>(enabledAgentIds),
    [enabledAgentIds],
  );
  const resolvedAgentEntries = React.useMemo(() => getResolvedAgentCatalogEntries({
    enabledAgentIds,
    acpCatalogSettingsV1: settings.acpCatalogSettingsV1,
    backendEnabledByTargetKey: settings.backendEnabledByTargetKey,
    mergedProviderProjectionById: currentDaemonProjectionInputs?.mergedProviderProjectionById ?? null,
    mergedBackendProjectionById: currentDaemonProjectionInputs?.mergedBackendProjectionById ?? null,
  }).filter((entry) => (
    entry.isBuiltIn
      ? enabledBuiltInAgentIds.has(entry.agentId)
      : entry.enabled !== false
  )), [
    currentDaemonProjectionInputs?.mergedBackendProjectionById,
    currentDaemonProjectionInputs?.mergedProviderProjectionById,
    enabledBuiltInAgentIds,
    enabledAgentIds,
    settings.acpCatalogSettingsV1,
    settings.backendEnabledByTargetKey,
  ]);
  const selectedAgentIdLabel = React.useMemo(() => {
    const raw = String(cfg.agent.agentId ?? '').trim();
    if (!raw) return t('settingsVoice.local.notSet');
    const projectedEntry = resolvedAgentEntries.find((entry) => entry.agentId === raw);
    if (projectedEntry) return projectedEntry.title;
    if (isBundledAgentId(raw as any)) return t(getAgentCore(raw as any).displayNameKey);
    return raw;
  }, [cfg.agent.agentId, resolvedAgentEntries]);
  const agentIdMenuItems = React.useMemo(() => [
    ...resolvedAgentEntries.map((entry) => ({
      id: entry.agentId,
      title: entry.title,
      subtitle: entry.subtitle ?? entry.qualifiedId,
      icon: (
        <AgentCatalogIdentityIcon
          entry={entry}
          machineId={preflightMachineId}
          serverId={capabilityServerId || null}
          current={daemonMergedProjection.phase === 'ready'}
          size={22}
        />
      ),
    })),
    {
      id: '__custom__',
      title: t('settingsVoice.local.modelCustomTitle'),
      subtitle: t('settingsVoice.local.conversation.customBackendIdSubtitle'),
      icon: renderDropdownItemIcon({
        name: 'pencil-simple',
        color: theme.colors.text.secondary,
      }),
    },
  ], [
    capabilityServerId,
    daemonMergedProjection.phase,
    preflightMachineId,
    resolvedAgentEntries,
    theme.colors.text.secondary,
  ]);

  const preflightModels = useNewSessionPreflightModelsState({
    backendTarget: hasConfiguredProviderChat
      ? null
      : { kind: 'backend', backendId: effectiveAgentIdForModelOptions },
    // This id is an Agent id, not a backend id, so name it as the runtime carrier:
    // a non-bundled backend id alone leaves the preflight with no Agent to probe.
    runtimeCarrierAgentId: effectiveAgentIdForModelOptions as AgentId,
    selectedMachineId: preflightMachineId,
    capabilityServerId,
  });

  const selectableModelMenuItems = React.useMemo(() => {
    return getModelDropdownMenuItems({
      modelOptions: preflightModels.modelOptions,
      iconColor: theme.colors.text.secondary,
      probe: {
        phase: preflightModels.probe.phase,
        onRefresh: preflightModels.probe.onRefresh,
      },
    });
  }, [preflightModels.modelOptions, preflightModels.probe.onRefresh, preflightModels.probe.phase, theme.colors.text.secondary]);

  const modelIdMenuItems = React.useMemo(() => {
    return [
      ...selectableModelMenuItems,
      {
        id: '__custom__',
        title: t('settingsVoice.local.modelCustomTitle'),
        subtitle: t('settingsVoice.local.modelCustomSubtitle'),
        icon: renderDropdownItemIcon({
          name: 'pencil-simple',
          color: theme.colors.text.secondary,
        }),
      },
    ];
  }, [selectableModelMenuItems, theme.colors.text.secondary]);

  const rootSessionPolicyOptions = React.useMemo(() => [
    {
      id: 'single' as const,
      label: t('settingsVoice.local.conversation.rootSessionPolicy.singleTitle'),
      description: t('settingsVoice.local.conversation.rootSessionPolicy.singleSubtitle'),
    },
    {
      id: 'keep_warm' as const,
      label: t('settingsVoice.local.conversation.rootSessionPolicy.keepWarmTitle'),
      description: t('settingsVoice.local.conversation.rootSessionPolicy.keepWarmSubtitle'),
    },
  ], []);

  const providerResumeSupportedByAgent = React.useMemo(() => {
    if (!enabled) return true;
    if (cfg.agent.agentSource !== 'agent') return true;
    const agentId = String(cfg.agent.agentId ?? '').trim();
    if (!agentId) return false;
    return canAgentResume(agentId, { accountSettings: settings as any });
  }, [cfg.agent.agentId, cfg.agent.agentSource, enabled, settings]);

  if (!enabled) return null;

  const setCfg = (patch: Partial<typeof cfg>) => {
    props.setVoice(writeLocalConversationVoiceSettings(voice, { ...cfg, ...patch }));
  };

  const setAgent = (patch: Partial<typeof cfg.agent>) => setCfg({ agent: { ...cfg.agent, ...patch } });
  const setStreaming = (patch: Partial<typeof cfg.streaming>) => setCfg({ streaming: { ...cfg.streaming, ...patch } });

  const parsedStt = parseLocalVoiceSttSettings(cfg.stt);
  const parsedTts = parseLocalVoiceTtsSettings(cfg.tts);
  const sttProvider = parsedStt.provider;

  // Canonical per-kind default pack id. The daemon-local model catalog reuses the
  // existing local-neural `assetId` field as the selected-default selector rather
  // than introducing a parallel settings key.
  const selectedSttPackId = parsedStt.localNeural?.assetId ?? null;
  const selectedTtsPackId = parsedTts.localNeural?.assetId ?? null;

  const selectModelDefault = (kind: 'stt_sherpa' | 'tts_sherpa', packId: string) => {
    if (kind === 'stt_sherpa') {
      setCfg({ stt: { ...parsedStt, localNeural: { ...parsedStt.localNeural, assetId: packId } } });
      return;
    }
    setCfg({ tts: { ...parsedTts, localNeural: { ...parsedTts.localNeural, assetId: packId } } });
  };

  return (
    <>
      <ItemGroup title={t('settingsVoice.local.title')} description={t('settingsVoice.local.footer')}>
        <SegmentedChoiceItem
          title={t('settingsVoice.local.conversationMode')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.conversationMode"
          value={cfg.conversationMode}
          onChange={(next) => setCfg({ conversationMode: next })}
          options={[
            { id: 'agent', label: t('settingsFeatures.expVoiceAgent'), description: t('settingsVoice.local.conversation.mode.voiceAgentSubtitle') },
            { id: 'direct_session', label: t('settingsVoice.local.conversation.mode.directTitle'), description: t('settingsVoice.local.conversation.mode.directSubtitle') },
          ]}
        />
      </ItemGroup>

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
            fieldTestID="settings.voice.local.handsFree.silenceMs.field"
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
            fieldTestID="settings.voice.local.handsFree.minSpeechMs.field"
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

      <DaemonVoiceModelCatalogSection
        selectedSttPackId={selectedSttPackId}
        selectedTtsPackId={selectedTtsPackId}
        onSelectDefault={selectModelDefault}
        catalogController={props.daemonModelCatalog}
      />

      {cfg.conversationMode === 'agent' ? (
        <>
          <ItemGroup title={t('settingsFeatures.expVoiceAgent')}>
            <SegmentedChoiceItem
              title={t('settingsVoice.local.conversation.persistence.title')}
              subtitleLines={0}
              testIDPrefix="settings.voice.local.mediatorTranscriptPersistence"
              value={cfg.agent.transcript?.persistenceMode ?? 'ephemeral'}
              onChange={(next) => setAgent({ transcript: { ...(cfg.agent.transcript ?? {}), persistenceMode: next } })}
              options={[
                { id: 'ephemeral', label: t('settingsVoice.local.conversation.persistence.ephemeralTitle'), description: t('settingsVoice.local.conversation.persistence.ephemeralSubtitle') },
                { id: 'persistent', label: t('settingsVoice.local.conversation.persistence.persistentTitle'), description: t('settingsVoice.local.conversation.persistence.persistentSubtitle') },
              ]}
            />

            {(cfg.agent.transcript?.persistenceMode ?? 'ephemeral') === 'persistent' ? (
              <>
                <DropdownMenu
                  open={openMenu === 'mediatorResumabilityMode'}
                  onOpenChange={(next) => setOpenMenu(next ? 'mediatorResumabilityMode' : null)}
                  variant="selectable"
                  search={false}
                  selectedId={cfg.agent.resumabilityMode ?? 'replay'}
                  showCategoryTitles={false}
                  matchTriggerWidth={true}
                  connectToTrigger={true}
                  rowKind="item"
                  popoverBoundaryRef={props.popoverBoundaryRef}
                  itemTrigger={{
                    title: t('settingsVoice.local.conversation.resumability.modeTitle'),
                    subtitleFormatter: () => {
                      const mode = cfg.agent.resumabilityMode ?? 'replay';
                      if (mode !== 'provider_resume') return t('settingsVoice.local.conversation.resumability.replaySubtitle');
                      if (!voiceAgentEnabled) return t('settingsVoice.local.conversation.resumability.disabledVoiceAgent');
                      if (cfg.agent.agentSource === 'agent' && !providerResumeSupportedByAgent) return t('settingsVoice.local.conversation.resumability.disabledAgentNoProviderResume');
                      return t('settingsVoice.local.conversation.resumability.providerResumeSubtitle');
                    },
                    detailFormatter: () => ((cfg.agent.resumabilityMode ?? 'replay') === 'provider_resume'
                      ? t('settingsVoice.local.conversation.resumability.providerResumeTitle')
                      : t('settingsVoice.local.conversation.resumability.replayTitle')),
                  }}
                  items={[
                    {
                      id: 'replay',
                      title: t('settingsVoice.local.conversation.resumability.replayTitle'),
                      subtitle: t('settingsVoice.local.conversation.resumability.replaySubtitle'),
                      icon: <Icon name="clock" size={20} color={theme.colors.text.secondary} />,
                    },
                    {
                      id: 'provider_resume',
                      title: t('settingsVoice.local.conversation.resumability.providerResumeTitle'),
                      subtitle: !voiceAgentEnabled
                        ? t('settingsVoice.local.conversation.resumability.disabledVoiceAgent')
                        : cfg.agent.agentSource === 'agent' && !providerResumeSupportedByAgent
                            ? t('settingsVoice.local.conversation.resumability.disabledAgentNoProviderResume')
                            : t('settingsVoice.local.conversation.resumability.providerResumeSubtitle'),
                      disabled: !voiceAgentEnabled || (cfg.agent.agentSource === 'agent' && !providerResumeSupportedByAgent),
                      icon: <Icon name="arrow-clockwise" size={20} color={theme.colors.text.secondary} />,
                    },
                  ]}
                  onSelect={(id) => {
                    setAgent({ resumabilityMode: id as any });
                    setOpenMenu(null);
                  }}
                />

                {(cfg.agent.resumabilityMode ?? 'replay') === 'provider_resume' ? (
                  <Item
                    title={t('settingsVoice.local.conversation.providerResumeFallback.title')}
                    subtitle={t('settingsVoice.local.conversation.providerResumeFallback.subtitle')}
                    rightElement={
                      <Switch
                        accessibilityLabel={t('settingsVoice.local.conversation.providerResumeFallback.title')}
                        value={cfg.agent.providerResume?.fallbackToReplay !== false}
                        onValueChange={(v) => setAgent({ providerResume: { ...(cfg.agent.providerResume ?? {}), fallbackToReplay: v } })}
                      />
                    }
                  />
                ) : null}

                <DropdownMenu
                  open={openMenu === 'mediatorReplayStrategy'}
                  onOpenChange={(next) => setOpenMenu(next ? 'mediatorReplayStrategy' : null)}
                  variant="selectable"
                  search={false}
                  selectedId={cfg.agent.replay?.strategy ?? 'recent_messages'}
                  showCategoryTitles={false}
                  matchTriggerWidth={true}
                  connectToTrigger={true}
                  rowKind="item"
                  popoverBoundaryRef={props.popoverBoundaryRef}
                  itemTrigger={{
                    title: t('settingsSession.replayResume.strategyTitle'),
                  }}
                  items={[
                    {
                      id: 'recent_messages',
                      title: t('settingsSession.replayResume.strategy.recentTitle'),
                      subtitle: t('settingsSession.replayResume.strategy.recentSubtitle'),
                      icon: <Icon name="chats-circle" size={20} color={theme.colors.text.secondary} />,
                    },
                    {
                      id: 'summary_plus_recent',
                      title: t('settingsSession.replayResume.strategy.summaryRecentTitle'),
                      subtitle: t('settingsSession.replayResume.strategy.summaryRecentSubtitle'),
                      icon: <Icon name="file-text" size={20} color={theme.colors.text.secondary} />,
                    },
                  ]}
                  onSelect={(id) => {
                    setAgent({ replay: { ...(cfg.agent.replay ?? {}), strategy: id as any } });
                    setOpenMenu(null);
                  }}
                />

                <FieldValueItem
                  title={t('settingsSession.replayResume.recentMessagesTitle')}
                  subtitle={t('settingsVoice.local.conversation.replayRecentMessagesPromptBody')}
                  fieldTestID="settings.voice.local.replay.recentMessagesCount.field"
                  kind="integer"
                  value={String(cfg.agent.replay?.recentMessagesCount ?? 16)}
                  onCommit={(draft) => {
                    const next = Math.max(1, Math.min(100, Math.floor(Number(draft))));
                    setAgent({ replay: { ...(cfg.agent.replay ?? {}), recentMessagesCount: next } });
                    return String(next);
                  }}
                />
              </>
            ) : null}

            <Item
              title={t('settingsVoice.local.conversation.prewarm.title')}
              subtitle={t('settingsVoice.local.conversation.prewarm.subtitle')}
              rightElement={
                <Switch
                  accessibilityLabel={t('settingsVoice.local.conversation.prewarm.title')}
                  value={cfg.agent.prewarmOnConnect === true}
                  onValueChange={(v) => setAgent({ prewarmOnConnect: v })}
                />
              }
            />

            <SegmentedChoiceItem
              title={t('settingsVoice.local.conversation.welcome.title')}
              subtitleLines={0}
              testIDPrefix="settings.voice.local.mediatorWelcomeMode"
              value={resolveVoiceWelcomeSelection(voice.welcome)}
              onChange={(next) => props.setVoice(applyVoiceWelcomeSelection(voice, next))}
              options={[
                { id: 'off', label: t('settingsVoice.local.conversation.welcome.offTitle'), description: t('settingsVoice.local.conversation.welcome.offSubtitle') },
                { id: 'immediate', label: t('settingsVoice.local.conversation.welcome.immediateTitle'), description: t('settingsVoice.local.conversation.welcome.immediateSubtitle') },
                { id: 'on_first_turn', label: t('settingsVoice.local.conversation.welcome.onFirstTurnTitle'), description: t('settingsVoice.local.conversation.welcome.onFirstTurnSubtitle') },
              ]}
            />

              {(cfg.agent.transcript?.persistenceMode ?? 'ephemeral') === 'persistent' ? (
                <Item
                  title={t('settingsVoice.local.conversation.resetVoiceAgent.title')}
                  subtitle={t('settingsVoice.local.conversation.resetVoiceAgent.subtitle')}
                  destructive
                onPress={() => {
                  fireAndForget((async () => {
                    const confirmed = await Modal.confirm(
                      t('settingsVoice.local.conversation.resetVoiceAgent.title'),
                      t('settingsVoice.local.conversation.resetVoiceAgent.confirmBody'),
                      { confirmText: t('common.reset') },
                    );
                    if (!confirmed) return;
                    await resetGlobalVoiceAgentPersistence();
                  })(), { tag: 'LocalConversationSection.confirm.resetVoiceAgent' });
                  }}
                />
              ) : null}
            </ItemGroup>

            <ItemGroup title={t('settingsVoice.local.conversation.agentSettings.title')}>
              <Item
                title={t('settingsVoice.local.conversation.agentMachine.stayInVoiceHomeTitle')}
                subtitle={
                  cfg.agent.stayInVoiceHome
                    ? t('settingsVoice.local.conversation.agentMachine.stayInVoiceHomeEnabledSubtitle')
                    : t('settingsVoice.local.conversation.agentMachine.stayInVoiceHomeDisabledSubtitle')
                }
                rightElement={
                  <Switch
                    accessibilityLabel={t('settingsVoice.local.conversation.agentMachine.stayInVoiceHomeTitle')}
                    value={cfg.agent.stayInVoiceHome === true}
                    onValueChange={(v) => setAgent({ stayInVoiceHome: v })}
                  />
                }
                rightElementOutsidePressable
                onPress={() => setAgent({ stayInVoiceHome: cfg.agent.stayInVoiceHome !== true })}
                showChevron={false}
                selected={false}
              />

              <Item
                title={t('settingsVoice.local.conversation.agentMachine.allowTeleportTitle')}
                subtitle={
                  cfg.agent.teleportEnabled === false
                    ? t('settingsVoice.local.conversation.agentMachine.teleportDisabledSubtitle')
                    : t('settingsVoice.local.conversation.agentMachine.teleportEnabledSubtitle')
                }
                rightElement={
                  <Switch
                    accessibilityLabel={t('settingsVoice.local.conversation.agentMachine.allowTeleportTitle')}
                    value={cfg.agent.teleportEnabled !== false}
                    onValueChange={(v) => setAgent({ teleportEnabled: v })}
                  />
                }
                rightElementOutsidePressable
                onPress={() => setAgent({ teleportEnabled: cfg.agent.teleportEnabled === false })}
                showChevron={false}
                selected={false}
              />

              <SegmentedChoiceItem
                title={t('settingsVoice.local.conversation.rootSessionPolicy.title')}
                subtitleLines={0}
                testIDPrefix="settings.voice.local.mediatorRootSessionPolicy"
                value={cfg.agent.rootSessionPolicy === 'keep_warm' ? 'keep_warm' : 'single'}
                onChange={(next) => setAgent({ rootSessionPolicy: next })}
                options={rootSessionPolicyOptions}
              />

              {cfg.agent.rootSessionPolicy === 'keep_warm' ? (
                <FieldValueItem
                  title={t('settingsVoice.local.conversation.rootSessionPolicy.maxWarmRootsTitle')}
                  subtitle={t('settingsVoice.local.conversation.rootSessionPolicy.maxWarmRootsSubtitle')}
                  fieldTestID="settings.voice.local.maxWarmRoots.field"
                  kind="integer"
                  value={String(cfg.agent.maxWarmRoots ?? 3)}
                  onCommit={(draft) => {
                    const next = Math.max(1, Math.min(10, Math.floor(Number(draft))));
                    setAgent({ maxWarmRoots: next });
                    return String(next);
                  }}
                />
              ) : null}
        {cfg.agent.providerChat?.status === 'needs_selection' ? (
          <DropdownMenu
            open={openMenu === 'providerChatAgentSelection'}
            onOpenChange={(next) => setOpenMenu(next ? 'providerChatAgentSelection' : null)}
            variant="selectable"
            search={false}
            selectedId=""
            showCategoryTitles={false}
            matchTriggerWidth={true}
            connectToTrigger={true}
            rowKind="item"
            popoverBoundaryRef={props.popoverBoundaryRef}
            itemTrigger={{
              title: t('settingsVoice.local.mediatorAgentId'),
              subtitleFormatter: () => t('settingsVoice.local.mediatorAgentIdSubtitle'),
            }}
            items={[{
              id: LEGACY_VOICE_OPENAI_CHAT_COMPATIBLE_AGENT_ID,
              title: t(getAgentCore(LEGACY_VOICE_OPENAI_CHAT_COMPATIBLE_AGENT_ID).displayNameKey),
              subtitle: t('settingsVoice.local.conversation.agentSource.fixedAgentSubtitle'),
              icon: <Icon name="person" size={20} color={theme.colors.text.secondary} />,
            }]}
            onSelect={(id) => {
              const providerChat = completeLegacyVoiceOpenAiChatAgentSelection(
                cfg.agent.providerChat as Extract<NonNullable<typeof cfg.agent.providerChat>, { status: 'needs_selection' }>,
                String(id),
              );
              if (!providerChat) return;
              setAgent({
                agentSource: 'agent',
                agentId: LEGACY_VOICE_OPENAI_CHAT_COMPATIBLE_AGENT_ID,
                providerChat,
              });
              setOpenMenu(null);
            }}
          />
        ) : null}
        {!hasConfiguredProviderChat ? (
          <>
        <SegmentedChoiceItem
          title={t('settingsVoice.local.mediatorAgentSource')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.mediatorAgentSource"
          value={cfg.agent.agentSource}
          onChange={(next) => setAgent({ agentSource: next })}
          options={[
            { id: 'session', label: t('settingsVoice.local.conversation.agentSource.followSessionTitle'), description: t('settingsVoice.local.conversation.agentSource.followSessionSubtitle') },
            { id: 'agent', label: t('settingsVoice.local.conversation.agentSource.fixedAgentTitle'), description: t('settingsVoice.local.conversation.agentSource.fixedAgentSubtitle') },
          ]}
        />
        {cfg.agent.agentSource === 'agent' ? (
          <>
          <DropdownMenu
            open={openMenu === 'mediatorAgentId'}
            onOpenChange={(next) => setOpenMenu(next ? 'mediatorAgentId' : null)}
            variant="selectable"
            search={true}
            searchPlaceholder={t('settingsVoice.local.conversation.searchBackendsPlaceholder')}
            selectedId={selectedAgentIdForDropdown ?? ''}
            showCategoryTitles={false}
            matchTriggerWidth={true}
            connectToTrigger={true}
            rowKind="item"
            popoverBoundaryRef={props.popoverBoundaryRef}
            itemTrigger={{
              title: t('settingsVoice.local.mediatorAgentId'),
              subtitleFormatter: () => (agentIdMenuItems.find((it) => it.id === (selectedAgentIdForDropdown ?? ''))?.subtitle ?? t('settingsVoice.local.mediatorAgentIdSubtitle')),
              detailFormatter: () => selectedAgentIdLabel,
            }}
            items={agentIdMenuItems}
            onSelect={(id) => {
              if (id === '__custom__') {
                setOpenMenu(null);
                setCustomEntry('agentId');
                return;
              }

              const next = String(id ?? '').trim();
              if (!next) return;
              setAgent({ agentId: next });
              setOpenMenu(null);
            }}
          />
          {customEntry === 'agentId' ? (
            <FieldValueItem
              title={t('settingsVoice.local.mediatorAgentId')}
              subtitle={t('settingsVoice.local.mediatorAgentIdSubtitle')}
              fieldTestID="settings.voice.local.agentId.custom.field"
              monospace
              autoFocus
              value={String(cfg.agent.agentId ?? '')}
              onCommit={(draft) => {
                setCustomEntry(null);
                if (!draft) return String(cfg.agent.agentId ?? '');
                setAgent({ agentId: draft });
              }}
            />
          ) : null}
          </>
        ) : null}
          </>
        ) : null}
        <SegmentedChoiceItem
          title={t('settingsVoice.local.mediatorPermissionPolicy')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.mediatorPermissionPolicy"
          value={cfg.agent.permissionIntent}
          onChange={(next) => setAgent({ permissionIntent: next })}
          options={[
            { id: 'default', label: t('agentInput.permissionMode.default'), description: t('settingsActions.spawnPolicy.permissionCeiling.options.default.subtitle') },
            { id: 'read-only', label: t('agentInput.permissionMode.readOnly'), description: t('settingsActions.spawnPolicy.permissionCeiling.options.read-only.subtitle') },
            { id: 'safe-yolo', label: t('agentInput.permissionMode.safeYolo'), description: t('settingsActions.spawnPolicy.permissionCeiling.options.safe-yolo.subtitle') },
            { id: 'yolo', label: t('agentInput.permissionMode.yolo'), description: t('settingsActions.spawnPolicy.permissionCeiling.options.yolo.subtitle') },
          ]}
        />

        {!hasConfiguredProviderChat ? (
          <>
        <SegmentedChoiceItem
          title={t('settingsVoice.local.mediatorChatModelSource')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.mediatorChatModelSource"
          value={cfg.agent.chatModelSource}
          onChange={(next) => setAgent({ chatModelSource: next })}
          options={[
            { id: 'session', label: t('settingsVoice.local.mediatorChatModelSourceSession'), description: t('settingsVoice.local.conversation.chatModelSource.sessionSubtitle') },
            { id: 'custom', label: t('settingsVoice.local.mediatorChatModelSourceCustom'), description: t('settingsVoice.local.conversation.chatModelSource.customSubtitle') },
          ]}
        />
        {cfg.agent.chatModelSource === 'custom' ? (
          <>
          <DropdownMenu
            open={openMenu === 'mediatorChatModelId'}
            onOpenChange={(next) => setOpenMenu(next ? 'mediatorChatModelId' : null)}
            variant="selectable"
            search={true}
            searchPlaceholder={t('settingsVoice.local.conversation.searchModelsPlaceholder')}
            selectedId={String(cfg.agent.chatModelId ?? '').trim()}
            showCategoryTitles={false}
            matchTriggerWidth={true}
            connectToTrigger={true}
            rowKind="item"
              popoverBoundaryRef={props.popoverBoundaryRef}
              itemTrigger={{
                title: t('settingsVoice.local.conversation.chatModelId.title'),
                subtitleFormatter: () => (
                  modelIdMenuItems.find((it) => it.id === String(cfg.agent.chatModelId ?? '').trim())?.subtitle
                  ?? t('settingsVoice.local.conversation.chatModelId.subtitle')
                ),
                detailFormatter: () => (
                  modelIdMenuItems.find((it) => it.id === String(cfg.agent.chatModelId ?? '').trim())?.title
                  ?? String(cfg.agent.chatModelId)
                ),
              }}
            items={modelIdMenuItems}
            onSelect={(id) => {
              if (id === REFRESH_MODELS_DROPDOWN_ITEM_ID) {
                preflightModels.probe.onRefresh?.();
                setOpenMenu(null);
                return;
              }
              if (id === '__custom__') {
                setOpenMenu(null);
                setCustomEntry('chatModelId');
                return;
              }

              const next = String(id ?? '').trim();
              if (!next) return;
              setAgent({ chatModelId: next });
              setOpenMenu(null);
            }}
          />
          {customEntry === 'chatModelId' ? (
            <FieldValueItem
              title={t('settingsVoice.local.conversation.chatModelId.title')}
              subtitle={t('settingsVoice.local.conversation.chatModelId.subtitle')}
              fieldTestID="settings.voice.local.chatModelId.custom.field"
              monospace
              autoFocus
              value={String(cfg.agent.chatModelId ?? '')}
              onCommit={(draft) => {
                setCustomEntry(null);
                if (!draft) return String(cfg.agent.chatModelId ?? '');
                setAgent({ chatModelId: draft });
              }}
            />
          ) : null}
          </>
        ) : null}
        <SegmentedChoiceItem
          title={t('settingsVoice.local.mediatorCommitModelSource')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.mediatorCommitModelSource"
          value={cfg.agent.commitModelSource}
          onChange={(next) => setAgent({ commitModelSource: next })}
          options={[
            { id: 'chat', label: t('settingsVoice.local.mediatorCommitModelSourceChat'), description: t('settingsVoice.local.conversation.commitModelSource.chatSubtitle') },
            { id: 'session', label: t('settingsVoice.local.mediatorCommitModelSourceSession'), description: t('settingsVoice.local.conversation.commitModelSource.sessionSubtitle') },
            { id: 'custom', label: t('settingsVoice.local.mediatorCommitModelSourceCustom'), description: t('settingsVoice.local.conversation.commitModelSource.customSubtitle') },
          ]}
        />
        {cfg.agent.commitModelSource === 'custom' ? (
          <>
          <DropdownMenu
            open={openMenu === 'mediatorCommitModelId'}
            onOpenChange={(next) => setOpenMenu(next ? 'mediatorCommitModelId' : null)}
            variant="selectable"
            search={true}
            searchPlaceholder={t('settingsVoice.local.conversation.searchModelsPlaceholder')}
            selectedId={String(cfg.agent.commitModelId ?? '').trim()}
            showCategoryTitles={false}
            matchTriggerWidth={true}
            connectToTrigger={true}
            rowKind="item"
              popoverBoundaryRef={props.popoverBoundaryRef}
              itemTrigger={{
                title: t('settingsVoice.local.conversation.commitModelId.title'),
                subtitleFormatter: () => (
                  modelIdMenuItems.find((it) => it.id === String(cfg.agent.commitModelId ?? '').trim())?.subtitle
                  ?? t('settingsVoice.local.conversation.commitModelId.subtitle')
                ),
                detailFormatter: () => (
                  modelIdMenuItems.find((it) => it.id === String(cfg.agent.commitModelId ?? '').trim())?.title
                  ?? String(cfg.agent.commitModelId)
                ),
              }}
            items={modelIdMenuItems}
            onSelect={(id) => {
              if (id === REFRESH_MODELS_DROPDOWN_ITEM_ID) {
                preflightModels.probe.onRefresh?.();
                setOpenMenu(null);
                return;
              }
              if (id === '__custom__') {
                setOpenMenu(null);
                setCustomEntry('commitModelId');
                return;
              }

              const next = String(id ?? '').trim();
              if (!next) return;
              setAgent({ commitModelId: next });
              setOpenMenu(null);
            }}
          />
          {customEntry === 'commitModelId' ? (
            <FieldValueItem
              title={t('settingsVoice.local.conversation.commitModelId.title')}
              subtitle={t('settingsVoice.local.conversation.commitModelId.subtitle')}
              fieldTestID="settings.voice.local.commitModelId.custom.field"
              monospace
              autoFocus
              value={String(cfg.agent.commitModelId ?? '')}
              onCommit={(draft) => {
                setCustomEntry(null);
                if (!draft) return String(cfg.agent.commitModelId ?? '');
                setAgent({ commitModelId: draft });
              }}
            />
          ) : null}
          </>
        ) : null}
          </>
        ) : null}
        {voiceAgentEnabled ? (
          <Item
            title={t('settingsVoice.local.conversation.commitIsolation.title')}
            subtitle={t('settingsVoice.local.conversation.commitIsolation.subtitle')}
            rightElement={
              <Switch
                accessibilityLabel={t('settingsVoice.local.conversation.commitIsolation.title')}
                value={cfg.agent.commitIsolation === true}
                onValueChange={(v) => setAgent({ commitIsolation: v })}
              />
            }
            rightElementOutsidePressable
            onPress={() => {
              setAgent({ commitIsolation: cfg.agent.commitIsolation !== true });
            }}
            showChevron={false}
            selected={false}
          />
        ) : null}
        <FieldValueItem
          title={t('settingsVoice.local.mediatorIdleTtl')}
          subtitle={t('settingsVoice.local.mediatorIdleTtlDescription')}
          fieldTestID="settings.voice.local.idleTtlSeconds.field"
          kind="integer"
          value={String(cfg.agent.idleTtlSeconds)}
          onCommit={(draft) => {
            const next = Math.max(60, Math.min(21600, Math.floor(Number(draft))));
            setAgent({ idleTtlSeconds: next });
            return String(next);
          }}
        />
        <SegmentedChoiceItem
          title={t('settingsVoice.local.mediatorVerbosity')}
          subtitleLines={0}
          testIDPrefix="settings.voice.local.mediatorVerbosity"
          value={cfg.agent.verbosity}
          onChange={(next) => setAgent({ verbosity: next })}
          options={[
            { id: 'short', label: t('settingsVoice.local.mediatorVerbosityShort'), description: t('settingsVoice.local.conversation.verbosity.shortSubtitle') },
            { id: 'balanced', label: t('settingsVoice.local.mediatorVerbosityBalanced'), description: t('settingsVoice.local.conversation.verbosity.balancedSubtitle') },
          ]}
        />
      </ItemGroup>

      <ItemGroup title={t('settingsVoice.local.conversation.streaming.title')}>
        <Item
          title={t('settingsVoice.local.conversation.streaming.enableTitle')}
          subtitle={t('settingsVoice.local.conversation.streaming.enableSubtitle')}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.local.conversation.streaming.enableTitle')}
              value={cfg.streaming.enabled}
              onValueChange={(v) => setStreaming({ enabled: v })}
            />
          )}
        />
        <Item
          title={t('settingsVoice.local.conversation.streaming.enableTtsTitle')}
          subtitle={t('settingsVoice.local.conversation.streaming.enableTtsSubtitle')}
          rightElement={(
            <Switch
              accessibilityLabel={t('settingsVoice.local.conversation.streaming.enableTtsTitle')}
              value={cfg.streaming.ttsEnabled}
              onValueChange={(v) => setStreaming({ ttsEnabled: v })}
            />
          )}
        />
        <FieldValueItem
          title={t('settingsVoice.local.conversation.streaming.ttsChunkCharsTitle')}
          subtitle={t('settingsVoice.local.conversation.streaming.ttsChunkCharsPromptBody')}
          fieldTestID="settings.voice.local.streaming.ttsChunkChars.field"
          kind="integer"
          value={String(cfg.streaming.ttsChunkChars)}
          onCommit={(draft) => {
            const next = Math.max(32, Math.min(2000, Math.floor(Number(draft))));
            setStreaming({ ttsChunkChars: next });
            return String(next);
          }}
        />
      </ItemGroup>
        </>
      ) : null}

      <ItemGroup title={t('settingsVoice.local.conversation.network.title')}>
        <FieldValueItem
          title={t('settingsVoice.local.conversation.network.timeoutTitle')}
          subtitle={t('settingsVoice.local.conversation.network.timeoutPromptBody')}
          fieldTestID="settings.voice.local.networkTimeoutMs.field"
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
