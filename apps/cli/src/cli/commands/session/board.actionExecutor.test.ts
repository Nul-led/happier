import { beforeEach, describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';
import { listCompiledActionCliCommands } from '@/cli/actions/compiledCommands';
import { resolveCompiledActionCliCompletionCandidates } from '@/cli/actions/commandCompletion';

const execute = vi.fn();
const resolveSessionTarget = vi.fn(async (selector: string) => ({
  ok: true as const,
  sessionId: selector === 'session-prefix' ? 'session-exact' : selector,
}));
const createCliActionExecutorFromCredentials = vi.fn(() => ({ execute, resolveSessionTarget }));

vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials,
}));

import { handleSessionCommand } from './handleSessionCommand';

const credentials = {
  token: 'token_test',
  encryption: { type: 'legacy' as const, secret: new Uint8Array(32).fill(1) },
};

const ITEM = {
  v: 1,
  title: 'Release checklist',
  frame: 'card',
  height: { mode: 'auto', fallback: 'regular' },
  source: { kind: 'declarative', document: { version: 1, root: { kind: 'markdown', text: '# Release' } } },
} as const;

function resultFor(actionId: string) {
  const envelope = { v: 1, serverId: 'server-1', sessionId: 'session-exact' };
  if (actionId === 'session.board.get') {
    return {
      ...envelope,
      capabilities: { readTranscript: true, editSessionRecords: true },
      layout: { v: 1, tabs: [] },
      items: [],
      incomplete: false,
      page: { nextCursor: null },
    };
  }
  return {
    ...envelope,
    result: { operation: 'upsert_item' },
    destination: null,
  };
}

describe('happier session board (compiled Action executor)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = 0;
    execute.mockImplementation(async (actionId: string) => ({ ok: true, result: resultFor(actionId) }));
  });

  it('routes every friendly Board command through the canonical Action and exact Session resolver', async () => {
    const cases = [
      [['board', 'show', 'session-prefix'], 'session.board.get', 'session_board_show'],
      [
        ['board', 'item', 'set', 'session-prefix', 'release-checklist',
          '--item-json', JSON.stringify(ITEM),
          '--placement-json', JSON.stringify({ tabId: 'overview', tabTitle: 'Overview', width: 'wide' })],
        'session.board.item.upsert',
        'session_board_item_set',
      ],
      [
        ['board', 'item', 'remove', 'session-prefix', 'release-checklist',
          '--expected-item-revision', 'ssr1.AAAACHN5c3JlY18xAAAAAQ',
          '--expected-layout-revision', 'ssr1.AAAACHN5c3JlY18xAAAAAQ'],
        'session.board.item.remove',
        'session_board_item_remove',
      ],
      [
        ['board', 'layout', 'update', 'session-prefix',
          '--operation-json', JSON.stringify({
            op: 'item.move',
            itemId: 'release-checklist',
            fromTabId: 'overview',
            toTabId: 'metrics',
            anchor: { side: 'before', itemId: 'burndown' },
          })],
        'session.board.layout.update',
        'session_board_layout_update',
      ],
    ] as const;

    for (const [argv, actionId, kind] of cases) {
      const output = captureConsoleJsonOutput();
      try {
        await handleSessionCommand([...argv, '--json'], { readCredentialsFn: async () => credentials });
        expect(output.json(), argv.join(' ')).toMatchObject({ v: 1, ok: true, kind });
      } finally {
        output.restore();
      }
      expect(execute.mock.calls.at(-1)?.[0], argv.join(' ')).toBe(actionId);
      expect(execute.mock.calls.at(-1)?.[1], argv.join(' ')).toMatchObject({ sessionId: 'session-exact' });
    }

    expect(resolveSessionTarget).toHaveBeenCalledTimes(cases.length);
  }, 60_000);

  it('binds an omitted expected revision to the canonical creation operand', async () => {
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand([
        'board', 'item', 'set', 'session-prefix', 'release-checklist',
        '--item-json', JSON.stringify(ITEM),
        '--placement-json', JSON.stringify({ tabId: 'overview', tabTitle: 'Overview', width: 'wide' }),
        '--json',
      ], { readCredentialsFn: async () => credentials });
      expect(output.json()).toMatchObject({ ok: true, kind: 'session_board_item_set' });
    } finally {
      output.restore();
    }

    expect(execute.mock.calls.at(-1)?.[1]).toMatchObject({
      sessionId: 'session-exact',
      itemId: 'release-checklist',
      expectedItemRevision: null,
      item: ITEM,
      placement: { tabId: 'overview', tabTitle: 'Overview', width: 'wide' },
    });
  });

  it('projects the Board command family into shell completion', () => {
    const commands = listCompiledActionCliCommands();
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: ['session'],
      prefix: 'b',
      commands,
    })).toContain('board');
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: ['session', 'board'],
      prefix: '',
      commands,
    })).toEqual(expect.arrayContaining(['show', 'item', 'layout']));
    expect(resolveCompiledActionCliCompletionCandidates({
      committed: ['session', 'board', 'item'],
      prefix: '',
      commands,
    })).toEqual(expect.arrayContaining(['set', 'remove']));
  });
});
