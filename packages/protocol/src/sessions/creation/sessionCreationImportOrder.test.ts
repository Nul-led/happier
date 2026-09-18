import { describe, expect, it, vi } from 'vitest';

async function importCreationAfterAutomation() {
  await import('../../automations/automationRunExecutionRecipeV1.js');
  const spawn = await import('./sessionSpawnNewInputV2.js');
  const preparation = await import('./sessionCreationTargetPreparationV1.js');
  return { spawn, preparation };
}

async function importCreationSettlementAfterActionSpecs() {
  await import('../../actions/actionSpecs.js');
  return await import('./sessionSpawnNewResultV1.js');
}

async function importAutomationAfterCreation() {
  const preparation = await import('./sessionCreationTargetPreparationV1.js');
  const spawn = await import('./sessionSpawnNewInputV2.js');
  await import('../../automations/automationRunExecutionRecipeV1.js');
  return { spawn, preparation };
}

describe('Session creation source import order', () => {
  it('initializes creation schemas after the Automation recipe graph', async () => {
    vi.resetModules();
    const { spawn, preparation } = await importCreationAfterAutomation();
    expect(spawn.SessionAuthoringCheckoutCreationDraftV1Schema).toBeDefined();
    expect(spawn.SessionServerStartSpawnDraftV1Schema).toBeDefined();
    expect(preparation.SessionCreationTargetPreparationRequestV1Schema).toBeDefined();
  });

  it('initializes the Automation recipe graph after creation schemas', async () => {
    vi.resetModules();
    const { spawn, preparation } = await importAutomationAfterCreation();
    expect(spawn.SessionAuthoringCheckoutCreationDraftV1Schema).toBeDefined();
    expect(spawn.SessionServerStartSpawnDraftV1Schema).toBeDefined();
    expect(preparation.SessionCreationTargetPreparationRequestV1Schema).toBeDefined();
  });

  it('initializes creation settlement after the Action-spec graph', async () => {
    vi.resetModules();
    const settlement = await importCreationSettlementAfterActionSpecs();
    expect(settlement.SessionSpawnNewResultV1Schema).toBeDefined();
  }, 30_000);
});
