import { getActionSpec } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ProjectedPluginToolCatalogEntry } from '@/plugins/runtime/toolCatalog';
import { bindContextualActionToolInput, projectSessionBoundActionToolInputSchema } from './actionToolContext';

describe('session-bound Action tool context', () => {
  it('binds the browser target to the invoking Happier session before input validation', () => {
    const schema = getActionSpec('browser.automation.snapshot').inputSchema;
    const input = {
      v: 1, automationRequestId: 'request', viewId: 'view', navigationGeneration: 0,
      requestedBy: 'agent', requesterRef: { kind: 'session', id: 'happier_session' },
      actionKind: 'snapshot', payload: {}, timeoutMs: 30_000,
    };
    const context = { defaultSessionId: 'happier_session' };
    const projected = projectSessionBoundActionToolInputSchema({
      actionId: 'browser.automation.snapshot', inputSchema: schema, context,
    }) as z.ZodType;
    expect(projected.safeParse(input).success).toBe(true);
    expect(schema.safeParse(bindContextualActionToolInput({
      actionId: 'browser.automation.snapshot', input, context,
    })).data).toMatchObject({ browserSessionId: 'happier_session', viewId: 'view' });
    expect(bindContextualActionToolInput({
      actionId: 'browser.automation.snapshot', input: { browserSessionId: 'explicit', viewId: 'view' }, context,
    })).toEqual({ browserSessionId: 'explicit', viewId: 'view' });
    expect(bindContextualActionToolInput({
      actionId: 'browser.recording.stop', input: { recordingId: 'recording' }, context,
    })).toEqual({ recordingId: 'recording' });
    expect(projectSessionBoundActionToolInputSchema({
      actionId: 'browser.automation.snapshot', inputSchema: schema, context: {},
    })).toBe(schema);
  });

  it('preserves explicit detached execution-run scope while binding only omitted scope', () => {
    expect(bindContextualActionToolInput({
      actionId: 'execution.run.start',
      input: { sessionId: null },
      context: { defaultSessionId: 'session_current' },
    })).toEqual({ sessionId: null });
    expect(bindContextualActionToolInput({
      actionId: 'execution.run.start',
      input: {},
      context: { defaultSessionId: 'session_current' },
    })).toEqual({ sessionId: 'session_current' });
  });

  it('optionalizes only the built-in fields whose declared host context is available', () => {
    const search = projectSessionBoundActionToolInputSchema({
      actionId: 'memory.search',
      inputSchema: getActionSpec('memory.search').inputSchema,
      context: { defaultSessionId: 'current-session', defaultSessionMachineId: 'machine-1' },
    }) as z.ZodType;
    const window = projectSessionBoundActionToolInputSchema({
      actionId: 'memory.get_window',
      inputSchema: getActionSpec('memory.get_window').inputSchema,
      context: { defaultSessionId: 'current-session', defaultSessionMachineId: 'machine-1' },
    }) as z.ZodType;

    expect(search.safeParse({
      query: { v: 1, query: 'handoff', scope: { type: 'global' }, mode: 'hints' },
    }).success).toBe(true);
    expect(window.safeParse({ seqFrom: 1, seqTo: 2 }).success).toBe(false);
    expect(window.safeParse({ sessionId: 'historical-session', seqFrom: 1, seqTo: 2 }).success).toBe(true);
  });

  it('projects the same contextual schema for a trusted plugin Action tool', () => {
    const pluginToolCatalog: readonly ProjectedPluginToolCatalogEntry[] = [{
      toolId: 'acme.memory/search-tool',
      actionId: 'acme.memory/search',
      name: 'acme_memory_search',
      title: 'Search Acme memory',
      description: 'Search memory.',
      inputSchema: {
        type: 'object',
        properties: { machineId: { type: 'string' }, query: { type: 'string' } },
        required: ['machineId', 'query'],
        additionalProperties: false,
      },
      contextualDefaults: { machineId: 'current_session_machine' },
      surfaces: ['agent'],
    }];

    expect(projectSessionBoundActionToolInputSchema({
      actionId: 'acme.memory/search',
      inputSchema: pluginToolCatalog[0]!.inputSchema,
      context: { defaultSessionMachineId: 'machine-1' },
      pluginToolCatalog,
    })).toMatchObject({ required: ['query'] });
  });
});
