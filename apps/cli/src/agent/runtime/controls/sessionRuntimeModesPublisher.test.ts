import { describe, expect, it, vi } from 'vitest';
import { readSessionModesMetadata } from '@happier-dev/protocol';
import type { Metadata } from '@/api/types';
import { updateSessionMetadataWithAck } from '@/api/session/stateUpdates';
import { createNativeAgentSessionPublications } from '@/agent/runtime/registry/engineRegistry/nativeAgentSessionPublications';
import { createSessionRuntimeModesPublisher } from './sessionRuntimeModesPublisher';
import { createOpenCodeServerRuntimeAssembly } from '../../../../../../packages/plugins/opencode/src/agent/runtime/server/assembly';
import { createContextFixture } from '../../../../../../packages/plugins/opencode/src/agent/runtime/server/assembly.managedServices.testkit';

describe('native session modes publication', () => {
  it.each(['create', 'resume', 'resume-legacy', 'resume-unknown'] as const)('preserves V1 zero-turn modes using only a fresh native default, not staged intent (%s)', async (kind) => {
    let metadata: Metadata = { path: '/repo', host: 'localhost', homeDir: '/home/test', happyHomeDir: '/tmp/happier', happyLibDir: '/tmp/lib', happyToolsDir: '/tmp/tools',
      ...(kind === 'resume' ? { sessionModesV1: { v: 1 as const, agentId: 'opencode', updatedAt: 1, currentModeId: 'previous-accepted', availableModes: [] } } : {}),
      ...(kind === 'resume-legacy' ? { acpSessionModesV1: { v: 1 as const, agentId: 'opencode', updatedAt: 1, currentModeId: 'previous-accepted', availableModes: [] } } : {}) };
    let version = 1;
    const session = { getMetadataSnapshot: () => metadata, updateAgentState: async () => {}, updateMetadataAsCurrentPublisher: async (handler: (current: Metadata) => Metadata) => {
      // Conditional admitted-writer projection through the real ACK owner; admission is separate.
      await updateSessionMetadataWithAck({ sessionId: 'happi-v1-modes', sessionEncryptionMode: 'plain', handler,
        getMetadata: () => metadata, setMetadata: (next) => { if (next) metadata = next; },
        getMetadataVersion: () => version, setMetadataVersion: (next) => { version = next; }, syncSessionSnapshotFromServer: async () => {},
        socket: { emitWithAck: async (_event: string, payload: { metadata: string }) => ({ result: 'success', metadata: payload.metadata, version: version + 1 }) },
      });
    } };
    const publications = createNativeAgentSessionPublications({ agentId: 'opencode', session, signal: new AbortController().signal, isCurrent: () => true, supportsInFlightSteer: false });
    const projector = createSessionRuntimeModesPublisher({ agentId: 'opencode', session, source: publications.modesSource });
    const rows = [{ name: 'hidden', mode: 'primary', hidden: true }, { name: 'worker', mode: 'subagent' }, { name: 'custom-default', mode: 'primary' }, { name: 'build', mode: 'primary' }];
    let dispatchedAgent: string | null = null;
    const ctx = createContextFixture({ managedServerBaseUrl: 'http://127.0.0.1:49222', managedServerRequest: async (input) => {
      const path = input.pathAndQuery.split('?')[0];
      if (path === '/mcp' && input.method === 'POST' && input.body) {
        const registration = JSON.parse(new TextDecoder().decode(input.body));
        return { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: new Response(JSON.stringify({ [registration.name]: { status: 'connected' } })).body };
      }
      if (input.method === 'POST' && path === '/session/native-v1-modes/message' && input.body) dispatchedAgent = JSON.parse(new TextDecoder().decode(input.body)).agent;
      const data = path === '/session' ? { id: 'native-v1-modes' } : path === '/agent' ? rows : path === '/provider' ? { all: [] } : path === '/session/native-v1-modes/message' ? (input.method === 'POST' ? { id: 'native-user-v1' } : []) : { id: 'native-v1-modes' };
      return { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: new Response(JSON.stringify(data)).body };
    } });
    const assembly = await createOpenCodeServerRuntimeAssembly({ ctx, directory: '/repo', happierSessionId: 'happi-v1-modes', endpoint: { mode: 'managed-spawn' }, modes: publications.services.modes,
      mcpServers: { happier: { command: '/fixture/happier' } },
      request: kind === 'create' ? { kind, sessionId: 'happi-v1-modes', cwd: '/repo' } : { kind: 'resume', sessionId: 'happi-v1-modes', cwd: '/repo', providerSessionId: 'native-v1-modes' } });
    try {
      await projector.flush();
      expect(readSessionModesMetadata(metadata)?.availableModes.map((mode) => mode.id)).toEqual(rows.map((row) => row.name));
      const current = kind === 'create' ? 'custom-default' : kind === 'resume-unknown' ? null : 'previous-accepted';
      expect(readSessionModesMetadata(metadata)?.currentModeId).toBe(current);
      if (kind === 'resume-unknown') expect(metadata.sessionModesV1).toBeUndefined();
      if (!assembly.runtime.updateConfiguration) throw new Error('Configuration control unavailable');
      await expect(assembly.runtime.updateConfiguration({ mode: { value: 'build', updatedAtMs: 2 }, model: { value: null, updatedAtMs: 0 }, permissionIntent: { value: null, updatedAtMs: 0 }, options: {} })).resolves.toMatchObject({ status: 'deferred' });
      await projector.flush();
      expect(readSessionModesMetadata(metadata)?.currentModeId).toBe(current);
      await expect(assembly.runtime.send({ inputIds: ['native-control-proof'], input: { text: 'boundary-only fixture' }, delivery: { kind: 'newTurn', turnId: 'native-control-turn' } })).resolves.toEqual({ status: 'admitted' });
      await projector.flush();
      expect(dispatchedAgent).toBe('build');
      expect(metadata.sessionModesV1?.currentModeId).toBe('build');
    } finally { await assembly.runtime.dispose(); await projector.stopAndDrain(); publications.dispose(); }
  });
  it('projects native HTTP/SSE modes through the admitted host writer into canonical published mode options', async () => {
    // This proof begins after publisher admission. It exercises the real metadata ACK writer,
    // not the separate constructor/admission RPC. UI owner tests prove packet consumption.
    let metadata: Metadata = { path: '/repo', host: 'localhost', homeDir: '/home/test', happyHomeDir: '/tmp/happier', happyLibDir: '/tmp/lib', happyToolsDir: '/tmp/tools' };
    let version = 1;
    let wire: unknown;
    const session = {
      getMetadataSnapshot: () => metadata,
      updateAgentState: async () => {},
      updateMetadataAsCurrentPublisher: async (handler: (current: Metadata) => Metadata) => {
        await updateSessionMetadataWithAck({
          sessionId: 'happi-modes', sessionEncryptionMode: 'plain',
          getMetadata: () => metadata, setMetadata: (next) => { if (next) metadata = next; },
          getMetadataVersion: () => version, setMetadataVersion: (next) => { version = next; },
          syncSessionSnapshotFromServer: async () => {}, handler,
          socket: { emitWithAck: async (_event: string, payload: { metadata: string }) => {
            wire = JSON.parse(payload.metadata);
            return { result: 'success', metadata: payload.metadata, version: version + 1 };
          } },
        });
      },
    };
    const scope = new AbortController();
    const publications = createNativeAgentSessionPublications({ agentId: 'opencode', session, signal: scope.signal, isCurrent: () => true, supportsInFlightSteer: false });
    const projector = createSessionRuntimeModesPublisher({ agentId: 'opencode', session, source: publications.modesSource });
    const ids = ['build', 'plan', 'general', 'explore', 'compaction', 'title', 'summary'];
    let agents = ids.map((id) => ({ id, name: id }));
    let nativeMode = 'build';
    let rejectMode = false;
    const stream: { current: ReadableStreamDefaultController<Uint8Array> | null } = { current: null };
    const ctx = createContextFixture({ managedServerBaseUrl: 'http://127.0.0.1:49221', managedServerRequest: async (input) => {
      const path = input.pathAndQuery.split('?')[0];
      if (path === '/api/event') {
        return { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'text/event-stream' }, body: new ReadableStream<Uint8Array>({ start(controller) { stream.current = controller; controller.enqueue(new TextEncoder().encode('data: {"type":"server.connected","location":{"directory":"/repo"},"data":{}}\n\n')); input.signal?.addEventListener('abort', () => controller.close(), { once: true }); } }) };
      }
      let ok = true;
      if (path === '/api/session/native-modes/agent') {
        ok = !rejectMode;
        if (ok && input.body) nativeMode = JSON.parse(new TextDecoder().decode(input.body)).agent;
      }
      const data = path === '/api/session' ? { id: 'native-modes' }
        : path === '/api/session/native-modes' ? { id: 'native-modes', agent: nativeMode }
          : path === '/api/agent' ? agents : [];
      return { ok, status: ok ? 200 : 503, statusText: ok ? 'OK' : 'Service Unavailable', headers: { 'content-type': 'application/json' }, body: new Response(JSON.stringify({ data })).body };
    } });
    const assembly = await createOpenCodeServerRuntimeAssembly({
      ctx, directory: '/repo', happierSessionId: 'happi-modes', endpoint: { mode: 'managed-spawn' }, modes: publications.services.modes,
      request: { kind: 'create', sessionId: 'happi-modes', cwd: '/repo', configuration: { mode: { value: null, updatedAtMs: 0 }, model: { value: null, updatedAtMs: 0 }, permissionIntent: { value: null, updatedAtMs: 0 }, options: { opencodeCliGeneration: { value: 'v2', updatedAtMs: 1 } } } },
    });
    const options = () => readSessionModesMetadata(metadata)?.availableModes.map((mode) => mode.id) ?? [];
    try {
      await projector.flush();
      expect(options()).toEqual(ids);
      expect(wire).toMatchObject({ sessionModesV1: { agentId: 'opencode', currentModeId: 'build', availableModes: agents } });
      if (!assembly.runtime.updateConfiguration) throw new Error('Configuration control unavailable');
      const control = { mode: { value: 'plan', updatedAtMs: 2 }, model: { value: null, updatedAtMs: 0 }, permissionIntent: { value: null, updatedAtMs: 0 }, options: {} };
      rejectMode = true;
      await expect(assembly.runtime.updateConfiguration(control)).resolves.toMatchObject({ status: 'rejected' });
      await projector.flush();
      expect(metadata.sessionModesV1?.currentModeId).toBe('build');
      rejectMode = false;
      await expect(assembly.runtime.updateConfiguration(control)).resolves.toMatchObject({ status: 'applied' });
      await projector.flush();
      expect(metadata.sessionModesV1?.currentModeId).toBe('plan');
      expect(options()).toEqual(ids);
      agents = [];
      if (!stream.current) throw new Error('Provider stream unavailable');
      stream.current.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'agent.updated', location: { directory: '/repo' }, data: {} })}\n\n`));
      await vi.waitFor(() => expect(options()).toEqual([]));
      expect(metadata.sessionModesV1?.currentModeId).toBe('plan');
      await assembly.runtime.dispose();
      await projector.flush();
      expect(options()).toEqual([]);
      expect(publications.modesSource.read()).toEqual({ modes: null });
    } finally {
      await assembly.runtime.dispose();
      await projector.stopAndDrain();
      publications.dispose();
    }
  });
});
