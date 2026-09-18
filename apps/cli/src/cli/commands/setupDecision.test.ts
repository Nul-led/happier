import { describe, expect, it } from 'vitest';

import { buildSetupPlan } from './setupDecision';

const base = {
  serverUrl: 'https://home.example.test',
  includeAuth: false,
  forceWebAuthentication: false,
  includeDaemon: false,
  skipProviders: false,
  installedAgentIds: [] as readonly string[],
  providers: [] as readonly string[],
  assumeYes: false,
};

describe('buildSetupPlan agent setup decision', () => {
  it('does not offer optional agents when one is installed', () => {
    const plan = buildSetupPlan({ ...base, installedAgentIds: ['claude'] });

    expect(plan.steps.map((step) => step.id)).not.toContain('agents_setup');
  });

  it('honors an explicit agent selection even when another agent is installed', () => {
    const plan = buildSetupPlan({ ...base, installedAgentIds: ['claude'], providers: ['codex'] });

    expect(plan.steps).toContainEqual(expect.objectContaining({
      id: 'agents_setup',
      argv: ['agents', 'setup', '--provider', 'codex'],
    }));
  });

  it('keeps skip precedence over explicit agent selections', () => {
    const plan = buildSetupPlan({ ...base, skipProviders: true, providers: ['codex'] });

    expect(plan.steps.map((step) => step.id)).not.toContain('agents_setup');
  });
});
