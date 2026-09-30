import { describe, expect, it, vi } from 'vitest';

import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

const execute = vi.fn();
const createCliActionExecutorFromCredentials = vi.fn(() => ({ execute }));

vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials,
}));

describe('happier session send (action executor)', () => {
  it('routes through ActionExecutor with the expected action id and args', async () => {
    execute.mockResolvedValueOnce({
      ok: true,
      result: { ok: true, sessionId: 'sess-1', localId: 'local-1', waited: false },
    });

    const { handleSessionCommand } = await import('./handleSessionCommand');

    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand(['send', 'sess-1', 'Hello', '--permission-mode', 'read_only', '--model', 'gpt-4o', '--local-id', 'claim-1', '--wait', '--timeout', '30', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
        }),
      });

      expect(createCliActionExecutorFromCredentials).toHaveBeenCalledTimes(1);
      expect(execute).toHaveBeenCalledWith(
        'session.message.send',
        expect.objectContaining({
          sessionId: 'sess-1',
          message: 'Hello',
          permissionModeOverride: 'read-only',
          modelOverride: 'gpt-4o',
          localId: 'claim-1',
          wait: true,
          timeoutSeconds: 30,
        }),
        { surface: 'cli', defaultSessionId: null },
      );

      const parsed = output.json();
      expect(parsed).toEqual(expect.objectContaining({
        ok: true,
        kind: 'session_send',
        data: { sessionId: 'sess-1', localId: 'local-1', waited: false },
      }));
    } finally {
      output.restore();
    }
  });

  it.each(['--local-id', '--help', '--json'])('treats %s after the option terminator as the literal message', async (message) => {
    const readCredentialsFn = vi.fn(async () => null);
    const { handleSessionCommand } = await import('./handleSessionCommand');
    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand(['send', '--json', 'sess-1', '--', message], { readCredentialsFn });
      expect(readCredentialsFn).toHaveBeenCalledOnce();
      expect(output.json()).toMatchObject({ ok: false, error: { code: 'not_authenticated' } });
    } finally {
      output.restore();
    }
  });

  it('rejects a malformed timeout before reading credentials', async () => {
    const readCredentialsFn = vi.fn(async () => null);
    const { cmdSessionSend } = await import('./send');
    await expect(cmdSessionSend(['send', 'sess-1', 'Hello', '--timeout', '10oops'], { readCredentialsFn }))
      .rejects.toMatchObject({ code: 'invalid_arguments' });

    expect(readCredentialsFn).not.toHaveBeenCalled();
  });

  it('rejects a blank local id before sending', async () => {
    execute.mockClear();
    const readCredentialsFn = vi.fn(async () => null);
    const { cmdSessionSend } = await import('./send');
    await expect(cmdSessionSend(['send', 'sess-1', 'Hello', '--local-id', '  '], { readCredentialsFn }))
      .rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(readCredentialsFn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each(['--wait', '--timeout'])('rejects %s as a missing local id value', async (nextFlag) => {
    execute.mockClear();
    const readCredentialsFn = vi.fn(async () => null);
    const { cmdSessionSend } = await import('./send');
    await expect(cmdSessionSend(['send', 'sess-1', 'Hello', '--local-id', nextFlag], { readCredentialsFn }))
      .rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(readCredentialsFn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects the reserved transition local id before sending', async () => {
    execute.mockClear();
    const readCredentialsFn = vi.fn(async () => null);
    const { cmdSessionSend } = await import('./send');
    await expect(cmdSessionSend(['send', 'sess-1', 'Hello', '--local-id', 'agent-transition:claim-1'], { readCredentialsFn }))
      .rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(readCredentialsFn).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['uses the default timeout when --timeout is omitted', ['send', 'sess-1', 'Hello', '--json'], 300],
    ['clamps an explicit timeout to the supported maximum', ['send', 'sess-1', 'Hello', '--timeout', '9999', '--json'], 3600],
  ])('%s', async (_label, argv, expectedTimeoutSeconds) => {
    execute.mockResolvedValueOnce({
      ok: true,
      result: { ok: true, sessionId: 'sess-1', localId: 'local-1', waited: false },
    });
    const { cmdSessionSend } = await import('./send');

    const output = captureConsoleJsonOutput();
    try {
      await cmdSessionSend(argv, {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
        }),
      });

      expect(execute).toHaveBeenLastCalledWith(
        'session.message.send',
        expect.objectContaining({ timeoutSeconds: expectedTimeoutSeconds }),
        { surface: 'cli', defaultSessionId: null },
      );
    } finally {
      output.restore();
    }
  });

  it('prints approval_request_created as the JSON envelope data', async () => {
    execute.mockResolvedValueOnce({
      ok: true,
      result: { kind: 'approval_request_created', artifactId: 'approval-1' },
    });

    const { handleSessionCommand } = await import('./handleSessionCommand');

    const output = captureConsoleJsonOutput();
    try {
      await handleSessionCommand(['send', 'sess-1', 'Hello', '--json'], {
        readCredentialsFn: async () => ({
          token: 'token_test',
          encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
        }),
      });

      expect(output.json()).toEqual(expect.objectContaining({
        ok: true,
        kind: 'session_send',
        data: { kind: 'approval_request_created', artifactId: 'approval-1' },
      }));
    } finally {
      output.restore();
    }
  });
});
