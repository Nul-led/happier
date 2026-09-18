import { describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';
import { handleSessionCommand } from '../handleSessionCommand';

describe('happier session run start arguments', () => {
  it('accepts --agent as the executable Agent selector before credential checks', async () => {
    const output = captureConsoleJsonOutput();
    const readCredentialsFn = vi.fn(async () => null);

    try {
      await handleSessionCommand(
        ['run', 'start', 'sess-1', '--intent', 'review', '--agent', 'agent:happier.agent.codex/codex', '--json'],
        { readCredentialsFn },
      );

      expect(output.json()).toMatchObject({
        v: 1,
        ok: false,
        kind: 'session_run_start',
        error: { code: 'not_authenticated' },
      });
      expect(readCredentialsFn).toHaveBeenCalledOnce();
    } finally {
      output.restore();
    }
  });

  it('rejects retired --backend before credential checks', async () => {
    const output = captureConsoleJsonOutput();
    const readCredentialsFn = vi.fn(async () => null);

    try {
      await handleSessionCommand(
        ['run', 'start', 'sess-1', '--intent', 'review', '--backend', 'agent:happier.agent.codex/codex', '--json'],
        { readCredentialsFn },
      );

      expect(output.json()).toMatchObject({
        v: 1,
        ok: false,
        kind: 'session_run_start',
        error: { code: 'invalid_arguments' },
      });
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it('returns a stable invalid_arguments error for an unsupported intent before reading credentials', async () => {
    const output = captureConsoleJsonOutput();
    const readCredentialsFn = vi.fn(async () => null);

    try {
      await handleSessionCommand(
        ['run', 'start', 'sess-1', '--intent', 'qa_cli_run', '--agent', 'agent:happier.agent.codex/codex', '--json'],
        { readCredentialsFn },
      );

      expect(output.json()).toMatchObject({
        v: 1,
        ok: false,
        kind: 'session_run_start',
        error: { code: 'invalid_arguments' },
      });
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it.each([
    ['--retention', 'durable', 'ephemeral, resumable'],
    ['--run-class', 'interactive', 'bounded, long_lived'],
    ['--io-mode', 'batch', 'request_response, streaming'],
  ] as const)('rejects an unsupported %s value before reading credentials', async (flag, value, _expectedValues) => {
    const output = captureConsoleJsonOutput();
    const readCredentialsFn = vi.fn(async () => null);

    try {
      await handleSessionCommand(
        [
          'run',
          'start',
          'sess-1',
          '--intent',
          'review',
          '--agent',
          'agent:happier.agent.codex/codex',
          flag,
          value,
          '--json',
        ],
        { readCredentialsFn },
      );

      expect(output.json()).toMatchObject({
        v: 1,
        ok: false,
        kind: 'session_run_start',
        error: { code: 'invalid_arguments' },
      });
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });

  it.each([
    ['--retention', 'ephemeral, resumable'],
    ['--run-class', 'bounded, long_lived'],
    ['--io-mode', 'request_response, streaming'],
  ] as const)('rejects %s without a value before reading credentials', async (flag, _expectedValues) => {
    const output = captureConsoleJsonOutput();
    const readCredentialsFn = vi.fn(async () => null);

    try {
      await handleSessionCommand(
        [
          'run',
          'start',
          'sess-1',
          '--intent',
          'review',
          '--agent',
          'agent:happier.agent.codex/codex',
          '--json',
          flag,
        ],
        { readCredentialsFn },
      );

      expect(output.json()).toMatchObject({
        v: 1,
        ok: false,
        kind: 'session_run_start',
        error: { code: 'invalid_arguments' },
      });
      expect(readCredentialsFn).not.toHaveBeenCalled();
    } finally {
      output.restore();
    }
  });
});
