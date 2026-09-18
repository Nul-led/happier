import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildBackendTargetKeyV2 } from '@happier-dev/protocol';

const catalog = vi.hoisted(() => ({
  agentDefinitionsById: new Map<string, Readonly<{
    id: string;
    identity: Readonly<{ pluginId: string; localId: string }>;
  }>>(),
}));

vi.mock('@/agent/catalog/snapshot', () => ({
  readAgentCatalogSnapshot: () => ({
    agentDefinitionsById: catalog.agentDefinitionsById,
    catalogEntriesById: {},
    executionRunProfiles: [],
  }),
}));

import {
  areExecutionRunBackendTargetsEqual,
  resolveExecutionRunRuntimeBackendTarget,
} from './backendTargets';

const canonicalOpenCodeTargetKey = buildBackendTargetKeyV2({
  kind: 'agent',
  identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' },
});

describe('areExecutionRunBackendTargetsEqual', () => {
  beforeEach(() => {
    catalog.agentDefinitionsById.clear();
    catalog.agentDefinitionsById.set('opencode', {
      id: 'opencode',
      identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' },
    });
  });

  it('equates the canonical contributed-Agent key with its executable built-in target', () => {
    expect(areExecutionRunBackendTargetsEqual(
      canonicalOpenCodeTargetKey,
      { kind: 'builtInAgent', agentId: 'opencode' },
    )).toBe(true);
  });

  it.each([
    ['different Agent', 'agent:happier.agent.codex/codex'],
    ['malformed key', 'not-a-target-key'],
  ])('fails closed for a %s', (_label, candidate) => {
    expect(areExecutionRunBackendTargetsEqual(
      candidate as Parameters<typeof areExecutionRunBackendTargetsEqual>[0],
      { kind: 'builtInAgent', agentId: 'opencode' },
    )).toBe(false);
  });

  it('does not equate a configured target with the built-in Agent of the same backend family', () => {
    expect(areExecutionRunBackendTargetsEqual(
      canonicalOpenCodeTargetKey,
      { kind: 'configuredAcpBackend', backendId: 'opencode' },
    )).toBe(false);
  });
});

describe('resolveExecutionRunRuntimeBackendTarget', () => {
  beforeEach(() => {
    catalog.agentDefinitionsById.clear();
    catalog.agentDefinitionsById.set('opencode', {
      id: 'opencode',
      identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' },
    });
    catalog.agentDefinitionsById.set('acme-runtime-routing-id', {
      id: 'acme-runtime-routing-id',
      identity: { pluginId: 'acme.review-plugin', localId: 'review-agent' },
    });
  });

  it('resolves a canonical installed Agent identity to the retained runtime target', () => {
    expect(resolveExecutionRunRuntimeBackendTarget({
      kind: 'agent',
      identity: { pluginId: 'happier.agent.opencode', localId: 'opencode' },
    })).toEqual({ kind: 'builtInAgent', agentId: 'opencode' });
  });

  it('fails closed for a canonical Agent identity absent from the current catalog', () => {
    expect(resolveExecutionRunRuntimeBackendTarget({
      kind: 'agent',
      identity: { pluginId: 'missing.plugin', localId: 'missing-agent' },
    })).toBeNull();
  });

  it('gives a trusted external Agent the same catalog-based runtime resolution', () => {
    expect(resolveExecutionRunRuntimeBackendTarget({
      kind: 'agent',
      identity: { pluginId: 'acme.review-plugin', localId: 'review-agent' },
    })).toEqual({
      kind: 'builtInAgent',
      agentId: 'acme-runtime-routing-id',
    });
  });
});
