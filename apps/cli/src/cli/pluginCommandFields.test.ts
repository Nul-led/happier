import { describe, expect, it } from 'vitest';

import type {
  ResolvedActionContribution,
  ResolvedCommandContribution,
  ResolvedContributionRegistry,
} from '@/plugins/projection/registry/types';

import {
  resolvePluginCommandActionInputContract,
  resolvePluginCommandCompletionCandidates,
} from './pluginCommandFields';
import { resolvePluginCommandProjection } from './pluginCommandProjection';

function commandContribution(params: Readonly<{
  pluginId: string;
  id: string;
  path: readonly string[];
  actionId: string;
}>): ResolvedCommandContribution {
  return {
    provenance: 'external',
    source: { kind: 'path' },
    pluginId: params.pluginId,
    manifestPath: `/plugins/${params.pluginId}/plugin.json`,
    sourceSpec: {
      kind: 'path',
      locator: `/plugins/${params.pluginId}`,
      trustPolicy: 'local_trusted',
      installPolicy: 'link',
    },
    definition: {
      kindVersion: 1,
      id: params.id,
      title: `${params.pluginId} ${params.id}`,
      path: [...params.path],
      action: params.actionId.split('/').at(-1)!,
      actionId: params.actionId,
    },
  } as ResolvedCommandContribution;
}

function actionContribution(params: Readonly<{
  pluginId: string;
  id: string;
  inputSchema: unknown;
  inputHints?: unknown;
}>): ResolvedActionContribution {
  return {
    provenance: 'external',
    source: { kind: 'path' },
    pluginId: params.pluginId,
    definition: {
      kindVersion: 1,
      id: params.id,
      title: `${params.pluginId} ${params.id}`,
      safety: 'safe',
      placements: [],
      surfaces: {},
      sideEffectClass: 'write',
      inputSchema: params.inputSchema,
      ...(params.inputHints ? { inputHints: params.inputHints } : {}),
    },
  } as unknown as ResolvedActionContribution;
}

function registry(params: Readonly<{
  commands: readonly ResolvedCommandContribution[];
  actions: readonly ResolvedActionContribution[];
}>): ResolvedContributionRegistry {
  return {
    uiViewsV2: [],
    uiRenderersV2: [],
    uiTranslationsV2: [],
    agents: [],
    actions: params.actions,
    tools: [],
    commands: params.commands,
    resources: [],
    activationTargets: [],
    actionsById: new Map(),
    toolsById: new Map(),
    commandsById: new Map(params.commands.map((entry) => [`${entry.pluginId}/${entry.definition.id}`, entry])),
    resourcesById: new Map(),
    catalogEntriesById: {},
    agentDefinitionsById: new Map(),
    pluginDiagnosticsByPluginId: {},
  } as unknown as ResolvedContributionRegistry;
}

const NOTES_ADD = commandContribution({
  pluginId: 'acme.notes', id: 'add', path: ['notes', 'add'], actionId: 'acme.notes/add-note',
});

const NOTES_ADD_ACTION = actionContribution({
  pluginId: 'acme.notes',
  id: 'add-note',
  inputSchema: {
    type: 'object',
    properties: {
      value: { type: 'string' },
      pinned: { type: 'boolean' },
      priority: { type: 'string', enum: ['low', 'high'] },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' },
    },
    required: ['value'],
  },
  inputHints: { fields: [{ path: 'value', title: 'Note text', widget: 'text' }] },
});

