import { describe, expect, it, vi } from 'vitest';

import { createOpenSshHappierJsonExecutor, parseStrictPersonalHomeTaskFinalResult } from './openSshHappierJsonExecutor.js';

describe('parseStrictPersonalHomeTaskFinalResult', () => {
  const valid = { kind: 'personal_home_task_result', protocolVersion: 1, result: { protocolVersion: 1, taskId: 'task-1', ok: true, data: { running: false } } };
  it('accepts JSONL events only when the last line is the exact successful result', () => {
    expect(parseStrictPersonalHomeTaskFinalResult(`${JSON.stringify({ type: 'progress' })}\n${JSON.stringify(valid)}\n`).data).toEqual({ running: false });
  });
  it.each([
    ['missing', ''], ['noise-after-result', `${JSON.stringify(valid)}\nnoise`],
    ['wrong-kind', JSON.stringify({ ...valid, kind: 'other' })],
    ['wrong-version', JSON.stringify({ ...valid, protocolVersion: 2 })],
    ['failure', JSON.stringify({ ...valid, result: { protocolVersion: 1, taskId: 'task-1', ok: false, error: { code: 'x', message: 'x' } } })],
    ['missing-data', JSON.stringify({ ...valid, result: { protocolVersion: 1, taskId: 'task-1', ok: true } })],
  ])('rejects %s', (_name, text) => {
    expect(() => parseStrictPersonalHomeTaskFinalResult(text)).toThrow();
  });
});

describe('createOpenSshHappierJsonExecutor', () => {
  it('prefixes remote commands with release-ring env scoping for dev lane', async () => {
    const runRemoteText = vi.fn<(params: any) => Promise<void>>(async () => {});

    const executor = createOpenSshHappierJsonExecutor({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'publicdev',
      runRemoteText: async ({ remoteCommand, ...rest }) => {
        await runRemoteText({ remoteCommand, ...rest });
        return { status: 0, stdout: '{}\n', stderr: '' };
      },
    });

    await executor.runHappierText(['auth', 'status']);

    const firstCall = runRemoteText.mock.calls[0]?.[0];
    expect(String(firstCall?.remoteCommand ?? '')).toContain("HAPPIER_PUBLIC_RELEASE_CHANNEL='dev'");
    expect(String(firstCall?.remoteCommand ?? '')).toContain("HAPPIER_RELEASE_RING='dev'");
  });

  it('does not prefix scoping env vars for the stable lane', async () => {
    const runRemoteText = vi.fn<(remoteCommand: string) => Promise<void>>(async () => {});

    const executor = createOpenSshHappierJsonExecutor({
      ssh: { target: 'dev@example.test', auth: 'agent' },
      auth: { mode: 'agent' },
      knownHostsMode: 'app',
      channel: 'stable',
      runRemoteText: async ({ remoteCommand }) => {
        await runRemoteText(remoteCommand);
        return { status: 0, stdout: '{}\n', stderr: '' };
      },
    });

    await executor.runHappierText(['auth', 'status']);

    const cmd = String(runRemoteText.mock.calls[0]?.[0] ?? '');
    expect(cmd).not.toContain('HAPPIER_PUBLIC_RELEASE_CHANNEL');
    expect(cmd).not.toContain('HAPPIER_RELEASE_RING');
  });
});
