import { describe, expect, it, vi } from 'vitest';

const { firstHandler, secondHandler, resolveMergedContributionRegistryMock } = vi.hoisted(() => ({
  firstHandler: vi.fn(async () => {}),
  secondHandler: vi.fn(async () => {}),
  resolveMergedContributionRegistryMock: vi.fn(async () => ({
    commands: [],
    catalogEntriesById: {
      first: {
        id: 'first',
        cliSubcommand: 'review-agent',
        getCliCommandHandler: async () => firstHandler,
      },
      second: {
        id: 'second',
        cliSubcommand: 'review-agent',
        getCliCommandHandler: async () => secondHandler,
      },
    },
    agentDefinitionsById: new Map(),
  })),
}));

vi.mock('@/configuration', () => ({
  configuration: { happyHomeDir: '/tmp/happier-test' },
}));

vi.mock('@/plugins/projection/registry/createResolvedContributionRegistry', () => ({
  resolveMergedContributionRegistry: resolveMergedContributionRegistryMock,
}));

import {
  ensureMergedAgentCommandRegistryLoaded,
  findCommandDispatchDescriptor,
} from './commandRegistry';

describe('commandRegistry Agent root collisions', () => {
  it('admits neither Agent when two declarations claim the same root', async () => {
    await ensureMergedAgentCommandRegistryLoaded();

    expect(findCommandDispatchDescriptor('review-agent')).toBeNull();
    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).not.toHaveBeenCalled();
  });
});
