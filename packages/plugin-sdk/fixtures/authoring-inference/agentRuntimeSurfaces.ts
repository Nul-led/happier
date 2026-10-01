import type {
  AttachSurface,
  CheckpointSurface,
  AgentSessionRuntimeContext,
  AgentSessionModesSource,
} from '@happier-dev/plugin-sdk/agents/runtime';

// Authors supply native facts through the session-owned service, not owner metadata writes.
export function bindNativeModes(context: AgentSessionRuntimeContext, source: AgentSessionModesSource) {
  return context.session.services.modes.bind(source);
}

type AttachResult = Awaited<ReturnType<AttachSurface['attach']>>;
type CheckpointRestore = NonNullable<CheckpointSurface['restore']>;
type CheckpointRestoreResult = Awaited<ReturnType<CheckpointRestore>>;

const runtimeDescriptor = {
  v: 1 as const,
  agentId: 'example.inference',
  agent: Object.freeze({ providerSessionId: 'provider-session-1' }),
};

const attachIdentityResult: AttachResult = {
  ok: true,
  value: { exitCode: 0 },
  receipt: {
    sessionStateUpdates: [
      { fieldId: 'identity.runtimeDescriptor', value: runtimeDescriptor },
      { fieldId: 'identity.providerSessionId', value: 'provider-session-1' },
    ],
  },
};

const checkpointIdentityResult: CheckpointRestoreResult = {
  ok: true,
  outcome: 'completed',
  restoredScopes: ['conversation'],
  receipt: {
    sessionStateUpdates: [
      { fieldId: 'identity.runtimeDescriptor', value: runtimeDescriptor },
      { fieldId: 'identity.providerSessionId', value: 'provider-session-1' },
    ],
  },
};

const attachPrivateStateResult: AttachResult = {
  ok: true,
  value: { exitCode: 0 },
  receipt: {
    sessionStateUpdates: [{
      // @ts-expect-error Agent Attach authors cannot write owner-private Session state.
      fieldId: 'runtime.externalSessionOperation',
      value: 'private-operation',
    }],
  },
};

const checkpointPrivateStateResult: CheckpointRestoreResult = {
  ok: false,
  code: 'restore_failed',
  receipt: {
    sessionStateUpdates: [{
      // @ts-expect-error Agent Checkpoint authors cannot write owner-private Session state.
      fieldId: 'runtime.externalSessionOperation',
      value: 'private-operation',
    }],
  },
};

void attachIdentityResult;
void checkpointIdentityResult;
void attachPrivateStateResult;
void checkpointPrivateStateResult;
