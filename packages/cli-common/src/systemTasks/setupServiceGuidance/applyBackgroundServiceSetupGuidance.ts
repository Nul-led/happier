import type { BackgroundServiceSetupGuidance } from './buildBackgroundServiceSetupGuidance.js';

export type BackgroundServiceSetupGuidanceCancellationReason =
  | 'declined_manual_relay_takeover'
  | 'declined_service_replacement';

export type BackgroundServiceSetupGuidanceFlowResult = Readonly<{
  cancelled: boolean;
  cancellationReason: BackgroundServiceSetupGuidanceCancellationReason | null;
  switchedDefaultReleaseChannel: boolean;
  tookOverManualRelayRuntime: boolean;
  replacedExistingServices: boolean;
}>;

export type BackgroundServiceSetupGuidanceDecision = Readonly<{
  cancelled: boolean;
  cancellationReason: BackgroundServiceSetupGuidanceCancellationReason | null;
  shouldSwitchDefaultReleaseChannel: boolean;
  shouldTakeOverManualRelayRuntime: boolean;
  shouldReplaceExistingServices: boolean;
}>;

type BackgroundServiceSetupGuidancePromptParams = Readonly<{
  guidance: BackgroundServiceSetupGuidance;
  promptSwitchDefaultReleaseChannel: () => Promise<boolean>;
  promptTakeOverManualRelayRuntime: () => Promise<boolean>;
  promptReplaceExistingServices: () => Promise<boolean>;
}>;

export async function resolveBackgroundServiceSetupGuidance(
  params: BackgroundServiceSetupGuidancePromptParams,
): Promise<BackgroundServiceSetupGuidanceDecision> {
  const shouldSwitchDefaultReleaseChannel = params.guidance.shouldOfferDefaultReleaseChannelSwitch
    ? await params.promptSwitchDefaultReleaseChannel()
    : false;

  const shouldTakeOverManualRelayRuntime = params.guidance.shouldPromptForManualRelayTakeover
    ? await params.promptTakeOverManualRelayRuntime()
    : false;

  if (params.guidance.shouldPromptForManualRelayTakeover && !shouldTakeOverManualRelayRuntime) {
    return {
      cancelled: true,
      cancellationReason: 'declined_manual_relay_takeover',
      shouldSwitchDefaultReleaseChannel: false,
      shouldTakeOverManualRelayRuntime: false,
      shouldReplaceExistingServices: false,
    };
  }

  const shouldReplaceExistingServices = params.guidance.shouldPromptForServiceReplacement
    ? await params.promptReplaceExistingServices()
    : false;

  if (params.guidance.shouldPromptForServiceReplacement && !shouldReplaceExistingServices) {
    return {
      cancelled: true,
      cancellationReason: 'declined_service_replacement',
      shouldSwitchDefaultReleaseChannel: false,
      shouldTakeOverManualRelayRuntime: false,
      shouldReplaceExistingServices: false,
    };
  }

  return {
    cancelled: false,
    cancellationReason: null,
    shouldSwitchDefaultReleaseChannel,
    shouldTakeOverManualRelayRuntime,
    shouldReplaceExistingServices,
  };
}

export async function applyBackgroundServiceSetupGuidance(params: BackgroundServiceSetupGuidancePromptParams & Readonly<{
  switchDefaultReleaseChannel: () => Promise<void>;
  takeOverManualRelayRuntime: () => Promise<void>;
  replaceExistingServices: () => Promise<void>;
}>): Promise<BackgroundServiceSetupGuidanceFlowResult> {
  const decision = await resolveBackgroundServiceSetupGuidance(params);
  if (decision.cancelled) {
    return {
      cancelled: true,
      cancellationReason: decision.cancellationReason,
      switchedDefaultReleaseChannel: false,
      tookOverManualRelayRuntime: false,
      replacedExistingServices: false,
    };
  }

  let switchedDefaultReleaseChannel = false;
  if (decision.shouldSwitchDefaultReleaseChannel) {
    await params.switchDefaultReleaseChannel();
    switchedDefaultReleaseChannel = true;
  }

  let tookOverManualRelayRuntime = false;
  if (decision.shouldTakeOverManualRelayRuntime) {
    await params.takeOverManualRelayRuntime();
    tookOverManualRelayRuntime = true;
  }

  let replacedExistingServices = false;
  if (decision.shouldReplaceExistingServices) {
    await params.replaceExistingServices();
    replacedExistingServices = true;
  }

  return {
    cancelled: false,
    cancellationReason: null,
    switchedDefaultReleaseChannel,
    tookOverManualRelayRuntime,
    replacedExistingServices,
  };
}
