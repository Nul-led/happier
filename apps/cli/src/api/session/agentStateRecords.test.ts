import { describe, expect, it } from 'vitest';

import type { AgentState } from '@/api/types';

import { applyAgentStatePublishedRequest, applyAgentStateRequestPushNotifiedAt, cloneStringKeyedRecordToNullProto } from './agentStateRecords';

describe('agentStateRecords', () => {
  it('keeps the request creation time when a permission request is mirrored again', () => {
    const first = applyAgentStatePublishedRequest({
      state: {}, requestId: 'permission-1', toolName: 'Read', toolArguments: {},
      createdAtMs: 10, kind: 'read', source: 'acp',
    });
    const second = applyAgentStatePublishedRequest({
      state: first, requestId: 'permission-1', toolName: 'Read', toolArguments: {},
      createdAtMs: 20, kind: 'read', source: 'acp',
    });
    expect(second.requests?.['permission-1']?.createdAt).toBe(10);
  });
  it('clones records to null-prototype objects (including __proto__ keys)', () => {
    const input = JSON.parse('{"a":1,"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const cloned = cloneStringKeyedRecordToNullProto(input);
    expect(Object.getPrototypeOf(cloned)).toBe(null);
    expect(cloned.a).toBe(1);
    expect((cloned as any)['__proto__']).toEqual({ polluted: true });
  });

  it('applies pushNotifiedAt without prototype mutation for __proto__ request ids', () => {
    const state: AgentState = {
      capabilities: {},
      requests: JSON.parse('{"__proto__":{"tool":"Write","arguments":{},"createdAt":1}}'),
      completedRequests: {},
    } as any;

    const next = applyAgentStateRequestPushNotifiedAt({ state, permissionId: '__proto__', notifiedAtMs: 123 });
    expect(Object.getPrototypeOf(next.requests as any)).toBe(null);
    expect(((next.requests as any)['__proto__'] as any).pushNotifiedAt).toBe(123);
    expect(({} as any).polluted).toBeUndefined();
  });
});
