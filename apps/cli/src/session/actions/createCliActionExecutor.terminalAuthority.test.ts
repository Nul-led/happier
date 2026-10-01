import { describe, expect, it, vi } from 'vitest';

const policy = vi.hoisted(() => ({ value: 'allowed' as 'allowed' | 'disallowed' }));
vi.mock('@/configuration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/configuration')>();
  return {
    ...actual,
    configuration: {
      ...actual.configuration,
      get terminalPresentUserPolicy() { return policy.value; },
    },
  };
});

import { createCliActionExecutor } from './createCliActionExecutor';

describe('terminal Action authority', () => {
  it('admits CLI approval preparation only when the effective terminal policy allows it', async () => {
    const executor = createCliActionExecutor({
      token: 'terminal-policy-test',
      credentials: { token: 'terminal-policy-test', credentialProvenance: 'stored_session', encryption: null },
      sessionId: 'session-1',
      mode: 'plain',
      ctx: null,
      pluginActionExecutionOwner: 'current_process',
    });
    policy.value = 'disallowed';
    await expect(executor.prepare('approval.request.decide', {
      artifactId: 'artifact-1', decision: 'approve',
    }, { surface: 'cli', authority: 'present_user' })).resolves.toMatchObject({
      kind: 'settled', result: { ok: false, errorCode: 'present_user_required' },
    });
    // An Account/UI caller's server stamp is independent of this machine's CLI opt-out.
    expect((await executor.prepare('approval.request.decide', {
      artifactId: 'artifact-1', decision: 'approve',
    }, { surface: 'rpc', authority: 'present_user' })).kind).toBe('ready');
    await expect(executor.prepare('approval.request.decide', {
      artifactId: 'artifact-1', decision: 'approve',
    }, { surface: 'rpc' })).resolves.toMatchObject({
      kind: 'settled', result: { ok: false, errorCode: 'present_user_required' },
    });
    policy.value = 'allowed';
    const admitted = await executor.prepare('approval.request.decide', {
      artifactId: 'artifact-1', decision: 'approve',
    }, { surface: 'cli' });
    expect(admitted.kind).toBe('ready');
  });
});
