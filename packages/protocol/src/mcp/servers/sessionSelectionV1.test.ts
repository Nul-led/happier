import { describe, expect, it } from 'vitest';

import {
  areSessionMcpSelectionsEquivalent,
  readSessionMcpSelectionRestartRequiredV1FromMetadata,
  readSessionMcpSelectionV1FromMetadata,
  SessionMcpSelectionV1Schema,
} from './sessionSelectionV1.js';

describe('SessionMcpSelectionV1Schema', () => {
  it('retains permissive normalization for legacy Session selection ingress', () => {
    expect(SessionMcpSelectionV1Schema.parse('legacy-invalid-selection')).toEqual({
      v: 1,
      managedServersEnabled: true,
      forceIncludeServerIds: [],
      forceExcludeServerIds: [],
    });
    expect(SessionMcpSelectionV1Schema.parse({ legacyUnknownField: true })).toEqual({
      v: 1,
      managedServersEnabled: true,
      forceIncludeServerIds: [],
      forceExcludeServerIds: [],
    });
  });

  it('defaults to enabled managed servers with empty include/exclude lists', () => {
    const parsed = SessionMcpSelectionV1Schema.parse({});
    expect(parsed).toEqual({
      v: 1,
      managedServersEnabled: true,
      forceIncludeServerIds: [],
      forceExcludeServerIds: [],
    });
  });

  it('deduplicates include and exclude server ids', () => {
    const parsed = SessionMcpSelectionV1Schema.parse({
      v: 1,
      managedServersEnabled: false,
      forceIncludeServerIds: ['server-a', 'server-a', 'server-b'],
      forceExcludeServerIds: ['server-c', 'server-c'],
    });

    expect(parsed.forceIncludeServerIds).toEqual(['server-a', 'server-b']);
    expect(parsed.forceExcludeServerIds).toEqual(['server-c']);
  });

  it('reads a valid session MCP selection from metadata', () => {
    const selection = readSessionMcpSelectionV1FromMetadata({
      path: '/repo',
      mcpSelectionV1: {
        v: 1,
        managedServersEnabled: false,
        forceIncludeServerIds: ['server-a', 'server-a'],
        forceExcludeServerIds: ['server-b'],
      },
    });

    expect(selection).toEqual({
      v: 1,
      managedServersEnabled: false,
      forceIncludeServerIds: ['server-a'],
      forceExcludeServerIds: ['server-b'],
    });
  });

  it('compares effective behavior and reads the applied-selection marker', () => {
    const appliedSelection = {
      v: 1 as const,
      managedServersEnabled: false,
      forceIncludeServerIds: ['server-b', 'excluded', 'server-a'],
      forceExcludeServerIds: ['excluded'],
    };
    expect(areSessionMcpSelectionsEquivalent(appliedSelection, {
      ...appliedSelection,
      forceIncludeServerIds: ['server-a', 'server-b'],
    })).toBe(true);
    expect(readSessionMcpSelectionRestartRequiredV1FromMetadata({
      mcpSelectionRestartRequiredV1: { v: 1, appliedSelection },
    })).toEqual({
      v: 1,
      appliedSelection: {
        ...appliedSelection,
        forceIncludeServerIds: ['server-b', 'excluded', 'server-a'],
      },
    });
  });
});
