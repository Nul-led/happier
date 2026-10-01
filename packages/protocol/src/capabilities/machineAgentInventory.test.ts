import { describe, expect, it } from 'vitest';

import {
  buildMachineAgentsDetectRequest,
  MachineAgentInventoryUnavailableError,
  projectMachineAgentsDetectResponse,
} from './index.js';

const agents = [{ agentId: 'antigravity', title: 'Antigravity' }, { agentId: 'acme/helper', title: 'Helper' }];
const facts = {
  installed: false, version: null, latestVersion: null,
  update: { supported: false, command: null },
  signIn: { status: 'unknown', loginSupport: 'manual_only' },
  platform: { supported: false, reason: 'arch' },
  install: { available: false, mode: 'none', sizeBytes: null, guideUrl: null },
  dependencies: [{ key: 'antigravity-acp', installed: true, version: '1.0' }],
} as const;

describe('machine Agent inventory projection', () => {
  it('requests complete native status and latest versions for every registry Agent', () => {
    expect(buildMachineAgentsDetectRequest({ agents, refresh: true })).toEqual({
      requests: agents.map(({ agentId }) => ({ id: `cli.${agentId}`, params: { includeLoginStatus: true, includeLatestVersion: true } })),
      bypassCache: true,
    });
    expect(buildMachineAgentsDetectRequest({ agents })).not.toHaveProperty('bypassCache');
  });

  it('preserves own CLI absence independently of installed dependencies and strips legacy probe metadata', () => {
    expect(projectMachineAgentsDetectResponse({
      agents: agents.slice(0, 1),
      response: { protocolVersion: 1, results: {
        'cli.antigravity': { ok: true, checkedAt: 1, data: {
          ...facts, available: true, resolvedPath: '/private/path', authStatus: { state: 'logged_in' }, installSource: 'system',
        } },
      } },
    })).toEqual({ items: [{ agentId: 'antigravity', title: 'Antigravity', ...facts }] });
  });

  it('rejects missing or legacy-only status instead of manufacturing readiness', () => {
    for (const results of [{}, { 'cli.antigravity': { ok: true as const, checkedAt: 1, data: { available: true } } }]) {
      expect(() => projectMachineAgentsDetectResponse({ agents: agents.slice(0, 1), response: { protocolVersion: 1, results } })).toThrow(MachineAgentInventoryUnavailableError);
    }
  });
});
