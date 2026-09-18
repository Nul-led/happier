import type { FeaturesPayloadDelta } from '../types';

import { resolveAutomationsFeature } from '../automationsFeature';
import { resolveWorkflowsFeature } from '../workflowsFeature';
import { resolveBugReportsFeature } from '../bugReportsFeature';
import { resolveSharingFeature } from '../sharingFeature';
import { resolveVoiceFeature } from '../voiceFeature';
import { resolveFriendsFeature } from '../friendsFeature';
import { resolveOAuthFeature } from '../oauthFeature';
import { resolveAuthFeature } from '../authFeature';
import { resolveConnectedServicesFeature } from '../connectedServicesFeature';
import { resolveUpdatesFeature } from '../updatesFeature';
import { resolveAttachmentsUploadsFeature } from '../attachmentsUploadsFeature';
import { resolvePetsFeature } from '../petsFeature';
import { resolveMachineTransferFeature } from '../machineTransferFeature';
import { resolveMachineTunnelFeature } from '../machineTunnelFeature';
import { resolvePeerMediationFeature } from '../peerMediationFeature';
import { resolveMachineLiveStreamFeature } from '../machineLiveStreamFeature';
import { resolveMachineRpcFeature } from '../machineRpcFeature';
import { resolveMachinePoolsFeature } from '../machinePoolsFeature';
import { resolveLocalServicesFeature } from '../localServicesFeature';
import { resolveProvidersFeature } from '../providersFeature';
import { resolveSearchFeature } from '../searchFeature';
import { resolveTeamsFeature } from '../teamsFeature';
import { resolveBrowserFeature } from '../browserFeature';
import { resolvePluginsFeature } from '../pluginsFeature';
import { resolveDevicesFeature } from '../devicesFeature';
import { resolveSessionFoldersFeature } from '../sessionFoldersFeature';
import { resolveSessionDraftsFeature } from '../sessionDraftsFeature';
import { resolveSessionBoardFeature } from '../sessionBoardFeature';
import { resolveSessionFollowingFeature } from '../sessionFollowingFeature';
import { resolveSessionCollaborationFeature } from '../sessionCollaborationFeature';
import { resolveSessionFilteredListingFeature } from '../sessionFilteredListingFeature';
import { resolveSessionEphemeralRunnerFeature } from '../sessionEphemeralRunnerFeature';
import { resolveSessionAgentSwitchingFeature } from '../sessionAgentSwitchingFeature';
import { resolveSessionHandoffFeature } from '../sessionHandoffFeature';
import { resolveSessionUsageLimitRecoveryFeature } from '../sessionUsageLimitRecoveryFeature';
import { resolveTerminalFeature } from '../terminalFeature';
import { resolveEncryptionFeature } from '../encryptionFeature';
import { resolveE2eeFeature } from '../e2eeFeature';
import { resolveServerUrlCapabilitiesFeature } from '../serverUrlCapabilitiesFeature';
import { resolveServerRetentionCapabilitiesFeature } from '../serverRetentionCapabilitiesFeature';
import { resolveServerUsageAnalyticsCapabilitiesFeature } from '../serverUsageAnalyticsCapabilitiesFeature';
import { resolveLiveActivityRemoteUpdatesFeature } from '../liveActivityRemoteUpdatesFeature';
import { resolveSessionProtocolCapabilitiesFeature } from '../sessionProtocolCapabilitiesFeature';
import { resolveAccountStoredContentCompatibilityFeature } from '../accountStoredContentCompatibilityFeature';
import { resolveAccountDirectoryFeature } from '../accountDirectoryFeature';
import { resolveSessionConversationsFeature } from '../sessionConversationsFeature';

export type ServerFeatureResolver = (env: NodeJS.ProcessEnv) => FeaturesPayloadDelta;

export const serverFeatureRegistry = Object.freeze([
    () => resolveAccountStoredContentCompatibilityFeature(),
    (env) => resolveAccountDirectoryFeature(env),
    () => resolveSessionProtocolCapabilitiesFeature(),
    (env) => resolveServerUrlCapabilitiesFeature(env),
    (env) => resolveServerRetentionCapabilitiesFeature(env),
    () => resolveServerUsageAnalyticsCapabilitiesFeature(),
    (env) => resolveLiveActivityRemoteUpdatesFeature(env),
    (env) => resolveBugReportsFeature(env),
    (env) => resolveAutomationsFeature(env),
    (env) => resolveWorkflowsFeature(env),
    (_env) => resolveSharingFeature(),
    (env) => resolveVoiceFeature(env),
    (env) => resolveConnectedServicesFeature(env),
    (env) => resolveUpdatesFeature(env),
    (env) => resolveAttachmentsUploadsFeature(env),
    (env) => resolvePetsFeature(env),
    (env) => resolveMachineTransferFeature(env),
    (env) => resolveMachineTunnelFeature(env),
    (env) => resolvePeerMediationFeature(env),
    (env) => resolveLocalServicesFeature(env),
    (env) => resolveProvidersFeature(env),
    (env) => resolveSearchFeature(env),
    (env) => resolveTeamsFeature(env),
    (env) => resolveBrowserFeature(env),
    (env) => resolvePluginsFeature(env),
    (env) => resolveDevicesFeature(env),
    (env) => resolveMachineLiveStreamFeature(env),
    (env) => resolveMachineRpcFeature(env),
    (env) => resolveMachinePoolsFeature(env),
    (env) => resolveSessionFoldersFeature(env),
    (env) => resolveSessionDraftsFeature(env),
    (env) => resolveSessionBoardFeature(env),
    (env) => resolveSessionFollowingFeature(env),
    (env) => resolveSessionCollaborationFeature(env),
    (env) => resolveSessionConversationsFeature(env),
    (env) => resolveSessionFilteredListingFeature(env),
    (env) => resolveSessionEphemeralRunnerFeature(env),
    (env) => resolveSessionAgentSwitchingFeature(env),
    (env) => resolveSessionHandoffFeature(env),
    (env) => resolveSessionUsageLimitRecoveryFeature(env),
    (env) => resolveTerminalFeature(env),
    (env) => resolveFriendsFeature(env),
    (env) => resolveOAuthFeature(env),
    (env) => resolveAuthFeature(env),
    (env) => resolveEncryptionFeature(env),
    (env) => resolveE2eeFeature(env),
] satisfies readonly ServerFeatureResolver[]);
