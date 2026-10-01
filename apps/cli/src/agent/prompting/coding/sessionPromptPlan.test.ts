import { describe, expect, it } from 'vitest';
import { BUILT_IN_ROLES_V1 } from '@happier-dev/protocol';

import { createSessionPromptPlanResolver } from './sessionPromptPlan';

describe('session prompt-plan producer', () => {
  it('retains the full-plan identity and advances its revision only when composed instructions change', async () => {
    let notes = 'Initial worker boundary';
    const resolve = createSessionPromptPlanResolver({
      opts: {
        credentials: { token: 'test-session-token', encryption: null },
        agentSessionStartupInstructionsV1: {
          v: 1, id: 'voice.caller', revision: 9, instructions: 'Caller startup guidance',
        },
      },
      session: { sessionId: 'test-session', getMetadataSnapshot: () => null },
      agentId: 'codex', machineId: 'test-machine', directory: '/tmp/project',
      memoryRecallGuidanceEnabled: false,
      readNativeSessionId: () => 'native-conversation',
      resolveRoleContext: async () => ({
        role: { ...BUILT_IN_ROLES_V1.builder, roleId: 'builder' }, notes,
      }),
    });
    const first = await resolve({ baseOverride: 'Base instructions' });
    expect(first).toContain('Caller startup guidance');
    expect(first).toContain(BUILT_IN_ROLES_V1.builder.instructions);
    expect(first).toContain(notes);
    expect(resolve.readStartupInstructions?.()).toEqual({
      v: 1, id: 'happier.coding_session_plan', revision: 9, instructions: first,
    });
    await resolve({ baseOverride: 'Base instructions' });
    expect(resolve.readStartupInstructions?.()?.revision).toBe(9);

    notes = 'Revised worker boundary';
    const revised = await resolve({ baseOverride: 'Base instructions' });
    expect(revised).toContain(notes);
    expect(resolve.readStartupInstructions?.()).toEqual({
      v: 1, id: 'happier.coding_session_plan', revision: 10, instructions: revised,
    });
    notes = 'Initial worker boundary';
    expect(await resolve({ baseOverride: 'Base instructions' })).toBe(first);
    expect(resolve.readStartupInstructions?.()?.revision).toBe(11);
    await resolve({ baseOverride: 'Base instructions' });
    expect(resolve.readStartupInstructions?.()?.revision).toBe(11);
  });
});
