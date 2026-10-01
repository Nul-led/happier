import { expect, it } from 'vitest';
import type { AgentSessionRuntimeContext } from '@happier-dev/plugin-sdk/agents/runtime';
import { createPiAgentRuntime } from './engine.js';

it('refuses a native startup plan before effects when the host cannot supply the Pi extension bridge', async () => {
  let nativeToolResolutions = 0;
  // Host Account observation and OS tool resolution are genuine system boundaries.
  // The no-plan control proves this fixture reaches the intended native boundary.
  const context = {
    signal: new AbortController().signal,
    services: {
      logger: { warn() {} },
      connectedAccounts: {
        watch(_purpose: string, listener: () => void) { listener(); return { dispose() {} }; },
        getBinding: async () => null,
      },
      exec: { systemTools: { resolve: async () => {
        nativeToolResolutions += 1;
        throw new Error('native-effect');
      } } },
    },
    session: { id: 'pi-startup', services: {} },
  } as unknown as AgentSessionRuntimeContext;
  await expect(createPiAgentRuntime().sessions.open({
    kind: 'resume', sessionId: 'pi-startup', providerSessionId: 'pi-native', cwd: '/workspace',
  }, context)).rejects.toThrow('native-effect');
  expect(nativeToolResolutions).toBe(1);
  await expect(createPiAgentRuntime().sessions.open({
    kind: 'resume', sessionId: 'pi-startup', providerSessionId: 'pi-native', cwd: '/workspace',
    startupInstructions: { v: 1, id: 'happier.coding_session_plan', revision: 2, instructions: 'New role and worker plan' },
  }, context)).rejects.toMatchObject({ code: 'agent_session_startup_instructions_unsupported' });
  expect(nativeToolResolutions).toBe(1);
});