describe('plugin command fields from the canonical contributed Action definition', () => {
  it('derives ordinary field flags from the Action definition, not the command contribution', () => {
    const fields = resolvePluginCommandActionInputContract({
      registry: registry({ commands: [NOTES_ADD], actions: [NOTES_ADD_ACTION] }),
      qualifiedActionId: 'acme.notes/add-note',
    })?.fields;
    expect(fields?.map((field) => `${field.flag}:${field.kind}`)).toEqual([
      '--value:string',
      '--pinned:boolean',
      '--priority:enum',
      '--tags:string_list',
      '--metadata:json',
    ]);
    expect(fields?.find((field) => field.path === 'value')?.title).toBe('Note text');
    expect(fields?.find((field) => field.path === 'priority')?.choices).toEqual(['low', 'high']);
  });

  it('derives the same field contract for bundled and external trusted plugins', () => {
    const externalRegistry = registry({ commands: [NOTES_ADD], actions: [NOTES_ADD_ACTION] });
    const { sourceSpec: _externalActionSourceSpec, ...actionWithoutSourceSpec } = NOTES_ADD_ACTION;
    void _externalActionSourceSpec;
    const bundledAction = {
      ...actionWithoutSourceSpec,
      provenance: 'first_party' as const,
      source: { kind: 'bundled' as const },
    } satisfies ResolvedActionContribution;
    const { sourceSpec: _externalCommandSourceSpec, ...commandWithoutSourceSpec } = NOTES_ADD;
    void _externalCommandSourceSpec;
    const bundledCommand = {
      ...commandWithoutSourceSpec,
      provenance: 'first_party' as const,
      source: { kind: 'bundled' as const },
    } satisfies ResolvedCommandContribution;
    const bundledRegistry = registry({ commands: [bundledCommand], actions: [bundledAction] });

    const external = resolvePluginCommandActionInputContract({
      registry: externalRegistry,
      qualifiedActionId: 'acme.notes/add-note',
    })?.fields;
    const bundled = resolvePluginCommandActionInputContract({
      registry: bundledRegistry,
      qualifiedActionId: 'acme.notes/add-note',
    })?.fields;
    expect(bundled).toEqual(external);
  });

  it('keeps the JSON-only adapter when no canonical definition is discoverable', () => {
    expect(resolvePluginCommandActionInputContract({
      registry: registry({ commands: [NOTES_ADD], actions: [] }),
      qualifiedActionId: 'acme.notes/add-note',
    })).toBeNull();
  });

  it('keeps an empty canonical Action input distinct from a missing Action definition', () => {
    const emptyAction = actionContribution({
      pluginId: 'acme.notes',
      id: 'add-note',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    });
    expect(resolvePluginCommandActionInputContract({
      registry: registry({ commands: [NOTES_ADD], actions: [emptyAction] }),
      qualifiedActionId: 'acme.notes/add-note',
    })?.fields).toEqual([]);
  });

  it('completes derived flags, static values, and the compatibility spelling from one Action owner', () => {
    const withDefinition = registry({ commands: [NOTES_ADD], actions: [NOTES_ADD_ACTION] });
    const fallback = Object.freeze(['--help', '--input', '--json']);
    const projection = resolvePluginCommandProjection({ registry: withDefinition, reservedRoots: new Set() });
    const derived = resolvePluginCommandCompletionCandidates({
      registry: withDefinition,
      projection,
      committed: ['notes', 'add'],
      prefix: '-',
      fallback,
    });
    expect(derived).toContain('--value');
    expect(derived).toContain('--no-pinned');
    expect(derived).toContain('--input-json');
    expect(derived).toContain('--input');

    expect(resolvePluginCommandCompletionCandidates({
      registry: withDefinition,
      projection,
      committed: ['notes', 'add', '--priority'],
      prefix: 'h',
      fallback,
    })).toEqual(['high']);

    expect(resolvePluginCommandCompletionCandidates({
      registry: withDefinition,
      projection,
      committed: ['notes', 'add', '--'],
      prefix: '-',
      fallback,
    })).toEqual([]);

    const withoutDefinition = registry({ commands: [NOTES_ADD], actions: [] });
    expect(resolvePluginCommandCompletionCandidates({
      registry: withoutDefinition,
      projection: resolvePluginCommandProjection({ registry: withoutDefinition, reservedRoots: new Set() }),
      committed: ['notes', 'add'],
      prefix: '-',
      fallback,
    })).toEqual(fallback);
  });

  it('projects compiler-owned Action field collisions without hiding the CLI-owned flags', () => {
    const collidingAction = actionContribution({
      pluginId: 'acme.notes',
      id: 'add-note',
      inputSchema: {
        type: 'object',
        properties: { input: { type: 'string' } },
      },
    });
    const contributionRegistry = registry({ commands: [NOTES_ADD], actions: [collidingAction] });
    expect(resolvePluginCommandCompletionCandidates({
      registry: contributionRegistry,
      projection: resolvePluginCommandProjection({ registry: contributionRegistry, reservedRoots: new Set() }),
      committed: ['notes', 'add'],
      prefix: '-',
      fallback: ['--help', '--input', '--json'],
    })).toEqual([
      '--action-input',
      '--action-input-json',
      '--help',
      '--input',
      '--input-json',
      '--json',
    ]);
  });
});
