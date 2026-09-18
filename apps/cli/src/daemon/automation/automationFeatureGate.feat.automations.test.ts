import { describe, expect, it } from 'vitest';

import { getAutomationWorkerFeatureDecision, isAutomationWorkerEnabled } from './automationFeatureGate';
import { getWorkflowRuntimeFeatureDecision, isWorkflowRuntimeEnabled } from './workflowFeatureGate';

describe('isAutomationWorkerEnabled', () => {
  it('defaults to enabled when env is unset', () => {
    expect(isAutomationWorkerEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });

  it('supports explicit disabled values', () => {
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: 'no' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('supports explicit enabled values', () => {
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(isAutomationWorkerEnabled({ HAPPIER_FEATURE_AUTOMATIONS__ENABLED: 'yes' } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('respects build policy deny list', () => {
    expect(
      isAutomationWorkerEnabled({
        HAPPIER_FEATURE_AUTOMATIONS__ENABLED: '1',
        HAPPIER_BUILD_FEATURES_DENY: 'automations',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});

describe('Workflow runtime activation', () => {
  it('fails closed when the server bit is missing or malformed', () => {
    const ready = (features: unknown) => ({ status: 'ready' as const, features: features as never });
    expect(isWorkflowRuntimeEnabled({} as NodeJS.ProcessEnv, ready({ features: { automations: { enabled: true } }, capabilities: {} }))).toBe(false);
    expect(isWorkflowRuntimeEnabled({} as NodeJS.ProcessEnv, ready({ features: { automations: { enabled: true }, workflows: { enabled: 'yes' } }, capabilities: {} }))).toBe(false);
  });

  it('requires the canonical Workflow bit and its Automations dependency', () => {
    const ready = (automations: boolean, workflows: boolean) => ({
      status: 'ready' as const,
      features: { features: { automations: { enabled: automations }, workflows: { enabled: workflows } }, capabilities: {} } as never,
    });
    expect(isWorkflowRuntimeEnabled({} as NodeJS.ProcessEnv, ready(true, true))).toBe(true);
    expect(isWorkflowRuntimeEnabled({} as NodeJS.ProcessEnv, ready(false, true))).toBe(false);
    expect(getWorkflowRuntimeFeatureDecision({} as NodeJS.ProcessEnv, ready(false, true)).blockedBy).toBe('dependency');
  });
});

describe('getAutomationWorkerFeatureDecision', () => {
  it('reports build_policy block when denied', () => {
    const decision = getAutomationWorkerFeatureDecision({
      HAPPIER_FEATURE_AUTOMATIONS__ENABLED: '1',
      HAPPIER_BUILD_FEATURES_DENY: 'automations',
    } as NodeJS.ProcessEnv);

    expect(decision.featureId).toBe('automations');
    expect(decision.state).toBe('disabled');
    expect(decision.blockedBy).toBe('build_policy');
    expect(decision.blockerCode).toBe('build_disabled');
  });
});
