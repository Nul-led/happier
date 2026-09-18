import { describe, expect, it, vi } from 'vitest';

import { handleToolsCommand } from './tools';
import { captureStdoutJsonOutput } from '@/testkit/logger/captureOutput';
import { listBuiltInHappierTools as projectBuiltInHappierTools } from '@/agent/tools/happierTools/listBuiltInHappierTools';

const BOARD_TOOL_NAMES = [
  'session_board_get',
  'session_board_item_upsert',
  'session_board_item_remove',
  'session_board_layout_update',
] as const;

function serverFeaturesSnapshot(boardEnabled: unknown) {
  return {
    status: 'ready' as const,
    features: {
      features: {
        sessions: {
          enabled: true,
          board: { enabled: boardEnabled },
        },
      },
    },
  } as any;
}

function createBaseDeps() {
  return {
    readCredentials: async () => ({
      token: 'token',
      encryption: null,
    }),
    initializeBackendApiContext: async () => ({
      api: { getServerFeaturesSnapshot: async () => undefined } as any,
      machineId: 'machine-1',
    }),
    bootstrapAccountSettingsContext: async () => ({ settings: {}, source: 'network', settingsVersion: 1, loadedAtMs: 1, whenRefreshed: null }),
    resolveCustomHappierToolsContext: async () => ({ mcpServers: {}, warnings: [] }),
  };
}

