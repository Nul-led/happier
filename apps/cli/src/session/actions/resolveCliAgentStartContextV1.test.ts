import { describe, expect, it } from 'vitest';
import { accountSettingsParse, admitAgentStartV1, buildBackendTargetKeyV2, BUILT_IN_ROLES_V1 } from '@happier-dev/protocol';
import { resolveCliAgentStartContextV1 } from './resolveCliAgentStartContextV1';

const backendTarget = { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' } as const;
const input = {
  sessionId: 'lead', machineId: 'machine', directory: '/repo', backendTarget,
  metadata: {}, starterDepth: 3, turnDepth: 0, callerPermissionMode: 'read-only', settings: accountSettingsParse({}),
} as const;

describe('host agent-start snapshots', () => {
  it('reads allow-lists from their separate Account setting on each fresh host snapshot', () => {
    const settings = accountSettingsParse({ sessionAgentStartAllowListsV1: { allowedAgentTargetKeys: [] } });
    const context = resolveCliAgentStartContextV1({ ...input, settings });
    if (!context) throw new Error('host snapshot unavailable');
    expect(admitAgentStartV1(settings.sessionAgentSpawnPolicyV1, {
      kind: 'spawn_new', facts: {},
    }, context)).toMatchObject({ ok: false, refusal: { code: 'policy_denied_field', field: 'agentTarget' } });
  });
  it('resolves newly read user/plugin source fields and current overrides instead of a stale dispatch projection', () => {
    const context = resolveCliAgentStartContextV1({ ...input,
      settingsRoles: { 'user-role': { ...BUILT_IN_ROLES_V1.builder, instructions: 'Current Artifact instructions' } },
      metadata: { work: { sessionRolesV1: { overrides: { 'user-role': { roleId: 'user-role', workspaceWrites: 'deny' } }, sessionRoles: {}, notes: '' } } },
    });
    expect(context?.roles['user-role']).toMatchObject({ instructions: 'Current Artifact instructions', workspaceWrites: 'deny',
      engine: { agentTargetKey: buildBackendTargetKeyV2(backendTarget) } });
  });
  it('uses background Run depth over the hosting Session and refuses the next start at the limit', () => {
    const context = resolveCliAgentStartContextV1({ ...input, starterDepth: 0,
      runCaller: { hostSessionId: 'lead', callingRunId: 'background-run', callingRunDepth: 4 },
    });
    expect(context?.caller).toEqual({ kind: 'session', sessionId: 'lead', starterDepth: 4, turnDepth: 0 });
    if (!context) throw new Error('run caller unavailable');
    expect(admitAgentStartV1(input.settings.sessionAgentSpawnPolicyV1, {
      kind: 'spawn_new', facts: {},
    }, context)).toMatchObject({ ok: false, refusal: { code: 'work_depth_exceeded' } });
  });

  it('keeps a detached Workflow step originless at its host-stamped step depth', () => {
    const context = resolveCliAgentStartContextV1({ ...input, starterDepth: undefined,
      runCaller: { runId: 'workflow-run', runDepth: 3 },
    });
    expect(context?.caller).toEqual({ kind: 'originless', runId: 'workflow-run', runDepth: 3 });
    expect(context?.baseline).toEqual({ machineId: 'machine', directory: '/repo' });
    if (!context) throw new Error('workflow caller unavailable');
    expect(admitAgentStartV1(input.settings.sessionAgentSpawnPolicyV1, {
      kind: 'execution_run', source: 'execution_run', intent: 'review', facts: {}, backendTargets: [backendTarget],
    }, context)).toMatchObject({ ok: true, stamped: { workDepth: 4 } });
  });

  it('cannot borrow a different host Session or reset malformed Run depth', () => {
    expect(resolveCliAgentStartContextV1({ ...input,
      runCaller: { hostSessionId: 'other', callingRunId: 'run', callingRunDepth: 1 },
    })).toBeNull();
    expect(resolveCliAgentStartContextV1({ ...input,
      runCaller: { runId: 'workflow-run', runDepth: -1 },
    })).toBeNull();
  });
  it('resolves the Second opinion default from the enabled host inventory before admission', () => {
    const other = buildBackendTargetKeyV2({ kind: 'backend', backendId: 'claude' });
    const context = resolveCliAgentStartContextV1({ ...input,
      availableAgentTargetKeys: [buildBackendTargetKeyV2(backendTarget), other],
    });
    expect(context?.roles.second_opinion.engine).toEqual({ agentTargetKey: other });
  });
  it('cannot reset a missing persisted starter depth to zero', () => {
    expect(resolveCliAgentStartContextV1({ ...input, starterDepth: undefined })).toBeNull();
    expect(resolveCliAgentStartContextV1({ ...input, starterDepth: -1 })).toBeNull();
  });
  it('uses the Account limit and existing role/model owners, preserving inherited choices', () => {
    const selection = { agentTargetKey: buildBackendTargetKeyV2(backendTarget), providerConnectionId: null, modelId: 'model' };
    const context = resolveCliAgentStartContextV1({ ...input, turnDepth: 4, metadata: {
      modelSelectionIntentV1: { v: 1, selection, updatedAt: 10 },
    } });
    expect(context?.baseline.configuration?.modelSelection).toEqual(selection);
    expect(context?.roles.reviewer.engine).toMatchObject({ modelId: 'model' });
    expect(context).not.toBeNull();
    if (!context) throw new Error('host snapshot unavailable');
    expect(admitAgentStartV1(input.settings.sessionAgentSpawnPolicyV1, {
      kind: 'execution_run', source: 'review', intent: 'review', facts: {}, backendTargets: [backendTarget],
    }, context)).toMatchObject({ ok: false, refusal: { code: 'work_depth_exceeded' } });
  });
});
