import { describe, expect, it, vi } from 'vitest';

import { captureConsoleText } from '@/testkit/logger/captureOutput';
import { findCompiledActionCliCommand } from '@/cli/actions/compiledCommands';
import { renderActionCliCommandHelp } from '@/cli/actions/commandHelp';
import { handleSessionCommand } from './handleSessionCommand';
import { SESSION_HELP_LINES } from './shared/sessionCommandUsage';

function compiledHelp(path: readonly string[]): string {
  const command = findCompiledActionCliCommand(path);
  if (!command) throw new Error(`Missing compiled command ${path.join(' ')}`);
  return renderActionCliCommandHelp(command);
}

describe('handleSessionCommand help output', () => {
  it('lists the direct session control subcommands and run subcommands', async () => {
    const output = captureConsoleText();

    try {
      await handleSessionCommand(['--help']);

      expect(output.text()).toContain('happier session list');
      expect(output.text()).toContain('happier resume [<session-id-or-prefix>]');
      expect(output.text()).toContain(compiledHelp(['session', 'status']).split('\n')[0]);
      expect(output.text()).toContain(SESSION_HELP_LINES.create);
      expect(output.text()).toContain('happier session create [options]\n\nOptions:\n  [--path <path>]');
      // Migrated leaves are listed from the compiled descriptor, not the
      // dedicated usage table, so help and the parser cannot drift apart.
      for (const leaf of ['send', 'wait', 'stop', 'set-title', 'set-permission-mode', 'set-model', 'archive', 'unarchive']) {
        expect(output.text()).toContain(compiledHelp(['session', leaf]).split('\n')[0]);
      }
      expect(output.text()).toContain(SESSION_HELP_LINES.history);
      expect(output.text()).toContain('happier session actions list [--json]');
      expect(output.text()).toContain('happier session actions describe <action-id> [--json]');
      expect(output.text()).toContain(SESSION_HELP_LINES.actionsExecute);
      for (const leaf of ['start', 'list', 'send', 'stop', 'wait']) {
        expect(output.text()).toContain(compiledHelp(['session', 'run', leaf]).split('\n')[0]);
      }
      expect(output.text()).toContain('deprecated: use "happier send <session> <message> --run <run>"');
      expect(output.text()).toContain('happier session run action <session-id-or-prefix-or-tag> <run-id> <action-id> [--input-json <json>] [--json]');
    } finally {
      output.restore();
    }
  });

  it.each([
    [['--help', '--json'], 'session_help'],
    [['help', '--json'], 'session_help'],
    [['list', '--help', '--json'], 'session_list'],
    [['run', 'start', '--help', '--json'], 'session_run_start'],
  ] as const)('keeps stdout parseable JSON for `%s`', async (argv, expectedKind) => {
    // `--json` is a machine-output contract, so everything stdout carries must
    // parse. Printing usage prose there breaks the caller's parser on the one
    // invocation shape a script is most likely to probe with.
    const output = captureConsoleText();
    const readCredentialsFn = vi.fn(async () => {
      throw new Error('readCredentialsFn should not be called for session help');
    });

    try {
      await handleSessionCommand([...argv], { readCredentialsFn });

      const parsed = JSON.parse(output.text().trim()) as Record<string, unknown>;
      expect(parsed).toMatchObject({ v: 1, ok: true, kind: expectedKind });
      expect(String((parsed.data as Record<string, unknown>).help)).toContain('happier session');
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it.each([
    ['list', 'happier session list'],
    ['status', compiledHelp(['session', 'status'])],
    ['create', SESSION_HELP_LINES.create],
    ['send', compiledHelp(['session', 'send'])],
    ['wait', compiledHelp(['session', 'wait'])],
    ['stop', compiledHelp(['session', 'stop'])],
    ['archive', compiledHelp(['session', 'archive'])],
    ['unarchive', compiledHelp(['session', 'unarchive'])],
    ['history', SESSION_HELP_LINES.history],
    ['set-title', compiledHelp(['session', 'set-title'])],
    ['set-permission-mode', compiledHelp(['session', 'set-permission-mode'])],
    ['set-model', compiledHelp(['session', 'set-model'])],
  ] as const)('prints usage for `%s --help` without prompting for credentials', async (subcommand, expectedUsage) => {
    const output = captureConsoleText();
    const readCredentialsFn = vi.fn(async () => {
      throw new Error('readCredentialsFn should not be called for session help');
    });

    try {
      await handleSessionCommand([subcommand, '--help'], { readCredentialsFn });

      expect(output.text()).toContain(expectedUsage);
      expect(output.text()).not.toContain('Not authenticated');
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it.each([
    [['actions', '--help'], 'happier session actions list [--json]'],
    [['actions', 'list', '--help'], 'happier session actions list [--json]'],
    [['actions', 'describe', '--help'], 'happier session actions describe <action-id> [--json]'],
    [['actions', 'execute', '--help'], SESSION_HELP_LINES.actionsExecute],
    [['run', 'action', '--help'], 'happier session run action <session-id-or-prefix-or-tag> <run-id> <action-id> [--input-json <json>] [--json]'],
    [['review', '--help'], 'happier session review start <session-id-or-prefix-or-tag> --engines <id1,id2> --instructions <text> [--json]'],
    [['review', 'start', '--help'], 'happier session review start <session-id-or-prefix-or-tag> --engines <id1,id2> --instructions <text> [--json]'],
    [['plan', '--help'], SESSION_HELP_LINES.planStart],
    [['plan', 'start', '--help'], SESSION_HELP_LINES.planStart],
    [['delegate', '--help'], SESSION_HELP_LINES.delegateStart],
    [['delegate', 'start', '--help'], SESSION_HELP_LINES.delegateStart],
    [['voice-agent', '--help'], SESSION_HELP_LINES.voiceAgentStart],
    [['voice-agent', 'start', '--help'], SESSION_HELP_LINES.voiceAgentStart],
    [['voice_agent', 'start', '--help'], SESSION_HELP_LINES.voiceAgentStart],
  ] as const)('prints usage for nested `%s` without prompting for credentials', async (argv, expectedUsage) => {
    const output = captureConsoleText();
    const readCredentialsFn = vi.fn(async () => {
      throw new Error('readCredentialsFn should not be called for session help');
    });

    try {
      await handleSessionCommand([...argv], { readCredentialsFn });

      expect(output.text()).toContain(expectedUsage);
      expect(output.text()).not.toContain('Not authenticated');
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it.each([
    ['send'],
    ['start'],
    ['list'],
    ['get'],
    ['stop'],
    ['wait'],
    ['stream-start'],
    ['stream-read'],
    ['stream-cancel'],
  ] as const)('renders `session run %s --help` from its compiled descriptor', async (leaf) => {
    const output = captureConsoleText();
    const readCredentialsFn = vi.fn(async () => {
      throw new Error('readCredentialsFn should not be called for session help');
    });
    try {
      await handleSessionCommand(['run', leaf, '--help'], { readCredentialsFn });
      expect(output.text().trimEnd()).toBe(compiledHelp(['session', 'run', leaf]).trimEnd());
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it('builds `session run --help` from the dedicated workflow and every compiled run leaf', async () => {
    const output = captureConsoleText();
    try {
      await handleSessionCommand(['run', '--help']);
      expect(output.text()).toContain(SESSION_HELP_LINES.runAction);
      for (const leaf of ['send', 'start', 'list', 'get', 'stop', 'wait', 'stream-start', 'stream-read', 'stream-cancel']) {
        expect(output.text()).toContain(compiledHelp(['session', 'run', leaf]).split('\n')[0]);
      }
    } finally {
      output.restore();
    }
  });
});
