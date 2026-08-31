import type { PluginInvocationContext } from '@happier-dev/plugin-sdk';
import { createTriageSourceV1Fixture } from '@happier-dev/triage-protocol/testing/v1';
import { describe, expect, it, vi } from 'vitest';

import {
  deriveTriageConfiguredSourceInstanceDigestV1,
  readCurrentTriageConfiguredSourceInstanceV1,
} from './configuredSourceCurrentness.js';

describe('configured source currentness', () => {
  it('returns only one exact active configured generation from a complete target read', async () => {
    const instance = createTriageSourceV1Fixture().configuredInstance;
    const execute = vi.fn(async () => ({
      kind: 'read' as const,
      status: 'complete' as const,
      instances: [
        { v: 1 as const, lifecycle: 'retired' as const, configured: instance },
        { v: 1 as const, lifecycle: 'active' as const, configured: instance },
      ],
    }));
    const context = {
      signal: new AbortController().signal,
      services: { actions: { execute } },
    } as unknown as PluginInvocationContext;

    await expect(readCurrentTriageConfiguredSourceInstanceV1({
      context,
      sourceInstanceId: instance.instance.sourceInstanceId,
      instanceDigest: deriveTriageConfiguredSourceInstanceDigestV1(instance),
    })).resolves.toEqual({ kind: 'current', instance });
  });

  it('fails closed for a partial answer, changed generation, or duplicate active authority', async () => {
    const instance = createTriageSourceV1Fixture().configuredInstance;
    const digest = deriveTriageConfiguredSourceInstanceDigestV1(instance);
    const execute = vi.fn();
    const context = {
      signal: new AbortController().signal,
      services: { actions: { execute } },
    } as unknown as PluginInvocationContext;
    const read = () => readCurrentTriageConfiguredSourceInstanceV1({
      context,
      sourceInstanceId: instance.instance.sourceInstanceId,
      instanceDigest: digest,
    });

    execute.mockResolvedValueOnce({ kind: 'read', status: 'truncated', instances: [] });
    await expect(read()).resolves.toEqual({ kind: 'unavailable' });
    execute.mockResolvedValueOnce({ kind: 'read', status: 'complete', instances: [] });
    await expect(read()).resolves.toEqual({ kind: 'changed' });
    execute.mockResolvedValueOnce({
      kind: 'read',
      status: 'complete',
      instances: [
        { v: 1, lifecycle: 'active', configured: instance },
        { v: 1, lifecycle: 'active', configured: instance },
      ],
    });
    await expect(read()).resolves.toEqual({ kind: 'changed' });
  });
});
