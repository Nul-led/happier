import { expect, it } from 'vitest';
import { resolveProbeBackendContext } from './capabilitiesProbeContext';

it('accepts only a canonical runtime descriptor belonging to the requested Agent', async () => {
  const runtimeDescriptorV1 = { v: 1, agentId: 'example.models/agent', agent: { variant: 'session' } };
  await expect(resolveProbeBackendContext({ agentId: 'example.models/agent', runtimeDescriptorV1 }))
    .resolves.toMatchObject({ runtimeDescriptorV1 });
  await expect(resolveProbeBackendContext({ agentId: 'another.models/agent', runtimeDescriptorV1 }))
    .rejects.toThrow();
  await expect(resolveProbeBackendContext({ agentId: 'example.models/agent', runtimeDescriptorV1: { v: 1 } }))
    .rejects.toThrow();
});
