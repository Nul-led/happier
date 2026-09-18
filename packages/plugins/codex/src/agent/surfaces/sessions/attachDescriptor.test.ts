import { describe, expect, it } from 'vitest';

import {
  createCodexAttachArgs,
  resolveCodexAttachReachability,
  resolveCodexAttachTarget,
} from './attachDescriptor.js';

describe('Codex shared attach descriptor', () => {
  it('targets the running app-server thread through its private local socket', () => {
    const target = resolveCodexAttachTarget({
      metadata: {
        path: '/repo',
        runtimeDescriptorV1: {
          v: 1,
          agentId: 'codex',
          agent: {
            backendMode: 'appServer',
            providerSessionId: 'thread-381',
            appServerEndpoint: 'unix:///tmp/happier-codex/app-server.sock',
          },
        },
      },
    });

    expect(target).toEqual({
      ok: true,
      value: {
        providerSessionId: 'thread-381',
        directory: '/repo',
        endpoint: 'unix:///tmp/happier-codex/app-server.sock',
        socketPath: '/tmp/happier-codex/app-server.sock',
      },
    });
    if (!target.ok) throw new Error('expected target');
    expect(createCodexAttachArgs(target.value)).toEqual([
      '--remote', 'unix:///tmp/happier-codex/app-server.sock',
      '--cd', '/repo',
      'resume', 'thread-381',
    ]);
    expect(resolveCodexAttachReachability(target.value)).toEqual({
      kind: 'localSocket',
      path: '/tmp/happier-codex/app-server.sock',
    });
  });
});
