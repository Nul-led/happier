import { expect, it } from 'vitest';
import { ActionIdSchema } from './actionIds.js';
import { listActionSpecs } from './actionSpecs.js';

it('projects the single observation Action to CLI wait/watch and MCP', () => {
  expect(ActionIdSchema.safeParse('wait').success).toBe(true);
  const spec = listActionSpecs().find((entry) => entry.id === 'wait');
  expect(spec).toMatchObject({ sideEffectClass: 'read', bindings: { mcpToolName: 'wait' } });
  expect(spec?.cli?.commands.map((command) => command.path.join(' '))).toEqual(['wait', 'watch']);
});
