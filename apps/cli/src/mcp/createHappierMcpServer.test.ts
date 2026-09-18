import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = process.env;

const getTestServerBinding = () => ({
  serverId: 'test-home',
  serverUrl: 'https://test-home.example.test',
} as const);

describe('createHappierMcpServer', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
    delete process.env.HAPPIER_ACTIONS_SETTINGS_V1;
  });

  afterEach(() => {
    vi.doUnmock('@modelcontextprotocol/sdk/server/mcp.js');
    vi.doUnmock('@happier-dev/protocol');
    vi.doUnmock('@/session/actions/createCliActionExecutorHarness');
    vi.doUnmock('@/mcp/server/registerHappierMcpBuiltInTools');
    vi.doUnmock('@/agent/tools/happierTools/dispatchBuiltInHappierTool');
    vi.doUnmock('@/session/discussions/sessionDiscussionActionDeps');
    vi.doUnmock('@/api/accountServerActionDeps');
    vi.doUnmock('@/api/sessionFollowActionDeps');
  });

  it('wires Account-server, Pool, Follow, and Discussion owners into the authenticated in-session Agent host', async () => {
    const captured: { params?: Record<string, unknown>; overrides?: Record<string, unknown> } = {};
    const accountInputs: Array<Record<string, unknown>> = [];
    const followInputs: Array<Record<string, unknown>> = [];
    const discussionInputs: Array<Record<string, unknown>> = [];
    const machinePoolAction = vi.fn();
    const homeDomainAction = vi.fn();
    const sessionFollowGet = vi.fn();
    const sessionDiscussionAction = vi.fn();
    const resolveServerFeaturesSnapshot = vi.fn(() => ({
      status: 'ready' as const,
      provenance: 'authenticated' as const,
      features: {
        features: {},
        capabilities: { serverIdentity: { serverIdentityId: 'stable-home-identity' } },
      },
    }));

    vi.doMock('@/api/accountServerActionDeps', () => ({
      createAccountServerActionDeps: (input: Record<string, unknown>) => {
        accountInputs.push(input);
        return { machinePoolAction, homeDomainAction };
      },
    }));
    vi.doMock('@/api/sessionFollowActionDeps', () => ({
      createSessionFollowActionDeps: (input: Record<string, unknown>) => {
        followInputs.push(input);
        return { sessionFollowGet };
      },
    }));
    vi.doMock('@/session/discussions/sessionDiscussionActionDeps', () => ({
      createSessionDiscussionActionDeps: (input: Record<string, unknown>) => {
        discussionInputs.push(input);
        return { sessionDiscussionAction };
      },
    }));
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (params: Record<string, unknown>, overrides: Record<string, unknown>) => {
        captured.params = params;
        captured.overrides = overrides;
        return { executor: { execute: vi.fn(async () => ({ ok: true, result: { ok: true } })) } };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    const credentials = { token: 'agent-account-token', encryption: null } as const;
    createHappierMcpServer({
      sessionId: 'sess_account_actions_1',
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getServerBinding: () => ({
        serverId: 'session-home-b',
        serverUrl: 'https://session-home-b.example.test',
      }),
      getServerFeaturesSnapshot: resolveServerFeaturesSnapshot,
    } as any, { credentials });

    expect(accountInputs).toHaveLength(1);
    expect(followInputs).toHaveLength(1);
    expect(accountInputs[0]).toMatchObject({ token: credentials.token, credentials });
    expect(accountInputs[0]).toMatchObject({
      serverId: 'session-home-b',
      serverHttpBaseUrl: 'https://session-home-b.example.test',
    });
    expect((accountInputs[0]?.resolveServerFeaturesSnapshot as (() => unknown))()).toEqual(
      resolveServerFeaturesSnapshot.mock.results[0]?.value,
    );
    expect(resolveServerFeaturesSnapshot).toHaveBeenCalledTimes(2);
    expect(followInputs[0]).toMatchObject({
      token: credentials.token,
      prepareSourceKeyAfterSet: expect.any(Function),
    });
    expect(accountInputs[0]?.serverId).toEqual(followInputs[0]?.serverId);
    expect(accountInputs[0]?.serverHttpBaseUrl).toEqual(followInputs[0]?.serverHttpBaseUrl);
    expect(captured.params).toMatchObject({ serverIdentityId: 'stable-home-identity' });
    expect(captured.params?.resolveServerFeaturesSnapshot).toBeTypeOf('function');
    expect(accountInputs[0]).toMatchObject({ serverIdentityId: 'stable-home-identity' });
    expect(followInputs[0]).toMatchObject({ serverIdentityId: 'stable-home-identity' });
    expect(discussionInputs[0]).toMatchObject({
      credentials,
      serverIdentityId: 'stable-home-identity',
    });
    expect(captured.overrides).toMatchObject({
      machinePoolAction,
      homeDomainAction,
      sessionFollowGet,
      sessionDiscussionAction,
    });
  });

  it('keeps restricted runtime credentials Session-scoped and omits Account-wide Action owners', async () => {
    const captured: { params?: Record<string, unknown>; overrides?: Record<string, unknown>; enabled?: (id: string) => boolean } = {};
    const accountOwner = vi.fn(() => ({}));
    const followOwner = vi.fn(() => ({}));
    const discussionOwner = vi.fn(() => ({}));
    const sessionList = vi.fn();
    vi.doMock('@/api/accountServerActionDeps', () => ({ createAccountServerActionDeps: accountOwner }));
    vi.doMock('@/api/sessionFollowActionDeps', () => ({ createSessionFollowActionDeps: followOwner }));
    vi.doMock('@/session/discussions/sessionDiscussionActionDeps', () => ({ createSessionDiscussionActionDeps: discussionOwner }));
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (params: Record<string, unknown>, overrides: Record<string, unknown>) => {
        captured.params = params;
        captured.overrides = overrides;
        return { executor: { execute: vi.fn(async () => ({ ok: true, result: {} })) } };
      },
    }));
    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', () => ({
      registerHappierMcpBuiltInTools: (_server: unknown, params: { deps: { isActionEnabled: (id: string) => boolean } }) => {
        captured.enabled = params.deps.isActionEnabled;
        return { toolNames: [] };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    const sessionCredentials = { token: 'restricted-session-token', encryption: null } as const;
    createHappierMcpServer({
      sessionId: 'restricted-session',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any, {
      sessionCredentials,
      credentials: null,
      authorityScope: 'session',
      sessionList,
    });

    expect(accountOwner).not.toHaveBeenCalled();
    expect(followOwner).not.toHaveBeenCalled();
    expect(discussionOwner).not.toHaveBeenCalled();
    expect(captured.params).toMatchObject({ token: sessionCredentials.token });
    expect(captured.params).not.toHaveProperty('credentials');
    expect(captured.overrides?.sessionList).toBe(sessionList);
    expect(captured.enabled?.('session.title.set')).toBe(true);
    expect(captured.enabled?.('account.apiTokens.list')).toBe(false);
    expect(captured.enabled?.('machines.list')).toBe(false);
  });

  it('returns toolNames aligned with current MCP action settings', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'review.start': { enabled: true, disabledSurfaces: ['agent'], disabledPlacements: [] },
      },
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any;

    const { toolNames } = createHappierMcpServer(fakeClient);
    expect(toolNames).not.toContain('review_start');
    expect(toolNames).not.toContain('subagents_plan_start');
    expect(toolNames).toContain('action_spec_search');
  });

  it('advertises server-backed Session Actions only when the exact Home enables them and the runtime is authenticated', async () => {
    const capturedEnablement: Array<(id: string) => boolean> = [];

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', () => ({
      registerHappierMcpBuiltInTools: (_server: unknown, params: { deps: { isActionEnabled: (id: string) => boolean } }) => {
        capturedEnablement.push(params.deps.isActionEnabled);
        return { toolNames: [] };
      },
    }));

    const { FeaturesResponseSchema } = await import('@happier-dev/protocol');
    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    const credentials = { token: 'agent-account-token', encryption: null } as const;
    const createClient = (boardEnabled: boolean, conversationsEnabled: boolean) => ({
      sessionId: `sess_server_backed_action_availability_${boardEnabled}_${conversationsEnabled}`,
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getServerFeaturesSnapshot: () => ({
        status: 'ready' as const,
        provenance: 'authenticated' as const,
        features: FeaturesResponseSchema.parse({
          features: {
            sessions: {
              enabled: true,
              board: { enabled: boardEnabled },
              conversations: { enabled: conversationsEnabled },
            },
          },
          capabilities: {},
        }),
      }),
    });

    createHappierMcpServer(createClient(false, false) as any, { credentials });
    createHappierMcpServer(createClient(true, true) as any, { credentials });
    createHappierMcpServer(createClient(true, true) as any, { credentials: null });

    expect(capturedEnablement).toHaveLength(3);
    expect(capturedEnablement[0]?.('session.board.get')).toBe(false);
    expect(capturedEnablement[1]?.('session.board.get')).toBe(true);
    expect(capturedEnablement[2]?.('session.board.get')).toBe(false);
    expect(capturedEnablement[0]?.('session.discussion.list')).toBe(false);
    expect(capturedEnablement[1]?.('session.discussion.list')).toBe(true);
    expect(capturedEnablement[2]?.('session.discussion.list')).toBe(false);
    expect(capturedEnablement[0]?.('session.list')).toBe(true);
  });

  it('uses account action settings for the in-session MCP tool registry when provided', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'session.list': { enabled: true, disabledSurfaces: ['agent'], disabledPlacements: [] },
      },
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_tool_names_account_settings_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any;

    const { toolNames } = createHappierMcpServer(fakeClient, {
      accountSettings: {
        actionsSettingsV1: {
          v: 1,
          actions: {
            'session.list': {
              disabledSurfaces: [],
              toolExposureModes: {
                agent: 'direct',
              },
            },
          },
        },
      },
    } as any);

    expect(toolNames).toContain('session_list');
  });

  it('reads current account action settings when registered session-agent MCP tools run', async () => {
    const handlers: Record<string, (args: any) => Promise<any>> = {};

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: class FakeMcpServer {
        registerResource() {}
        registerTool(name: string, _meta: any, handler: any) {
          handlers[name] = handler;
        }
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    let currentAccountSettings: any = {
      actionsSettingsV1: {
        v: 1,
        actions: {
          'review.start': {
            disabledSurfaces: ['agent'],
          },
        },
      },
    };

    createHappierMcpServer({
      sessionId: 'sess_mcp_live_settings_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any, {
      getAccountSettings: () => currentAccountSettings,
    } as any);

    const handler = handlers.action_spec_get;
    expect(typeof handler).toBe('function');

    const disabledResult = await handler({ id: 'review.start' });
    expect(disabledResult.isError).toBe(true);
    expect(JSON.parse(disabledResult.content[0].text)).toMatchObject({
      errorCode: 'action_disabled',
      details: {
        actionId: 'review.start',
        surface: 'agent',
        reason: 'disabled_by_settings',
      },
    });

    currentAccountSettings = {
      actionsSettingsV1: {
        v: 1,
        actions: {},
      },
    };

    const enabledResult = await handler({ id: 'review.start' });
    expect(enabledResult.isError).toBe(false);
    expect(JSON.parse(enabledResult.content[0].text)).toMatchObject({
      actionSpec: {
        id: 'review.start',
      },
    });

    const planResult = await handler({ id: 'subagents.plan.start' });
    expect(planResult.isError).toBe(false);
    expect(JSON.parse(planResult.content[0].text)).toMatchObject({
      actionSpec: {
        kindVersion: 1,
        inputSchema: {
          type: 'object',
          properties: {
            backendTargetKeys: {
              type: 'array',
              minItems: 1,
              items: {
                anyOf: expect.arrayContaining([
                  expect.objectContaining({
                    type: 'string',
                    pattern: '^(agent|acpBackend):.+$',
                  }),
                ]),
              },
            },
            permissionMode: {
              description: expect.any(String),
            },
          },
        },
      },
    });

    const spawnResult = await handler({ id: 'session.spawn_new' });
    expect(spawnResult.isError).toBe(false);
    expect(JSON.parse(spawnResult.content[0].text)).toMatchObject({
      actionSpec: {
        inputSchema: {
          properties: {
            executionTarget: {
              properties: {
                serverId: { minLength: 1, maxLength: 191 },
              },
            },
            organizationPlacement: {
              properties: {
                tagIds: { type: 'array', maxItems: 500 },
              },
            },
          },
        },
      },
    });
  });

  it('uses account action settings for in-session MCP approval policy when provided', async () => {
    process.env.HAPPIER_ACTIONS_SETTINGS_V1 = JSON.stringify({
      v: 1,
      actions: {
        'session.list': { disabledSurfaces: [] },
      },
    });
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_approval_policy_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any, {
      accountSettings: {
        actionsSettingsV1: {
          v: 1,
          actions: {
            'session.list': {
              disabledSurfaces: [],
              approvalRequiredSurfaces: ['agent'],
            },
          },
        },
      },
    } as any);

    expect(captured.deps).toBeDefined();
    expect(captured.deps.isActionApprovalRequired('session.list', { surface: 'agent' })).toBe(true);
  });

  it('reads current session-agent spawn policy when action-backed tools execute', async () => {
    const executorExecute = vi.fn(async (actionId: string, input: unknown, ctx: unknown) => ({
      ok: true,
      result: { actionId, input, ctx },
    }));
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: () => ({
        executor: {
          execute: executorExecute,
        },
      }),
    }));

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const firstPolicy = { allowedBackendTargetKeys: ['agent:codex'] };
    const secondPolicy = { allowedBackendTargetKeys: ['agent:claude'] };
    let currentAccountSettings: any = {
      sessionAgentSpawnPolicyV1: firstPolicy,
    };

    createHappierMcpServer({
      sessionId: 'sess_mcp_live_spawn_policy_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any, {
      getAccountSettings: () => currentAccountSettings,
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executeActionByToolName('action_execute', {
      actionId: 'session.spawn_new',
      input: { prompt: 'Spawn a helper' },
    }, 'sess_mcp_live_spawn_policy_1');
    expect(executorExecute).toHaveBeenLastCalledWith(
      'session.spawn_new',
      { prompt: 'Spawn a helper' },
      expect.objectContaining({
        sessionAgentSpawnPolicyV1: firstPolicy,
      }),
    );

    currentAccountSettings = {
      sessionAgentSpawnPolicyV1: secondPolicy,
    };

    await captured.deps.executeActionByToolName('action_execute', {
      actionId: 'session.spawn_new',
      input: { prompt: 'Spawn another helper' },
    }, 'sess_mcp_live_spawn_policy_1');
    expect(executorExecute).toHaveBeenLastCalledWith(
      'session.spawn_new',
      { prompt: 'Spawn another helper' },
      expect.objectContaining({
        sessionAgentSpawnPolicyV1: secondPolicy,
      }),
    );
  });

  it('executes native Agent tool calls through the live Session authority and policy owner', async () => {
    const executorExecute = vi.fn(async (actionId: string, input: unknown, ctx: unknown) => ({
      ok: true,
      result: { actionId, input, ctx },
    }));

    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: () => ({
        executor: {
          execute: executorExecute,
        },
      }),
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    const causalPermissionAuthority = {
      kind: 'admittedSessionInputV1',
      admittedPermissionCeiling: 'read_only',
    } as const;
    const spawnPolicy = { allowedBackendTargetKeys: ['agent:codex'] };
    const runtime = createHappierMcpServer({
      sessionId: 'sess_native_agent_tool_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getPermissionMode: () => 'yolo',
      getActiveTurnPermissionWitness: () => ({
        turnId: 'turn_native_agent_tool_1',
        causalPermissionAuthority,
      }),
    } as any, {
      accountSettings: {
        sessionAgentSpawnPolicyV1: spawnPolicy,
      },
      requiredDirectActionIds: ['session.transcript.get'],
      sessionInputVia: 'action',
    } as any);

    await runtime.executeTool({
      toolName: 'action_execute',
      args: {
        actionId: 'session.spawn_new',
        input: { prompt: 'Spawn a helper' },
      },
      toolCallId: 'native_tool_call_1',
    });

    expect(executorExecute).toHaveBeenCalledWith(
      'session.spawn_new',
      { prompt: 'Spawn a helper' },
      expect.objectContaining({
        defaultSessionId: 'sess_native_agent_tool_1',
        surface: 'agent',
        callerPermissionMode: 'yolo',
        causalPermissionAuthority,
        sessionInputSource: {
          sourceSessionId: 'sess_native_agent_tool_1',
          sourceTurnId: 'turn_native_agent_tool_1',
          via: 'action',
        },
        sessionAgentSpawnPolicyV1: spawnPolicy,
        actionRequestId: 'native_tool_call_1',
        approvalOrigin: {
          kind: 'transcript_tool_call',
          sessionId: 'sess_native_agent_tool_1',
          toolCallId: 'native_tool_call_1',
          toolName: 'action_execute',
        },
      }),
    );

    await runtime.executeTool({
      toolName: 'session_transcript_get',
      args: { limit: 10 },
      toolCallId: 'native_tool_call_2',
    });
    expect(executorExecute).toHaveBeenCalledWith(
      'session.transcript.get',
      expect.objectContaining({ sessionId: 'sess_native_agent_tool_1', limit: 10 }),
      expect.objectContaining({
        defaultSessionId: 'sess_native_agent_tool_1',
        surface: 'agent',
        actionRequestId: 'native_tool_call_2',
      }),
    );
  });

  it('binds Agent Discussion posts to the live Session publisher carrier', async () => {
    const postAgentDiscussionMessage = vi.fn(async () => ({
      ok: false as const,
      v: 1 as const,
      error: 'session_discussion_post_denied' as const,
    }));
    let capturedTransport: ((request: any, options?: any) => Promise<unknown>) | undefined;

    vi.doMock('@/session/discussions/sessionDiscussionActionDeps', () => ({
      createSessionDiscussionActionDeps: (options: any) => {
        capturedTransport = options.postAgentMessage;
        return { sessionDiscussionAction: vi.fn() };
      },
    }));
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: () => ({
        executor: { execute: vi.fn() },
      }),
    }));
    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', () => ({
      registerHappierMcpBuiltInTools: () => ({ toolNames: [] }),
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer({
      sessionId: 'session-1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      postAgentDiscussionMessage,
    } as any, {
      credentials: { token: 'token-1' } as any,
    });

    expect(capturedTransport).toBeTypeOf('function');
    const signal = new AbortController().signal;
    await capturedTransport!({
      v: 1,
      sessionId: 'session-1',
      discussionId: 'discussion-1',
      request: {
        localId: 'message-1',
        content: { t: 'plain', v: { v: 1, parts: [{ t: 'text', text: 'Done' }] } },
        mentionedAccountIds: [],
      },
      runId: 'run-1',
      toolCallId: 'tool-1',
    }, { signal });

    expect(postAgentDiscussionMessage).toHaveBeenCalledWith({
      discussionId: 'discussion-1',
      request: expect.objectContaining({ localId: 'message-1' }),
      runId: 'run-1',
      toolCallId: 'tool-1',
    }, { signal });
  }, 60_000);

  it('uses the live session permission mode for session-agent action execution instead of stale metadata', async () => {
    const executorExecute = vi.fn(async (actionId: string, input: unknown, ctx: unknown) => ({
      ok: true,
      result: { actionId, input, ctx },
    }));
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: () => ({
        executor: {
          execute: executorExecute,
        },
      }),
    }));

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_live_permission_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getMetadataSnapshot: () => ({ permissionMode: 'default', permissionModeUpdatedAt: 1 }),
      getPermissionMode: () => 'yolo',
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executeActionByToolName('action_execute', {
      actionId: 'session.spawn_new',
      input: { permissionMode: 'bypassPermissions' },
    }, 'sess_mcp_live_permission_1');

    expect(executorExecute).toHaveBeenLastCalledWith(
      'session.spawn_new',
      { permissionMode: 'bypassPermissions' },
      expect.objectContaining({
        callerPermissionMode: 'yolo',
      }),
    );
  });

  it('passes the live session backend target into action executor deps', async () => {
    const captured: { params?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (params: any) => {
        captured.params = params;
        return {
          executor: {
            execute: vi.fn(async () => ({ ok: true, result: { ok: true } })),
          },
        };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_live_backend_target_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getMetadataSnapshot: () => ({ path: '/repo/current' }),
      getBackendTarget: () => ({
        kind: 'backend',
        backendId: 'review-bot',
        sourceKind: 'configured',
        configuredBackendId: 'review-bot',
      }),
    } as any);

    expect(captured.params).toBeDefined();
    expect(captured.params.getCurrentSessionBackendTarget()).toEqual({
      kind: 'backend',
      backendId: 'review-bot',
      sourceKind: 'configured',
      configuredBackendId: 'review-bot',
    });
  });

  it('suppresses retained memory hits outside the session bound to an unauthenticated MCP client', async () => {
    const captured: { overrides?: any } = {};
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (_params: unknown, overrides: any) => {
        captured.overrides = overrides;
        return { executor: { execute: vi.fn(async () => ({ ok: true, result: { ok: true } })) } };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer({
      sessionId: 'bound-session',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: {
        invokeLocal: async () => ({
          v: 1,
          ok: true,
          hits: [
            {
              sessionId: 'bound-session',
              seqFrom: 1,
              seqTo: 1,
              createdAtFromMs: 1,
              createdAtToMs: 1,
              summary: 'readable',
              score: 1,
            },
            {
              sessionId: 'revoked-session',
              seqFrom: 1,
              seqTo: 1,
              createdAtFromMs: 1,
              createdAtToMs: 1,
              summary: 'retained after revocation',
              score: 0.5,
            },
          ],
        }),
      },
      updateMetadata: () => {},
    } as any, { credentials: null } as any);

    await expect(captured.overrides.daemonMemorySearch({
      query: { v: 1, query: 'retained', scope: { type: 'global' }, mode: 'hints' },
    })).resolves.toEqual(expect.objectContaining({
      ok: true,
      hits: [expect.objectContaining({ sessionId: 'bound-session' })],
    }));
  });

  it('rejects an unauthenticated memory window outside the MCP-bound Session before daemon RPC', async () => {
    const captured: { overrides?: any } = {};
    const invokeLocal = vi.fn(async () => ({ v: 1, snippets: [], citations: [] }));
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (_params: unknown, overrides: any) => {
        captured.overrides = overrides;
        return { executor: { execute: vi.fn(async () => ({ ok: true, result: { ok: true } })) } };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer({
      sessionId: 'bound-session',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal },
      updateMetadata: () => {},
    } as any, { credentials: null } as any);

    await expect(captured.overrides.daemonMemoryGetWindow({
      sessionId: 'other-session',
      seqFrom: 1,
      seqTo: 2,
    })).rejects.toMatchObject({ code: 'not_authenticated' });
    expect(invokeLocal).not.toHaveBeenCalled();
  });

  it('passes live session location into action executor deps', async () => {
    const captured: { params?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: (params: any) => {
        captured.params = params;
        return {
          executor: {
            execute: vi.fn(async () => ({ ok: true, result: { ok: true } })),
          },
        };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_live_location_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
      getMetadataSnapshot: () => ({
        permissionMode: 'bypassPermissions',
        permissionModeUpdatedAt: 10,
      }),
      getCurrentSessionLocation: () => ({
        path: '/repo/current',
        host: 'leeroy-mbp',
        machineId: 'machine-1',
      }),
    } as any);

    expect(captured.params).toBeDefined();
    expect(captured.params.rawSession).toEqual({
      metadata: {
        permissionMode: 'bypassPermissions',
        permissionModeUpdatedAt: 10,
      },
      path: '/repo/current',
      host: 'leeroy-mbp',
      machineId: 'machine-1',
    });
  });

  it('forwards execution.run.list request payloads through the shared action executor deps', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => params);
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal },
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executionRunList('sess_mcp_payload_1', { status: 'running' });
    expect(invokeLocal).toHaveBeenCalledWith('execution.run.list', { status: 'running' });
  });

  it('prefers the session execution-run service when the client provides one', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => params);
    const list = vi.fn(async () => ({ ok: true, data: { runs: [{ runId: 'run_1' }] } }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_2',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal },
      updateMetadata: () => {},
      executionRuns: {
        start: vi.fn(),
        list,
        get: vi.fn(),
        send: vi.fn(),
        stop: vi.fn(),
        action: vi.fn(),
      },
    } as any);

    expect(captured.deps).toBeDefined();
    await captured.deps.executionRunList('sess_mcp_payload_2', { status: 'running' });
    expect(list).toHaveBeenCalledWith({ status: 'running' });
    expect(invokeLocal).not.toHaveBeenCalled();
  });

  it('treats raw local execution-run rpc error payloads as errors in the fallback bridge', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async () => ({
      error: 'RPC method not available',
      errorCode: 'RPC_METHOD_NOT_AVAILABLE',
    }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_payload_3',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal },
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await expect(captured.deps.executionRunList('sess_mcp_payload_3', { status: 'running' })).resolves.toEqual({
      ok: false,
      code: 'RPC_METHOD_NOT_AVAILABLE',
      message: 'RPC method not available',
    });
  });

  it('forwards prompt_registry.install through the shared action executor deps', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const invokeLocal = vi.fn(async (_method: string, params: unknown) => ({
      ok: true,
      digest: 'sha256:deadbeef',
      request: params,
    }));
    createHappierMcpServer({
      sessionId: 'sess_mcp_prompt_registry_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal },
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    const res = await captured.deps.promptRegistryInstall({
      machineId: 'machine_1',
      sourceId: 'source_1',
      itemId: 'item_1',
      configuredSources: [],
      installTarget: {
        assetTypeId: 'codex.prompts',
        scope: 'user',
        targetName: 'example-skill',
        installMode: 'copy',
      },
    });
    expect(invokeLocal).toHaveBeenCalledWith('daemon.promptRegistry.install', {
      sourceId: 'source_1',
      itemId: 'item_1',
      configuredSources: [],
      installTarget: {
        assetTypeId: 'codex.prompts',
        scope: 'user',
        targetName: 'example-skill',
        installMode: 'copy',
      },
    });
    expect(res).toMatchObject({ ok: true, digest: 'sha256:deadbeef' });
  });

  it('routes session control deps through the shared CLI action deps (not unsupported stubs)', async () => {
    const captured: { deps?: any } = {};

    vi.doMock('@happier-dev/protocol', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
      return {
        ...actual,
        createActionExecutor: (deps: any) => {
          captured.deps = deps;
          return {} as any;
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    createHappierMcpServer({
      sessionId: 'sess_mcp_session_control_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any);

    expect(captured.deps).toBeDefined();
    await expect(
      captured.deps.sessionList({ limit: 1, cursor: null, activeOnly: false, archivedOnly: false, includeSystem: false, resumableOnly: false }),
    ).resolves.toEqual({ ok: false, errorCode: 'not_authenticated', error: 'not_authenticated' });
  });

  it('dispatches registered tools using the agent surface (internal MCP)', async () => {
    const captured: { surface?: string } = {};
    const handlers: Record<string, (args: any) => Promise<any>> = {};

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
      McpServer: class FakeMcpServer {
        registerResource() {}
        registerTool(name: string, _meta: any, handler: any) {
          handlers[name] = handler;
        }
      },
    }));

    vi.doMock('@/agent/tools/happierTools/dispatchBuiltInHappierTool', () => ({
      dispatchBuiltInHappierTool: async (params: any) => {
        captured.surface = params.surface;
        return { ok: true, result: { ok: true } };
      },
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');

    const fakeClient = {
      sessionId: 'sess_mcp_surface_1',
      getServerBinding: getTestServerBinding,
      rpcHandlerManager: { invokeLocal: async () => ({}) },
      updateMetadata: () => {},
    } as any;

    createHappierMcpServer(fakeClient);

    expect(typeof handlers.change_title).toBe('function');
    await handlers.change_title({ title: 'Hello' });
    expect(captured.surface).toBe('agent');
  });

  it('routes change_title through the action executor (so approvals/enablement apply)', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: () => ({ executor: { execute } }),
      };
    });

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_change_title_1',
        getServerBinding: getTestServerBinding,
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        updateMetadata: () => {},
      } as any,
      { credentials: null },
    );

    expect(captured.deps).toBeDefined();
    await captured.deps.changeTitle('sess_change_title_1', 'New title');
    expect(execute).toHaveBeenCalledWith(
      'session.title.set',
      { sessionId: 'sess_change_title_1', title: 'New title' },
      { surface: 'agent', defaultSessionId: 'sess_change_title_1' },
    );
  });

  it('does not perform a redundant metadata write after change_title commits', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const updateMetadata = vi.fn(() => {
      throw new Error('local metadata sync failed');
    });
    const captured: { deps?: any } = {};

    vi.doMock('@/session/actions/createCliActionExecutorHarness', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/session/actions/createCliActionExecutorHarness')>();
      return {
        ...actual,
        createCliActionExecutorHarness: () => ({ executor: { execute } }),
      };
    });

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_change_title_refresh_1',
        getServerBinding: getTestServerBinding,
        rpcHandlerManager: { invokeLocal: async () => ({}) },
        updateMetadata,
      } as any,
      { credentials: null },
    );

    expect(captured.deps).toBeDefined();
    await expect(captured.deps.changeTitle('sess_change_title_refresh_1', 'New title')).resolves.toEqual({
      success: true,
      title: 'New title',
    });
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it('routes direct-exposed execution_run_start through the shared action executor path', async () => {
    const activeTurnAuthority = {
      kind: 'admittedSessionInputV1',
      admittedPermissionCeiling: 'default',
    } as const;
    const invokeLocal = vi.fn(async (method: string, params: unknown) => {
      if (method === 'execution.run.start' || method === 'execution.run.send') {
        return {
          runId: 'run_1',
          callId: 'call_1',
          sidechainId: 'side_1',
          request: params,
        };
      }
      return {};
    });
    const captured: { deps?: any } = {};
    const executorExecute = vi.fn(async (actionId: string, input: unknown, ctx: unknown) => ({
      ok: true,
      result: { actionId, input, ctx },
    }));

    vi.doMock('@/mcp/server/registerHappierMcpBuiltInTools', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/mcp/server/registerHappierMcpBuiltInTools')>();
      return {
        ...actual,
        registerHappierMcpBuiltInTools: (_server: any, params: any) => {
          captured.deps = params.deps;
          return { toolNames: [] };
        },
      };
    });
    vi.doMock('@/session/actions/createCliActionExecutorHarness', () => ({
      createCliActionExecutorHarness: () => ({
        executor: {
          execute: executorExecute,
        },
      }),
    }));

    const { createHappierMcpServer } = await import('@/mcp/createHappierMcpServer');
    createHappierMcpServer(
      {
        sessionId: 'sess_execution_run_start_1',
        getServerBinding: getTestServerBinding,
        rpcHandlerManager: { invokeLocal },
        updateMetadata: () => {},
        // The mutable Session mode has widened since this turn was admitted.
        getPermissionMode: () => 'yolo',
        getActiveTurnPermissionWitness: () => ({
          turnId: 'turn-active',
          causalPermissionAuthority: activeTurnAuthority,
        }),
      } as any,
      {
        credentials: null,
        accountSettings: {
          actionsSettingsV1: {
            v: 1,
            actions: {
              'execution.run.start': {
                toolExposureModes: {
                  agent: 'direct',
                },
              },
            },
          },
        },
      } as any,
    );

    expect(captured.deps).toBeDefined();
    await captured.deps.executeActionByToolName('execution_run_start', {
      intent: 'plan',
      backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
      instructions: 'Plan.',
      permissionMode: 'read_only',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
    });
    expect(executorExecute).toHaveBeenCalledWith('execution.run.start', expect.objectContaining({
      intent: 'plan',
      backendTarget: { kind: 'backend', backendId: 'codex', sourceKind: 'built_in' },
      instructions: 'Plan.',
      permissionMode: 'read_only',
      retentionPolicy: 'ephemeral',
      runClass: 'bounded',
      ioMode: 'request_response',
    }), expect.objectContaining({
      surface: 'agent',
      callerPermissionMode: 'yolo',
      causalPermissionAuthority: activeTurnAuthority,
    }));
    expect(invokeLocal).not.toHaveBeenCalled();
  });
});
