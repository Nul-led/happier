import { describe, expect, it } from 'vitest';

import {
  MAX_PLUGIN_SEARCH_ITEMS_V1,
  MAX_PLUGIN_SEARCH_ITEM_COMMAND_UTF8_BYTES_V1,
  MAX_PLUGIN_SEARCH_QUERY_UTF8_BYTES_V1,
  PluginSearchProviderContributionV1Schema,
  PluginSearchQueryV1Schema,
  PluginSearchResultV1Schema,
} from './searchProviders.js';
import { PluginComposerReferenceProviderContributionV1Schema } from './composerReferenceProviders.js';
import { PluginContributesV2Schema } from './v2.js';
import { getPluginContributionCatalogEntryV2 } from './catalog.js';

const searchAction = Object.freeze({
  id: 'search',
  title: 'Search entries',
  scopes: ['global'],
  surfaces: ['ui'],
  placementBindings: [],
  dangerLevel: 'safe',
  execution: { target: 'daemon' },
  inputSchema: PluginSearchQueryV1Schema.jsonSchema,
  resultSchema: PluginSearchResultV1Schema.jsonSchema,
});

function contributes(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    actions: [searchAction],
    searchProviders: [{ id: 'entries', action: 'search' }],
    ...overrides,
  };
}

describe('searchProviders contribution family', () => {
  it('admits a descriptor referencing a safe, global, UI-origin read Action', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes());
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.searchProviders).toEqual([{ id: 'entries', action: 'search' }]);
  });

  it('keeps the descriptor minimal', () => {
    expect(PluginSearchProviderContributionV1Schema.safeParse({
      id: 'entries',
      action: 'search',
      keyword: 'pr',
    }).success).toBe(false);
  });

  it('refuses a descriptor whose Action is not declared by the same plugin', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      searchProviders: [{ id: 'entries', action: 'missing' }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('refuses a non-safe query Action', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      actions: [{
        ...searchAction,
        dangerLevel: 'writesLocal',
        confirmation: { title: 'Are you sure?' },
      }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('refuses a query Action without the global scope', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      actions: [{ ...searchAction, scopes: ['session'] }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('refuses a query Action without the UI origin', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      actions: [{ ...searchAction, surfaces: ['plugin'], placementBindings: undefined }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('refuses a query Action carrying an ordinary command placement', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      actions: [{ ...searchAction, placementBindings: ['commandPalette'] }],
    }));
    expect(parsed.success).toBe(false);
  });

  /**
   * Admission is eligibility, not schema comparison. The declared Action's own
   * dispatch validates its declared input, and the universal boundary parses
   * the returned result through the canonical schema below — so the manifest
   * owner never normalizes two JSON Schemas and compares them for equivalence.
   */
  it('does not admit or refuse a provider by comparing declared JSON Schemas', () => {
    expect(PluginContributesV2Schema.safeParse(contributes({
      actions: [{
        ...searchAction,
        inputSchema: {
          type: 'object',
          properties: { q: { type: 'string' } },
          additionalProperties: false,
        },
      }],
    })).success).toBe(true);
    expect(PluginContributesV2Schema.safeParse(contributes({
      actions: [{ ...searchAction, resultSchema: undefined }],
    })).success).toBe(true);
  });

  it('refuses duplicate provider ids', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      searchProviders: [{ id: 'entries', action: 'search' }, { id: 'entries', action: 'search' }],
    }));
    expect(parsed.success).toBe(false);
  });

  it('projects the family through the canonical contribution catalog', () => {
    const entry = getPluginContributionCatalogEntryV2('searchProviders');
    expect(entry?.projectionFamily).toBe('pluginUi');
    expect(entry?.allowedRuntimeRegistration).toBeNull();
    expect(entry?.references).toEqual([{ field: 'action', targetFamily: 'actions' }]);
    expect(entry?.extractReferences({ id: 'entries', action: 'search' })).toEqual([
      { targetFamily: 'actions', reference: 'search', path: ['action'] },
    ]);
  });
});