describe('happier tools --json', () => {
  it('prints a tools_list JSON envelope grouped by source', async () => {
    const output = captureStdoutJsonOutput();
    const initializeBackendApiContext = vi.fn(async () => ({ api: {} as any, machineId: 'machine-1' }));
    const resolveCustomHappierToolsContext = vi.fn(async () => ({ mcpServers: {}, warnings: [] }));
    const savedSecretResources = [{ resourceId: 'shared-secret-resource' }];
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand(['list', '--session-id', 'sess-1', '--directory', '/tmp/workspace', '--json'], {
        ...createBaseDeps(),
        initializeBackendApiContext,
        bootstrapAccountSettingsContext: async () => ({
          settings: {},
          source: 'network',
          settingsVersion: 1,
          loadedAtMs: 1,
          savedSecretResources,
          whenRefreshed: null,
        }),
        resolveCustomHappierToolsContext,
        listBuiltInHappierTools: async () => [
          { name: 'change_title', title: 'Change title', description: 'Rename', inputSchema: { title: 'string' } },
        ],
        listResolvedCustomHappierTools: async () => ({
          tools: [
            { source: 'playwright', name: 'open_page', description: 'Open a page', inputSchema: { url: 'string' } },
          ],
          warnings: [],
        }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('tools_list');
      expect(parsed.data?.sources?.happier).toEqual([
        expect.objectContaining({ name: 'change_title' }),
      ]);
      expect(parsed.data?.sources?.playwright).toEqual([
        expect.objectContaining({ name: 'open_page' }),
      ]);
      expect(initializeBackendApiContext).toHaveBeenCalledWith(expect.objectContaining({
        suppressMachineRegistrationRecoveryLogs: true,
      }));
      expect(resolveCustomHappierToolsContext).toHaveBeenCalledOnce();
      expect(resolveCustomHappierToolsContext).toHaveBeenCalledWith(expect.objectContaining({
        savedSecretResources,
      }));
      expect(process.exitCode).toBe(0);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints a tools_list JSON envelope with warnings when one custom source is unavailable', async () => {
    const output = captureStdoutJsonOutput();
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand(['list', '--session-id', 'sess-1', '--directory', '/tmp/workspace', '--json'], {
        ...createBaseDeps(),
        listBuiltInHappierTools: async () => [
          { name: 'change_title', title: 'Change title', description: 'Rename', inputSchema: { title: 'string' } },
        ],
        listResolvedCustomHappierTools: async () => ({
          tools: [
            { source: 'playwright', name: 'open_page', description: 'Open a page', inputSchema: { url: 'string' } },
          ],
          warnings: [
            { source: 'qa_remote_http_saved_secret_20260306', error: 'Connection closed' },
          ],
        }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('tools_list');
      expect(parsed.data?.sources?.playwright).toEqual([
        expect.objectContaining({ name: 'open_page' }),
      ]);
      expect(parsed.data?.warnings).toEqual([
        { source: 'qa_remote_http_saved_secret_20260306', error: 'Connection closed' },
      ]);
      expect(process.exitCode).toBe(0);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('allows happier tools list without a session id', async () => {
    const output = captureStdoutJsonOutput();
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand(['list', '--directory', '/tmp/workspace', '--json'], {
        ...createBaseDeps(),
        listBuiltInHappierTools: async () => [
          { name: 'change_title', title: 'Change title', description: 'Rename', inputSchema: { title: 'string' } },
        ],
        listResolvedCustomHappierTools: async () => ({ tools: [], warnings: [] }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('tools_list');
      expect(parsed.data?.sources?.happier).toEqual([
        expect.objectContaining({ name: 'change_title' }),
      ]);
      expect(process.exitCode).toBe(0);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints a tools_call JSON envelope for built-in Happier tools', async () => {
    const output = captureStdoutJsonOutput();
    const initializeBackendApiContext = vi.fn(async () => ({ api: {} as any, machineId: 'machine-1' }));
    const bootstrapAccountSettingsContext = vi.fn(async () => ({ settings: {}, source: 'network', settingsVersion: 1, loadedAtMs: 1, whenRefreshed: null }));
    const resolveCustomHappierToolsContext = vi.fn(async () => {
      throw new Error('built-in tools must not materialize custom MCP state');
    });
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand([
        'call',
        '--session-id',
        'sess-1',
        '--directory',
        '/tmp/workspace',
        '--source',
        'happier',
        '--tool',
        'change_title',
        '--args-json',
        '{"title":"Renamed"}',
        '--json',
      ], {
        ...createBaseDeps(),
        initializeBackendApiContext,
        bootstrapAccountSettingsContext,
        resolveCustomHappierToolsContext,
        callBuiltInHappierTool: async ({ toolName, args, sessionId }: any) => ({
          ok: true,
          result: { toolName, args, sessionId },
        }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('tools_call');
      expect(parsed.data).toEqual({
        source: 'happier',
        tool: 'change_title',
        isError: false,
        output: {
          toolName: 'change_title',
          args: { title: 'Renamed' },
          sessionId: 'sess-1',
        },
      });
      expect(initializeBackendApiContext).not.toHaveBeenCalled();
      expect(bootstrapAccountSettingsContext).not.toHaveBeenCalled();
      expect(resolveCustomHappierToolsContext).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints a tools_call JSON envelope for custom Happier-managed tools', async () => {
    const output = captureStdoutJsonOutput();
    const resolveCustomHappierToolsContext = vi.fn(async () => ({ mcpServers: {}, warnings: [] }));
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand([
        'call',
        '--session-id',
        'sess-1',
        '--directory',
        '/tmp/workspace',
        '--source',
        'playwright',
        '--tool',
        'open_page',
        '--args-json',
        '{"url":"https://example.com"}',
        '--json',
      ], {
        ...createBaseDeps(),
        resolveCustomHappierToolsContext,
        callResolvedCustomHappierTool: async ({ source, toolName, args, sessionId }: any) => ({
          ok: true,
          result: { source, toolName, args, sessionId },
        }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(true);
      expect(parsed.kind).toBe('tools_call');
      expect(parsed.data).toEqual({
        source: 'playwright',
        tool: 'open_page',
        isError: false,
        output: {
          source: 'playwright',
          toolName: 'open_page',
          args: { url: 'https://example.com' },
        },
      });
      expect(resolveCustomHappierToolsContext).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(0);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('includes session ambiguity candidates in the tools_call JSON error envelope for built-in Happier tools', async () => {
    const output = captureStdoutJsonOutput();
    const prevExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand([
        'call',
        '--session-id',
        'sess',
        '--directory',
        '/tmp/workspace',
        '--source',
        'happier',
        '--tool',
        'change_title',
        '--args-json',
        '{"title":"Renamed"}',
        '--json',
      ], {
        ...createBaseDeps(),
        callBuiltInHappierTool: async () => ({
          ok: false,
          errorCode: 'session_id_ambiguous',
          error: 'Session id is ambiguous',
          candidates: ['sess-1', 'sess-2'],
        }),
      } as any);

      const parsed = output.json<any>();
      expect(parsed.ok).toBe(false);
      expect(parsed.kind).toBe('tools_call');
      expect(parsed.error).toEqual({
        code: 'session_id_ambiguous',
        message: 'Session id is ambiguous',
        candidates: ['sess-1', 'sess-2'],
      });
      expect(process.exitCode).toBe(1);
    } finally {
      output.restore();
      process.exitCode = prevExitCode;
    }
  });

  it('forwards native tool-call identity only for the internal Agent bridge', async () => {
    const output = captureStdoutJsonOutput();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const callBuiltInHappierTool = vi.fn(async () => ({ ok: true as const, result: { done: true } }));

    try {
      await handleToolsCommand([
        'call',
        '--session-id', 'sess-1',
        '--directory', '/tmp/workspace',
        '--source', 'happier',
        '--tool', 'action_execute',
        '--args-json', '{"actionId":"memory.search","input":{}}',
        '--agent-bridge',
        '--tool-call-id', 'pi-call-1',
        '--json',
      ], {
        ...createBaseDeps(),
        callBuiltInHappierTool,
      } as any);

      expect(callBuiltInHappierTool).toHaveBeenCalledWith(expect.objectContaining({
        surface: 'agent',
        toolCallId: 'pi-call-1',
      }));
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });

  it('dispatches the generated shell-bridge call as Agent automation even with stored human credentials', async () => {
    const { buildHappierToolsShellBridgeCommand } = await import(
      '@/agent/tools/happierTools/runtime/buildHappierToolsShellBridgeCommand'
    );
    const { parseHappierToolsShellBridgeCommand } = await import('@happier-dev/protocol');
    const generated = buildHappierToolsShellBridgeCommand([
      'call',
      '--session-id',
      'sess-1',
      '--directory',
      '/tmp/workspace',
      '--source',
      'happier',
      '--tool',
      'change_title',
      '--args-json',
      '{"title":"Renamed"}',
      '--json',
    ]);
    const parsed = parseHappierToolsShellBridgeCommand(generated);
    expect(parsed).toMatchObject({ kind: 'call', agentBridge: true });

    const output = captureStdoutJsonOutput();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const callBuiltInHappierTool = vi.fn(async () => ({ ok: true as const, result: { done: true } }));

    try {
      // The exact argv the generated command runs, taken from the producer
      // rather than restated by hand.
      await handleToolsCommand([
        'call',
        '--agent-bridge',
        '--session-id', 'sess-1',
        '--directory', '/tmp/workspace',
        '--source', 'happier',
        '--tool', 'change_title',
        '--args-json', '{"title":"Renamed"}',
        '--json',
      ], {
        ...createBaseDeps(),
        callBuiltInHappierTool,
      } as any);

      expect(callBuiltInHappierTool).toHaveBeenCalledWith(expect.objectContaining({
        surface: 'agent',
      }));
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });

  it('lists tools on the Agent surface for the generated shell bridge', async () => {
    const output = captureStdoutJsonOutput();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const listBuiltInHappierTools = vi.fn(async () => []);

    try {
      await handleToolsCommand(['list', '--agent-bridge', '--session-id', 'sess-1', '--json'], {
        ...createBaseDeps(),
        listBuiltInHappierTools,
        listResolvedCustomHappierTools: async () => ({ tools: [], warnings: [] }),
      } as any);

      expect(listBuiltInHappierTools).toHaveBeenCalledWith(expect.objectContaining({
        surface: 'agent',
      }));
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });

  it.each([
    ['missing exact Session target', serverFeaturesSnapshot(true), false],
    ['missing snapshot', undefined, true],
    ['malformed snapshot', serverFeaturesSnapshot('yes'), true],
    ['disabled snapshot', serverFeaturesSnapshot(false), true],
  ])('fails closed for server-backed Board tools on the shell Agent bridge with a %s', async (_label, snapshot, withSession) => {
    const output = captureStdoutJsonOutput();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      await handleToolsCommand([
        'list',
        '--agent-bridge',
        ...(withSession ? ['--session-id', 'sess-1'] : []),
        '--json',
      ], {
        ...createBaseDeps(),
        initializeBackendApiContext: async () => ({
          api: { getServerFeaturesSnapshot: async () => snapshot } as any,
          machineId: 'machine-1',
        }),
        listBuiltInHappierTools: async (params: any) => projectBuiltInHappierTools(params),
        listResolvedCustomHappierTools: async () => ({ tools: [], warnings: [] }),
      } as any);

      const names = output.json<any>().data.sources.happier.map((tool: { name: string }) => tool.name);
      for (const boardToolName of BOARD_TOOL_NAMES) {
        expect(names).not.toContain(boardToolName);
      }
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });

  it('advertises all Board tools only from the shell Agent bridge target Home enabled snapshot', async () => {
    const seenByToken = new Map<string, readonly string[]>();

    for (const [token, enabled] of [['home-a-token', false], ['home-b-token', true]] as const) {
      const output = captureStdoutJsonOutput();
      const previousExitCode = process.exitCode;
      process.exitCode = undefined;
      try {
        await handleToolsCommand(['list', '--agent-bridge', '--session-id', 'same-session-id', '--json'], {
          ...createBaseDeps(),
          readCredentials: async () => ({ token, encryption: null }),
          initializeBackendApiContext: async ({ credentials }: any) => ({
            api: {
              getServerFeaturesSnapshot: async () => serverFeaturesSnapshot(
                credentials.token === 'home-b-token',
              ),
            } as any,
            machineId: 'machine-1',
          }),
          listBuiltInHappierTools: async (params: any) => projectBuiltInHappierTools(params),
          listResolvedCustomHappierTools: async () => ({ tools: [], warnings: [] }),
        } as any);
        seenByToken.set(
          token,
          output.json<any>().data.sources.happier.map((tool: { name: string }) => tool.name),
        );
      } finally {
        output.restore();
        process.exitCode = previousExitCode;
      }
    }

    for (const boardToolName of BOARD_TOOL_NAMES) {
      expect(seenByToken.get('home-a-token')).not.toContain(boardToolName);
    }
    expect(seenByToken.get('home-b-token')).toEqual(expect.arrayContaining([...BOARD_TOOL_NAMES]));
  });

  it('lists built-in tools with the bootstrapped Account Action policy', async () => {
    const output = captureStdoutJsonOutput();
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const listBuiltInHappierTools = vi.fn(async ({ isActionEnabled }: any) => {
      expect(isActionEnabled('subagents.plan.start')).toBe(false);
      return [];
    });

    try {
      await handleToolsCommand(['list', '--session-id', 'sess-1', '--json'], {
        ...createBaseDeps(),
        bootstrapAccountSettingsContext: async () => ({
          settings: {
            actionsSettingsV1: {
              v: 1,
              actions: { 'subagents.plan.start': { disabledSurfaces: ['cli'] } },
            },
          },
          source: 'network',
          settingsVersion: 1,
          loadedAtMs: 1,
          whenRefreshed: null,
        }),
        listBuiltInHappierTools,
        listResolvedCustomHappierTools: async () => ({ tools: [], warnings: [] }),
      } as any);

      expect(listBuiltInHappierTools).toHaveBeenCalledOnce();
    } finally {
      output.restore();
      process.exitCode = previousExitCode;
    }
  });
});
