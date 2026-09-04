import { describe, expect, it, vi } from 'vitest';
import { captureConsoleText, captureStdout } from '@/testkit/logger/captureOutput';
import { handleAutomationCommand } from './automation';

describe('handleAutomationCommand', () => {
  it('lists automations with stable ids in human and JSON output', async () => {
    const listAutomationDefinitionsFn = vi.fn(async () => ({
      automations: [{
        id: 'automation-2',
        name: 'Nightly review',
        description: null,
        enabled: false,
        targetType: 'newSession' as const,
        existingSessionId: null,
        templateVersion: 1,
        lastRunAt: null,
        createdAt: 1,
        updatedAt: 2,
        assignments: [],
        triggers: [],
      }],
      nextCursor: null,
    }));
    const deps = {
      readCredentialsFn: async () => ({ token: 'token-1' } as never),
      listAutomationDefinitionsFn,
      runAutomationNowFn: vi.fn(),
    };

    const humanOutput = captureConsoleText();
    try {
      await handleAutomationCommand(['list'], deps);
      expect(humanOutput.text()).toContain('automation-2');
      expect(humanOutput.text()).toContain('Nightly review');
      expect(humanOutput.text()).toContain('paused');
    } finally {
      humanOutput.restore();
    }

    const jsonOutput = captureStdout();
    try {
      await handleAutomationCommand(['list', '--json'], deps);
      expect(JSON.parse(jsonOutput.text())).toMatchObject({
        ok: true,
        kind: 'automation_list',
        data: {
          automations: [{ id: 'automation-2', name: 'Nightly review', enabled: false }],
          nextCursor: null,
        },
      });
    } finally {
      jsonOutput.restore();
    }

    expect(listAutomationDefinitionsFn).toHaveBeenNthCalledWith(1, { token: 'token-1' });
    expect(listAutomationDefinitionsFn).toHaveBeenNthCalledWith(2, { token: 'token-1' });
  });

  it('forwards the opaque list cursor and prints the exact continuation command', async () => {
    const listAutomationDefinitionsFn = vi.fn(async () => ({
      automations: [],
      nextCursor: 'opaque_cursor-3',
    }));
    const deps = {
      readCredentialsFn: async () => ({ token: 'token-1' } as never),
      listAutomationDefinitionsFn,
      runAutomationNowFn: vi.fn(),
    };

    const humanOutput = captureConsoleText();
    try {
      await handleAutomationCommand(['list', '--cursor', 'opaque_cursor-2'], deps);
      expect(humanOutput.text()).toContain(
        'happier automation list --cursor opaque_cursor-3',
      );
    } finally {
      humanOutput.restore();
    }

    expect(listAutomationDefinitionsFn).toHaveBeenCalledWith({
      token: 'token-1',
      cursor: 'opaque_cursor-2',
    });
  });

  it.each([
    ['an unknown option', ['list', '--definitely-invalid']],
    ['a missing cursor', ['list', '--cursor']],
    ['a flag token used as the cursor', ['list', '--cursor', '--json']],
  ])('rejects %s before reading credentials', async (_label, args) => {
    const readCredentialsFn = vi.fn();
    await expect(handleAutomationCommand(args, {
      readCredentialsFn,
      listAutomationDefinitionsFn: vi.fn(),
      runAutomationNowFn: vi.fn(),
    })).rejects.toThrow();
    expect(readCredentialsFn).not.toHaveBeenCalled();
  });

  it('runs an automation through the canonical API with an optional idempotency key', async () => {
    const runAutomationNowFn = vi.fn(async () => ({
      id: 'run-1',
      automationId: 'automation-1',
      state: 'queued' as const,
    }));
    const output = captureStdout();
    try {
      await handleAutomationCommand(
        ['run', 'automation-1', '--idempotency-key', 'ci-build-42', '--json'],
        {
          readCredentialsFn: async () => ({ token: 'token-1' } as never),
          listAutomationDefinitionsFn: vi.fn(),
          runAutomationNowFn,
        },
      );
      expect(runAutomationNowFn).toHaveBeenCalledWith({
        token: 'token-1',
        automationId: 'automation-1',
        idempotencyKey: 'ci-build-42',
      });
      expect(JSON.parse(output.text())).toMatchObject({
        ok: true,
        kind: 'automation_run',
        data: { run: { id: 'run-1' } },
      });
    } finally {
      output.restore();
    }
  });

  it('rejects malformed run arguments before reading credentials', async () => {
    const readCredentialsFn = vi.fn();
    await expect(handleAutomationCommand(
      ['run', 'automation-1', '--idempotency-key'],
      { readCredentialsFn, listAutomationDefinitionsFn: vi.fn(), runAutomationNowFn: vi.fn() },
    )).rejects.toThrow(/idempotency-key/i);
    await expect(handleAutomationCommand(
      ['run', 'automation-1', '--idempotency-key', 'é'.repeat(96)],
      { readCredentialsFn, listAutomationDefinitionsFn: vi.fn(), runAutomationNowFn: vi.fn() },
    )).rejects.toThrow(/idempotency-key/i);
    expect(readCredentialsFn).not.toHaveBeenCalled();
  });
});
