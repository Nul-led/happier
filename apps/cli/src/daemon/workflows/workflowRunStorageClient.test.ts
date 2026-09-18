import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', () => ({ default: { post } }));

import { createWorkflowRunStorageClient } from './workflowRunStorageClient';

describe('workflow Run storage client', () => {
  beforeEach(() => post.mockReset());

  it('uses the incumbent signed Automation-worker HTTP corridor', async () => {
    post.mockResolvedValue({ data: { run: { id: 'run-1' } } });
    const createPublisherHeader = vi.fn(async () => 'signed-publisher');
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test', createPublisherHeader,
    });
    await expect(client.execute({ operation: 'get', runId: 'run-1' })).resolves.toEqual({ run: { id: 'run-1' } });
    const body = { operation: 'get', publisherMachineId: 'machine-1', runId: 'run-1' };
    expect(createPublisherHeader).toHaveBeenCalledWith({ method: 'POST', path: '/v3/automations/runs/workflow-storage', body });
    expect(post).toHaveBeenCalledWith('https://home.test/v3/automations/runs/workflow-storage', body, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token', 'x-happier-plugin-installation-manifest-publisher': 'signed-publisher' }),
    }));
  });

  it('leaves workflow waits to the authored deadline and caller abort owner', async () => {
    post.mockResolvedValue({ data: { observation: 'timeout' } });
    const controller = new AbortController();
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });

    await client.execute({ operation: 'wait', runId: 'run-1', timeoutSeconds: 45 }, { signal: controller.signal });

    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ timeout: 0, signal: controller.signal }),
    );
  });

  it('rejoins an ambiguous initialize with the byte-identical request only', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { initialization: 'existing' } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({ operation: 'initialize', runId: 'run-1', expectedRevision: 1,
      checkpointEnvelope: 'checkpoint', rootInvocation: { id: 'root-1', contentEnvelope: 'root' } }))
      .resolves.toEqual({ initialization: 'existing' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });

  it('rejoins an ambiguous direct admission with the byte-identical frozen request', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { kind: 'existing', run: { id: 'run-1' } } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({ operation: 'admit', runId: 'run-1', machineId: 'machine-1',
      origin: { kind: 'direct' }, acceptedEnvelope: 'frozen' }))
      .resolves.toMatchObject({ kind: 'existing' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });

  it('rejoins ambiguous Automation accepted-snapshot attachment with the byte-identical sealed candidate', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { disposition: 'existing', acceptedEnvelope: 'server-frozen' } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({
      operation: 'accepted-snapshot.resolve', runId: 'run-1', automationId: 'automation-1',
      expectedAttempt: 1, expectedRevision: 4, definitionEnvelope: 'definition',
      acceptedEnvelope: 'randomized-e2ee-candidate',
    })).resolves.toEqual({ disposition: 'existing', acceptedEnvelope: 'server-frozen' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });

  it('rejoins an ambiguous caller-bound invocation admission with byte-identical ids and envelopes', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { disposition: 'existing', parentRevision: 3, invocations: [] } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({
      operation: 'invocations.admit', runId: 'run-1', expectedRevision: 2,
      checkpointEnvelope: 'checkpoint-2',
      invocations: [{
        id: '7be4d65c-d3b7-4868-a416-b18d9ee29c1c', sequence: '1', parentRecordId: 'root-1',
        memberOrdinal: '0', contentEnvelope: 'bound-row',
      }],
    })).resolves.toMatchObject({ disposition: 'existing' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });

  it('rejoins an ambiguous caller-bound retry with byte-identical ids and envelopes', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { disposition: 'existing', run: { id: 'run-1' }, invocation: {} } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({
      operation: 'invocations.retry', runId: 'run-1', expectedRevision: 2,
      invocationId: '11111111-1111-4111-8111-111111111111',
      newInvocationId: '22222222-2222-4222-8222-222222222222',
      checkpointEnvelope: 'checkpoint-2', contentEnvelope: 'bound-retry-row',
    })).resolves.toMatchObject({ disposition: 'existing' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });

  it('rejoins an ambiguous caller-bound recovery with byte-identical ids and envelopes', async () => {
    post.mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }));
    post.mockResolvedValueOnce({ data: { disposition: 'existing', run: { id: 'run-1' }, invocations: [] } });
    const client = createWorkflowRunStorageClient({
      token: 'token', machineId: 'machine-1', serverHttpBaseUrl: 'https://home.test',
      createPublisherHeader: async () => 'signed-publisher',
    });
    await expect(client.execute({
      operation: 'invocations.recover', runId: 'run-1', expectedRevision: 2,
      recoveries: [{
        invocationId: '11111111-1111-4111-8111-111111111111',
        newInvocationId: '22222222-2222-4222-8222-222222222222',
        contentEnvelope: 'bound-retry-row',
      }],
    })).resolves.toMatchObject({ disposition: 'existing' });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toEqual(post.mock.calls[1]![1]);
  });
});
