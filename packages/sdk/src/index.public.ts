export { isHappierActionApprovalRequestCreated } from './approval.js';
export type { HappierSessionController, HappierSessionLiveOptions, HappierSessionSnapshot } from './live/types.js';
export type {
  HappierSessionExecutionRun,
  HappierSessionExecutionRuns,
  HappierSessionExecutionRunSendInput,
  HappierSessionExecutionRunHistoryInput,
  HappierSessionExecutionRunWaitInput,
} from './fluent/sessionExecutionRuns.js';
export {
  connect,
  type HappierActions,
  type HappierApiTokens,
  type HappierClient,
  type HappierMachineActionExecute,
  type HappierMachineActionExecutionOptions,
  type HappierMachineActions,
  type HappierMachineClient,
  type HappierMachineExecutionRuns,
  type HappierExecutionRuns,
} from './connect.js';
export {
  HappierActionError,
  HappierClientClosedError,
  HappierTransportError,
} from './errors.js';
export type {
  FollowTranscriptOptions,
  HappierExecutionRunStream,
  HappierExecutionRunStreamEvent,
  HappierTranscriptItem,
} from './subscriptions.js';
export type { HappierMachine, MachineListOptions } from './machines.js';
export type {
  HappierEmbed,
  HappierEmbedActionOptions,
  HappierEmbedOptions,
  HappierEmbedCreateSessionInput,
  HappierEmbedListSessionsInput,
  HappierEmbedCreateCredentialInput,
  HappierEmbedCredential,
} from './fluent/embed.js';
export {
  HappierAgentUnavailableError,
  HappierSessionInitialInputError,
  HappierSessionSpawnError,
  type HappierAgentUnavailableReason,
  type HappierMachineSessions,
  type HappierSession,
  type HappierSessionListInput,
  type HappierSessionSendAndWaitInput,
  type HappierSessionSpawnInput,
  type HappierSessionSpawnOptions,
  type HappierSessions,
} from './fluent/sessions.js';
export type {
  PublicActionId,
  PublicActionInputById,
  PublicActionResultById,
} from './actions/generated.js';
export type {
  ActionExecute,
  ActionExecutionOptions,
  ActionTarget,
  ContributedActionId,
  HappierConnectOptions,
  PublicActionExecutionResult,
  RawActionExecute,
} from './types.js';
