import { ingestPluginManifestV2 } from '@happier-dev/protocol';
import { describe, expect, it, vi } from 'vitest';

import { COPILOT_AGENT_SETTINGS_CONTRIBUTION } from './agentSettings/definition.js';
import { COPILOT_PLUGIN, PLUGIN_MANIFEST } from './manifest.js';

describe('Copilot plugin manifest', () => {
  it('uses the strict target manifest and declares its custom ACP handoff', () => {
    expect(ingestPluginManifestV2(PLUGIN_MANIFEST)).toMatchObject({ ok: true });
    expect(PLUGIN_MANIFEST).not.toHaveProperty('uses');
    expect(PLUGIN_MANIFEST).not.toHaveProperty('permissions');
    expect(PLUGIN_MANIFEST).not.toHaveProperty('activationEvents');
    expect(PLUGIN_MANIFEST).toMatchObject({ entrypoints: { daemon: './.happier-plugin/daemon.js' } });
    expect(PLUGIN_MANIFEST).not.toHaveProperty('activation');
    expect(PLUGIN_MANIFEST).toMatchObject({
      hostAccess: {
        required: [{
          id: 'copilot-process',
          capability: 'process',
          scope: {
            executables: [{ kind: 'systemTool', id: 'copilot-cli' }],
            envKeys: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
          },
        }],
        optional: [],
      },
      contributes: {
        agents: [{
          id: 'copilot', title: 'GitHub Copilot', primary: 'sessions',
          runtime: { kind: 'custom' },
          cli: {
            auth: {
              support: 'login_terminal',
              environmentVariables: ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'],
              credentialPaths: ['~/.copilot/config.json'],
              missingCredentialState: 'unknown',
              loginLaunches: [{ kind: 'primary', args: ['login'] }],
            },
          },
          capabilities: { sessions: { open: ['create', 'resume'], delivery: ['newTurn', 'followUp'], cancel: true } },
        }],
        systemTools: [{ id: 'copilot-cli', executableNames: ['copilot'] }],
        settings: [COPILOT_AGENT_SETTINGS_CONTRIBUTION],
      },
    });
  });

  it('does not register an unrelated GitHub CLI auth probe', async () => {
    const register = vi.fn();
    await COPILOT_PLUGIN.activate({ agents: { register } } as never);

    expect(register).toHaveBeenCalledWith('copilot', expect.any(Function), expect.not.objectContaining({
      cliAuth: expect.anything(),
    }));
  });
});
