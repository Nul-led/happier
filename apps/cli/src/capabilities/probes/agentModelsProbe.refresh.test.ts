import { afterEach, expect, it } from 'vitest';
import type { AgentCatalogEntry } from '@/agent/catalog/types';
import { probeAgentModelsBestEffort, resetAgentModelsProbeCacheForTests } from './agentModelsProbe';

afterEach(resetAgentModelsProbeCacheForTests);

it('refreshes a contributed Agent catalog once, retaining its last observation after failure', async () => {
  let models: unknown = [{ id: 'old', name: 'Old' }];
  let probes = 0;
  // An independently contributed plugin supplies this boundary; normalization and cache remain real.
  const catalogEntry = {
    id: 'example.models/agent', cliSubcommand: 'example.models/agent', vendorResumeSupport: 'unsupported',
    getPreflightSessionControlsProbeAdapter: async () => ({
      probeModelsRaw: async () => { probes += 1; return models; },
    }),
  } satisfies AgentCatalogEntry;
  const params = { agentId: catalogEntry.id, catalogEntry, cwd: process.cwd() };
  const initial = await probeAgentModelsBestEffort(params);
  expect(initial.availableModels.map(model => model.id)).toEqual(['default', 'old']);
  models = [{ id: 'new', name: 'New' }];
  expect(await probeAgentModelsBestEffort(params)).toEqual(initial);
  const [fresh, shared] = await Promise.all([
    probeAgentModelsBestEffort({ ...params, bypassCache: true }),
    probeAgentModelsBestEffort({ ...params, bypassCache: true }),
  ]);
  expect(fresh.availableModels.map(model => model.id)).toEqual(['default', 'new']);
  expect(shared).toEqual(fresh);
  expect(probes).toBe(2);
  models = null;
  const failed = await probeAgentModelsBestEffort({ ...params, bypassCache: true });
  expect(failed).toMatchObject({ refreshError: true, cacheable: false, observedAt: fresh.observedAt,
    availableModels: fresh.availableModels });
  expect(await probeAgentModelsBestEffort(params)).toEqual(failed);
  models = [];
  expect(await probeAgentModelsBestEffort({ ...params, bypassCache: true })).toMatchObject({
    source: 'dynamic', availableModels: [],
  });
});

it('preserves observation provenance and keeps last good dynamic rows over a degraded local catalog', async () => {
  let observation: unknown = { availableModels: [{ id: 'local', name: 'Local model' }], source: 'static', refreshError: true };
  const catalogEntry = {
    id: 'example.provenance/agent', cliSubcommand: 'example.provenance/agent', vendorResumeSupport: 'unsupported',
    getPreflightSessionControlsProbeAdapter: async () => ({ probeModelsRaw: async () => observation }),
  } satisfies AgentCatalogEntry;
  const params = { agentId: catalogEntry.id, catalogEntry, cwd: process.cwd(), bypassCache: true };
  const cold = await probeAgentModelsBestEffort(params);
  expect(cold).toMatchObject({ source: 'static', refreshError: true, cacheable: false,
    availableModels: expect.arrayContaining([{ id: 'local', name: 'Local model' }]) });
  expect(cold.observedAt).toBeUndefined();
  observation = { availableModels: [{ id: 'current', name: 'Current model' }], source: 'dynamic', observedAt: 42 };
  const current = await probeAgentModelsBestEffort(params);
  expect(current).toMatchObject({ source: 'dynamic', observedAt: 42,
    availableModels: expect.arrayContaining([{ id: 'current', name: 'Current model' }]) });
  observation = { availableModels: [{ id: 'local', name: 'Local model' }], source: 'static', refreshError: true };
  expect(await probeAgentModelsBestEffort(params)).toMatchObject({ source: 'dynamic', observedAt: 42,
    refreshError: true, cacheable: false, availableModels: current.availableModels });
});
