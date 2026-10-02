import { describe, expect, it } from 'vitest';

import {
  DaemonPluginInvocationLogReadRequestV1Schema,
  DaemonPluginInvocationLogReadResponseV1Schema,
  PluginInvocationLogRecordV1Schema,
} from './pluginInvocationLogs.js';

describe('daemon plugin invocation log RPC contract', () => {
  it('reads current occurrence-stamped diagnostics and carries a replacement-aware follow cursor', () => {
    expect(PluginInvocationLogRecordV1Schema.safeParse({
      version: 1, kind: 'plugin_invocation_log', level: 'info', message: 'arrived',
      context: {
        plugin: { id: 'acme.example', version: '1' },
        contribution: { id: 'run', qualifiedId: 'acme.example/run' },
        occurrenceId: 'occurrence-1', correlationId: 'correlation-1', surface: 'cli',
      },
      occurredAtMs: 1, sequence: 1,
    }).success).toBe(true);
    expect(DaemonPluginInvocationLogReadRequestV1Schema.safeParse({
      version: 1, target: { serverIdentityId: 'srv_plugin_logs', machineId: 'machine-logs' },
      query: { pluginId: 'acme.example', occurrenceId: 'occurrence-1', cursor: 42, logId: 'active-log' },
      waitForChanges: true,
    }).success).toBe(true);
    expect(DaemonPluginInvocationLogReadResponseV1Schema.safeParse({
      version: 1, kind: 'available', records: [], cursor: 0, hasMore: false,
      logId: 'replacement-log', cursorReset: true,
    }).success).toBe(true);
  });
  it('rejects a structured message above its UTF-8 byte bound', () => {
    expect(PluginInvocationLogRecordV1Schema.safeParse({
      version: 1,
      kind: 'plugin_invocation_log',
      level: 'error',
      message: '🙂'.repeat(1_025),
      context: {
        plugin: { id: 'acme.example', version: '1.0.0' },
        contribution: { id: 'run', qualifiedId: 'acme.example/actions/run' },
        occurrenceId: '1', correlationId: 'correlation-1', surface: 'cli',
      },
      occurredAtMs: 1,
      sequence: 1,
    }).success).toBe(false);
  });

  it('accepts only one bounded host-stamped exact-machine read shape', () => {
    const request = {
      version: 1,
      target: {
        serverIdentityId: 'srv_plugin_logs',
        machineId: 'machine-logs',
      },
      query: {
        pluginId: 'acme.example',
        occurrenceId: 'generation-1',
        correlationId: 'correlation-1',
        cursor: 0,
        limit: 500,
      },
    };

    expect(DaemonPluginInvocationLogReadRequestV1Schema.safeParse(request).success).toBe(true);
    expect(DaemonPluginInvocationLogReadRequestV1Schema.safeParse({
      ...request,
      target: { ...request.target, unexpected: true },
    }).success).toBe(false);
    expect(DaemonPluginInvocationLogReadRequestV1Schema.safeParse({
      ...request,
      target: { ...request.target, serverIdentityId: 'other-server' },
    }).success).toBe(false);
    expect(DaemonPluginInvocationLogReadRequestV1Schema.safeParse({
      ...request,
      query: { ...request.query, limit: 501 },
    }).success).toBe(false);
  });

  it('keeps unavailable outcomes typed and strict', () => {
    expect(DaemonPluginInvocationLogReadResponseV1Schema.safeParse({
      version: 1,
      kind: 'unavailable',
      code: 'plugin_log_target_mismatch',
    }).success).toBe(true);
    expect(DaemonPluginInvocationLogReadResponseV1Schema.safeParse({
      version: 1,
      kind: 'unavailable',
      code: 'unknown',
    }).success).toBe(false);
  });
});
