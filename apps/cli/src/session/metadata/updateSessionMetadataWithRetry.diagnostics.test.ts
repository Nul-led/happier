import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/ui/logger';
import { readSessionMetadataTupleWriterSnapshot, updateSessionMetadataEnvelopeTupleWithRetry } from './updateSessionMetadataWithRetry';

const credentials = { token: 'private-fixture-token', encryption: null };
const accountEncryptionCurrentness = { mode: 'plain' as const, version: 1, signingKeyFingerprint: null, contentKeyFingerprint: null, updatedAt: 1, recipientEnvelopeReadiness: { status: 'unavailable' as const, reason: 'plain_account' as const } };

function createRequest() {
  const initialSnapshot = readSessionMetadataTupleWriterSnapshot({ credentials, accountEncryptionCurrentness, rawSession: {
    metadataLayoutVersion: 0, encryptionMode: 'plain', metadata: JSON.stringify({ path: '/private/workspace', host: 'host' }), metadataVersion: 4, ownerMetadata: null, agentState: null, agentStateVersion: 2,
  } });
  return { token: credentials.token, sessionId: 'diagnostic-session', authority: { kind: 'owner' as const, credentials, accountEncryptionCurrentness }, mode: 'plain' as const, initialSnapshot,
    mutation: { kind: 'metadata' as const, update: (metadata: typeof initialSnapshot.value.metadata) => ({ ...metadata, name: 'private-title' }) } };
}

describe('metadata tuple terminal diagnostics', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reports terminal failure once at the canonical tuple writer without logging secrets or changing the snapshot', async () => {
    const failure = new Error('private-transport-response');
    const patch = vi.spyOn(axios, 'patch').mockRejectedValue(failure);
    const info = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const request = createRequest();
    const before = JSON.stringify(request.initialSnapshot);
    await expect(updateSessionMetadataEnvelopeTupleWithRetry(request)).rejects.toBe(failure);
    expect(patch).toHaveBeenCalledOnce();
    expect(JSON.stringify(request.initialSnapshot)).toBe(before);
    expect(info).toHaveBeenCalledExactlyOnceWith('[API] session_metadata_update_failed', { phase: 'terminal_failure', operation: 'update-metadata', sessionId: 'diagnostic-session' });
    const diagnostic = JSON.stringify(info.mock.calls);
    expect(diagnostic).not.toContain('private-transport-response');
    expect(diagnostic).not.toContain('private-title');
    expect(diagnostic).not.toContain(credentials.token);
    expect(diagnostic).not.toContain('/private/workspace');
  });

  it('keeps cancellation and superseded-publisher outcomes quiet and preserves their original result', async () => {
    const info = vi.spyOn(logger, 'infoFile').mockImplementation(() => {});
    const patch = vi.spyOn(axios, 'patch').mockResolvedValue({ status: 409, data: { code: 'session_publisher_authority_lost' } });
    await expect(updateSessionMetadataEnvelopeTupleWithRetry(createRequest())).rejects.toMatchObject({ code: 'session_publisher_authority_lost' });
    const controller = new AbortController();
    const cancelled = new Error('fixture-cancelled');
    controller.abort(cancelled);
    await expect(updateSessionMetadataEnvelopeTupleWithRetry({ ...createRequest(), currentness: { signal: controller.signal } })).rejects.toBe(cancelled);
    expect(patch).toHaveBeenCalledOnce();
    expect(info).not.toHaveBeenCalled();
  });
});