describe('plugin search query and result schemas', () => {
  it('is one composable owner an author declares and the host parses', () => {
    expect(PluginSearchQueryV1Schema.jsonSchema.type).toBe('object');
    expect(PluginSearchResultV1Schema.jsonSchema.type).toBe('object');
    expect(Object.keys(PluginSearchResultV1Schema.jsonSchema.properties ?? {}))
      .toEqual(['items', 'truncated']);
  });

  it('bounds the query and the requested row count', () => {
    expect(PluginSearchQueryV1Schema.safeParse({ query: 'pr', limit: 8 }).success).toBe(true);
    expect(PluginSearchQueryV1Schema.safeParse({ query: '', limit: 8 }).success).toBe(false);
    expect(PluginSearchQueryV1Schema.safeParse({
      query: 'a'.repeat(MAX_PLUGIN_SEARCH_QUERY_UTF8_BYTES_V1 + 1),
      limit: 8,
    }).success).toBe(false);
    expect(PluginSearchQueryV1Schema.safeParse({
      query: 'pr',
      limit: MAX_PLUGIN_SEARCH_ITEMS_V1 + 1,
    }).success).toBe(false);
    expect(PluginSearchQueryV1Schema.safeParse({ query: 'pr', limit: 8, scope: 'all' }).success).toBe(false);
  });

  /**
   * The bound counts UTF-8 bytes, not characters: a code-point bound would
   * admit a query three or four times over what the transport was measured for.
   */
  it('rejects an oversized multibyte query the character count would admit', () => {
    const emoji = '😀'.repeat(MAX_PLUGIN_SEARCH_QUERY_UTF8_BYTES_V1 / 4 + 1);
    expect(emoji.length).toBeLessThan(MAX_PLUGIN_SEARCH_QUERY_UTF8_BYTES_V1);
    expect(PluginSearchQueryV1Schema.safeParse({ query: emoji, limit: 8 }).success).toBe(false);
  });

  it('carries bounded host-renderable rows and the incumbent semantic command', () => {
    const parsed = PluginSearchResultV1Schema.safeParse({
      items: [{
        id: 'entry-1',
        title: 'Fix the crash',
        subtitle: 'happier/happier · open',
        icon: 'action',
        command: { kind: 'openSurface', destination: 'triage', input: { v: 1 }, subPath: '' },
      }],
      truncated: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.items[0]?.command).toEqual({
      kind: 'openSurface',
      destination: 'triage',
      input: { v: 1 },
      subPath: '',
    });
  });

  it('refuses arbitrary activation payloads, scores and unbounded results', () => {
    const item = {
      id: 'entry-1',
      title: 'Fix the crash',
      command: { kind: 'executeAction', action: 'open-entry' },
    };
    expect(PluginSearchResultV1Schema.safeParse({
      items: [{ ...item, url: 'https://example.invalid' }],
      truncated: false,
    }).success).toBe(false);
    expect(PluginSearchResultV1Schema.safeParse({
      items: [{ ...item, score: 0.5 }],
      truncated: false,
    }).success).toBe(false);
    expect(PluginSearchResultV1Schema.safeParse({ items: [item] }).success).toBe(false);
    expect(PluginSearchResultV1Schema.safeParse({
      items: Array.from({ length: MAX_PLUGIN_SEARCH_ITEMS_V1 + 1 }, (_unused, index) => ({
        ...item,
        id: `entry-${index}`,
      })),
      truncated: false,
    }).success).toBe(false);
    expect(PluginSearchResultV1Schema.safeParse({
      items: [{
        ...item,
        command: {
          kind: 'openSurface',
          destination: 'triage',
          input: { padding: 'x'.repeat(MAX_PLUGIN_SEARCH_ITEM_COMMAND_UTF8_BYTES_V1) },
        },
      }],
      truncated: false,
    }).success).toBe(false);
    expect(PluginSearchResultV1Schema.safeParse({
      items: [{ ...item, icon: 'not-a-token' }],
      truncated: false,
    }).success).toBe(false);
  });
});

describe('searchProviders is not composerReferences', () => {
  it('keeps the two families separate rather than overloading either', () => {
    // Composer references answer "what context should this message carry":
    // they declare trigger characters and resolve to model-facing text.
    const composerReference = { id: 'entries', title: 'Entries', icon: 'action', triggers: ['@'] };
    expect(PluginComposerReferenceProviderContributionV1Schema.safeParse(composerReference).success).toBe(true);
    // Search providers answer "which entities match what I typed": they carry
    // no trigger and no presentation of their own, only an Action reference.
    expect(PluginSearchProviderContributionV1Schema.safeParse(composerReference).success).toBe(false);
    expect(PluginComposerReferenceProviderContributionV1Schema.safeParse({
      id: 'entries',
      action: 'search',
    }).success).toBe(false);
  });

  it('admits both families side by side on one plugin', () => {
    const parsed = PluginContributesV2Schema.safeParse(contributes({
      composerReferences: [{ id: 'reference', title: 'Entries', icon: 'action', triggers: ['@'] }],
    }));
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.composerReferences).toHaveLength(1);
    expect(parsed.success && parsed.data.searchProviders).toHaveLength(1);
  });
});
