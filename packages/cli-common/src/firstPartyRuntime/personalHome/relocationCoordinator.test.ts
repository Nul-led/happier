import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPersonalHomeRelocationSourceAllowsActivation,
  coordinatePersonalHomeRelocation,
  inspectPersonalHomeRelocationSourceRecovery,
  PersonalHomeRelocationTransferCleanupError,
} from './relocationCoordinator.js';
import type {
  PersonalHomeRelocationDestinationAbsence,
  PersonalHomeRelocationDestinationFacts,
  PersonalHomeRelocationDestinationStageInput,
} from './relocationDestination.js';

const destinationFacts = {
  operationId: 'system-task:relocation-1',
  status: 'quarantined' as const,
  bundleSha256: 'a'.repeat(64),
  expectedHomeServerIdentityId: 'srv_home_1',
  expectedCanonicalServerUrl: 'https://source.example.test',
  sourceDescriptorRevision: 4,
  homeServerIdentityId: 'srv_home_1',
  connectionDescriptor: {
    v: 1 as const, homeServerIdentityId: 'srv_home_1', canonicalServerUrl: 'https://destination.example.test',
    revision: 7, endpoints: [{ kind: 'https' as const, url: 'https://destination.example.test' }],
  },
  authenticated: true as const,
  accountCount: 1,
  sessionCount: 0,
};

const publishedDescriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_1',
  canonicalServerUrl: 'https://destination.example.test',
  revision: 7,
  endpoints: [{ kind: 'https' as const, url: 'https://destination.example.test' }],
};
const sourceDescriptor = {
  v: 1 as const,
  homeServerIdentityId: 'srv_home_1',
  canonicalServerUrl: 'https://source.example.test',
  revision: 4,
  endpoints: [{ kind: 'https' as const, url: 'https://source.example.test' }],
};

const roots: string[] = [];
afterEach(async () => await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(sourceInitiallyRunning = true) {
  const sourceDataDir = await mkdtemp(join(tmpdir(), 'happier-relocation-source-'));
  roots.push(sourceDataDir);
  const events: string[] = [];
  let sourceRunning = sourceInitiallyRunning;
  const destination = {
    stage: vi.fn(async (_input: PersonalHomeRelocationDestinationStageInput): Promise<PersonalHomeRelocationDestinationFacts> => (
      events.push('destination.stage'), destinationFacts
    )),
    status: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts | Readonly<{ operationId: string; status: 'absent' }>> => {
      const sourceMarkerExists = await readFile(join(sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')
        .then(() => true, () => false);
      return sourceMarkerExists ? destinationFacts : { operationId: destinationFacts.operationId, status: 'absent' };
    }),
    commit: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts> => (
      events.push('destination.commit'), { ...destinationFacts, status: 'active' as const }
    )),
    abort: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts | PersonalHomeRelocationDestinationAbsence> => (
      events.push('destination.abort'), { ...destinationFacts, status: 'aborted' as const }
    )),
  };
  const readPublishedDescriptor = vi.fn(async (): Promise<typeof publishedDescriptor | typeof sourceDescriptor | null> => {
    events.push('readback');
    return publishedDescriptor;
  });
  readPublishedDescriptor.mockImplementationOnce(async () => {
    events.push('readback');
    return sourceDescriptor;
  });
  return {
    events,
    destination,
    params: {
      operationId: destinationFacts.operationId,
      sourceDataDir,
      homeServerIdentityId: 'srv_home_1',
      sourceCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 4,
      destinationMachineId: 'machine-b',
      stopSource: vi.fn(async () => {
        events.push('source.stop');
        const wasRunning = sourceRunning;
        sourceRunning = false;
        return { wasRunning };
      }),
      quarantineSource: vi.fn(async () => { events.push('source.quarantine'); }),
      activateSource: vi.fn(async () => { events.push('source.activate'); sourceRunning = true; }),
      readSourceServiceStatus: vi.fn(async () => ({ running: sourceRunning, quarantined: !sourceRunning })),
      createFinalBackup: vi.fn(async () => {
        events.push('source.backup');
        return { archivePath: '/source/relocation.tar', bundleSha256: 'a'.repeat(64) };
      }),
      destination,
      publishDestination: vi.fn(async () => (events.push('publish'), publishedDescriptor)),
      readPublishedDescriptor,
    },
  };
}

describe('Personal Home source relocation coordinator', () => {
  it('cancels after destination staging while the source descriptor is still authoritative', async () => {
    const { params, destination } = await fixture();
    const controller = new AbortController();
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);
    destination.stage.mockImplementationOnce(async () => {
      controller.abort();
      return destinationFacts;
    });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'operation_cancelled' });

    expect(destination.abort).toHaveBeenCalledWith(destinationFacts.operationId);
    expect(params.publishDestination).not.toHaveBeenCalled();
    expect(destination.commit).not.toHaveBeenCalled();
    expect(params.activateSource).toHaveBeenCalledTimes(1);
    await expect(assertPersonalHomeRelocationSourceAllowsActivation(params.sourceDataDir)).resolves.toBeUndefined();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({ status: 'none' });
  });

  it('returns the typed cancellation after an aborted transfer is cleaned before staging', async () => {
    const { params, destination } = await fixture();
    const controller = new AbortController();
    destination.stage.mockImplementationOnce(async () => {
      controller.abort();
      throw new Error('transfer stopped');
    });
    destination.status
      .mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' })
      .mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'operation_cancelled' });

    expect(params.publishDestination).not.toHaveBeenCalled();
    expect(destination.commit).not.toHaveBeenCalled();
    expect(params.activateSource).toHaveBeenCalledTimes(1);
  });

  it('finishes moving when cancellation races with the irreversible publication boundary', async () => {
    const { params, destination } = await fixture();
    const controller = new AbortController();
    params.publishDestination.mockImplementationOnce(async () => {
      controller.abort();
      return publishedDescriptor;
    });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
    })).resolves.toMatchObject({ status: 'committed', publishedDescriptor });

    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
    expect(destination.commit).toHaveBeenCalledTimes(1);
  });

  it('honors cancellation delivered immediately before publication is invoked', async () => {
    const { params, destination } = await fixture();
    const controller = new AbortController();
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
      progress: (step) => {
        if (step === 'publishing_destination') controller.abort();
      },
    })).rejects.toMatchObject({ code: 'operation_cancelled' });

    expect(params.publishDestination).not.toHaveBeenCalled();
    expect(destination.abort).toHaveBeenCalledTimes(1);
    expect(params.activateSource).toHaveBeenCalledTimes(1);
  });

  it('restores an initially stopped source without activating it when cancellation arrives after source quarantine', async () => {
    const { params, destination } = await fixture(false);
    const controller = new AbortController();
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
      progress: (step) => {
        if (step === 'publishing_destination') controller.abort();
      },
    })).rejects.toMatchObject({ code: 'operation_cancelled' });

    expect(params.publishDestination).not.toHaveBeenCalled();
    expect(destination.abort).toHaveBeenCalledTimes(1);
    expect(params.activateSource).not.toHaveBeenCalled();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({ status: 'none' });
  });

  it('activates an initially stopped source when the user explicitly chooses Return to Original Home', async () => {
    const { params } = await fixture(false);
    params.publishDestination.mockRejectedValueOnce(new Error('publication unavailable'));
    params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({ status: 'pending' });

    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);
    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'returned' });

    expect(params.activateSource).toHaveBeenCalledTimes(1);
  });

  it('ignores cancellation after durable destination publication and continues the existing move', async () => {
    const { params, destination } = await fixture();
    destination.commit.mockRejectedValueOnce(new Error('destination process stopped after publication'));
    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('destination process stopped after publication');

    const controller = new AbortController();
    controller.abort();
    destination.status.mockResolvedValueOnce({ ...destinationFacts, status: 'quarantined' });
    params.readPublishedDescriptor.mockResolvedValueOnce(publishedDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      signal: controller.signal,
    })).resolves.toMatchObject({ status: 'committed', publishedDescriptor });

    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
    expect(destination.commit).toHaveBeenCalledTimes(2);
  });

  it('moves writable authority source → neither → destination through the destination-local owner', async () => {
    const { params, events, destination } = await fixture();
    const stopSource = params.stopSource.getMockImplementation()!;
    params.stopSource.mockImplementationOnce(async () => {
      const marker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as { phase?: unknown };
      expect(marker.phase).toBe('preparing_source');
      return await stopSource();
    });

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      operationId: destinationFacts.operationId,
      status: 'committed',
      destinationMachineId: 'machine-b',
      publishedDescriptor,
    });

    expect(events).toEqual([
      'readback',
      'source.stop',
      'source.backup',
      'destination.stage',
      'source.quarantine',
      'publish',
      'readback',
      'destination.commit',
    ]);
    expect(destination.stage).toHaveBeenCalledWith(expect.objectContaining({
      operationId: destinationFacts.operationId,
      archivePath: '/source/relocation.tar',
      sourceDescriptorRevision: 4,
    }));
    expect(destination.status.mock.invocationCallOrder[0]).toBeLessThan(params.stopSource.mock.invocationCallOrder[0]!);
  });

  it('keeps both copies stopped when publication is not authoritatively readable', async () => {
    const { params, destination } = await fixture();
    params.publishDestination.mockRejectedValueOnce(new Error('response lost'));
    params.readPublishedDescriptor.mockResolvedValueOnce(null);

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      status: 'pending',
      recoveryAction: 'finish_move',
    });
    expect(destination.commit).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
    await expect(assertPersonalHomeRelocationSourceAllowsActivation(params.sourceDataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_SOURCE_ACTIVATION_BLOCKED',
    });
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
      destinationMachineId: 'machine-b',
      sourceDescriptorRevision: 4,
      primaryAction: 'finish_move',
      secondaryAction: 'return_to_source',
    });
  });

  it('offers Return to Original Home when restart inspection finds quarantine before publication', async () => {
    const { params } = await fixture();
    params.publishDestination.mockRejectedValueOnce(new Error('publication transport lost'));
    params.readPublishedDescriptor.mockRejectedValueOnce(new Error('publication authority unreadable'));

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('publication authority unreadable');

    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
      destinationMachineId: 'machine-b',
      sourceDescriptorRevision: 4,
      primaryAction: 'finish_move',
      secondaryAction: 'return_to_source',
    });
  });

  it('keeps both copies stopped when publication readback does not contain the attested destination endpoints', async () => {
    const { params, destination } = await fixture();
    const wrongEndpointDescriptor = {
      ...publishedDescriptor,
      endpoints: [{ kind: 'https' as const, url: 'https://stale.example.test' }],
    };
    params.publishDestination.mockResolvedValueOnce(wrongEndpointDescriptor);
    params.readPublishedDescriptor.mockResolvedValueOnce(wrongEndpointDescriptor);

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      status: 'pending',
      recoveryAction: 'finish_move',
    });
    expect(destination.commit).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
  });

  it('preserves transfer-cleanup attention without persisting a remote path or message', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockResolvedValueOnce({
      ...destinationFacts,
      transferCleanupNeedsAttention: true,
    });
    params.publishDestination.mockRejectedValueOnce(new Error('publication unavailable'));
    params.readPublishedDescriptor.mockResolvedValueOnce(null);

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      status: 'pending',
      destinationTransferCleanupNeedsAttention: true,
    });

    params.readPublishedDescriptor.mockResolvedValueOnce(publishedDescriptor);
    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      status: 'committed',
      destinationTransferCleanupNeedsAttention: true,
    });
  });

  it('durably records cleanup attention while preserving a failed transfer as the operation error', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new PersonalHomeRelocationTransferCleanupError(
      new Error('scp connection closed'),
    ));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toMatchObject({
      message: expect.stringContaining('scp connection closed'),
      transferCleanupNeedsAttention: true,
    });

    const marker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      phase: 'returned_to_source',
      destinationTransferCleanupNeedsAttention: true,
    });
    expect(JSON.stringify(marker)).not.toContain('/private/opaque');
    expect(JSON.stringify(marker)).not.toContain('scp connection closed');

    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toMatchObject({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
      primaryAction: 'finish_move',
    });
    await expect(coordinatePersonalHomeRelocation({
      ...params,
      operationId: 'system-task:relocation-2',
    })).rejects.toThrow('Another Personal Home relocation operation owns the source recovery state.');

    destination.abort.mockResolvedValueOnce({
      operationId: destinationFacts.operationId,
      status: 'absent',
      transferCleanupNeedsAttention: true,
    });
    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({
      status: 'pending',
      recoveryAction: 'return_to_source',
      destinationTransferCleanupNeedsAttention: true,
    });
    const retainedMarker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as Record<string, unknown>;
    expect(retainedMarker).toHaveProperty('destinationTransferCleanupNeedsAttention', true);

    destination.abort.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);
    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'returned' });
    const cleanedMarker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as Record<string, unknown>;
    expect(cleanedMarker).not.toHaveProperty('destinationTransferCleanupNeedsAttention');
    expect(destination.abort).toHaveBeenCalledWith(destinationFacts.operationId);
  });

  it('reactivates the untouched source only when the destination itself reports nothing was staged', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('remote restore failed'));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('remote restore failed');
    expect(params.activateSource).toHaveBeenCalledTimes(1);
    expect(params.quarantineSource).not.toHaveBeenCalled();
    expect(destination.commit).not.toHaveBeenCalled();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({ status: 'none' });
  });

  it('reserves the verified source bundle before the first destination mutation and resumes the same archive', async () => {
    const { params, destination, events } = await fixture();
    destination.stage.mockImplementationOnce(async () => {
      events.push('destination.stage');
      throw new Error('stage response lost after the destination staged the bundle');
    });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('stage response lost');
    expect(params.activateSource).not.toHaveBeenCalled();
    expect(params.quarantineSource).not.toHaveBeenCalled();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toMatchObject({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
    });

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({ status: 'committed' });
    expect(params.createFinalBackup).toHaveBeenCalledTimes(1);
    expect(destination.stage).toHaveBeenCalledTimes(2);
    expect(destination.stage.mock.calls[1]?.[0]).toMatchObject({
      operationId: destinationFacts.operationId,
      archivePath: '/source/relocation.tar',
      bundleSha256: 'a'.repeat(64),
      sourceDescriptorRevision: 4,
    });
    expect(destination.commit).toHaveBeenCalledTimes(1);
  });

  it('leaves the source stopped when the destination outcome after a failed stage is unknown', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('transport closed'));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockRejectedValueOnce(new Error('destination unreachable'));

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('transport closed');
    expect(params.activateSource).not.toHaveBeenCalled();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toMatchObject({
      status: 'recovery_available',
    });
    await expect(assertPersonalHomeRelocationSourceAllowsActivation(params.sourceDataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_SOURCE_ACTIVATION_BLOCKED',
    });
  });

  it('blocks ordinary source activation after destination staging and before durable source quarantine', async () => {
    const { params } = await fixture();
    params.quarantineSource.mockRejectedValueOnce(new Error('service manager unavailable'));

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('service manager unavailable');
    await expect(assertPersonalHomeRelocationSourceAllowsActivation(params.sourceDataDir)).rejects.toMatchObject({
      code: 'PERSONAL_HOME_RELOCATION_SOURCE_ACTIVATION_BLOCKED',
    });
  });

  it('returns authority to the original Home from a reservation the destination never staged', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('transport closed'));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockRejectedValueOnce(new Error('destination unreachable'));
    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('transport closed');

    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);
    params.readSourceServiceStatus.mockResolvedValueOnce({ running: true, quarantined: false });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'returned', publishedDescriptor: sourceDescriptor });
    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.createFinalBackup).toHaveBeenCalledTimes(1);
    expect(destination.stage).toHaveBeenCalledTimes(1);
  });

  it('preserves destination abort cleanup attention when returning authority to the source', async () => {
    const { params, destination } = await fixture();
    params.publishDestination.mockRejectedValueOnce(new Error('publication unavailable'));
    params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({ status: 'pending' });

    destination.abort.mockResolvedValueOnce({
      ...destinationFacts,
      status: 'aborted' as const,
      transferCleanupNeedsAttention: true,
    });
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({
      status: 'returned',
      destinationTransferCleanupNeedsAttention: true,
    });
    const marker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({
      phase: 'returned_to_source',
      destinationTransferCleanupNeedsAttention: true,
    });
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toMatchObject({
      status: 'recovery_available',
      primaryAction: 'finish_move',
    });
  });

  it('preserves destination abort errors before reactivating the source', async () => {
    const { params, destination } = await fixture();
    params.publishDestination.mockRejectedValueOnce(new Error('publication unavailable'));
    params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({ status: 'pending' });

    destination.abort.mockRejectedValueOnce(new Error('destination abort unavailable'));
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).rejects.toThrow('destination abort unavailable');
    expect(params.activateSource).not.toHaveBeenCalled();
    const marker = JSON.parse(await readFile(join(params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as Record<string, unknown>;
    expect(marker).toMatchObject({ phase: 'pending' });
  });

  it('permits a later relocation after a different operation returned authority to the source', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('transport closed'));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('transport closed');

    const nextOperationId = 'system-task:relocation-2';
    params.readPublishedDescriptor.mockResolvedValueOnce(sourceDescriptor);
    destination.stage.mockResolvedValueOnce({ ...destinationFacts, operationId: nextOperationId });
    destination.status.mockResolvedValueOnce({ operationId: nextOperationId, status: 'absent' });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      operationId: nextOperationId,
    })).resolves.toMatchObject({
      operationId: nextOperationId,
      status: 'committed',
    });
    expect(params.stopSource).toHaveBeenCalledTimes(2);
    expect(params.createFinalBackup).toHaveBeenCalledTimes(2);
  });

  it('resumes a lost post-publication response without recreating or retransferring the backup', async () => {
    const first = await fixture();
    first.params.publishDestination.mockRejectedValueOnce(new Error('response lost'));
    first.params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(first.params)).resolves.toMatchObject({ status: 'pending' });

    first.params.readPublishedDescriptor.mockResolvedValueOnce(publishedDescriptor);
    await expect(coordinatePersonalHomeRelocation(first.params)).resolves.toMatchObject({ status: 'committed' });
    expect(first.params.createFinalBackup).toHaveBeenCalledTimes(1);
    expect(first.destination.stage).toHaveBeenCalledTimes(1);
    expect(first.destination.commit).toHaveBeenCalledTimes(1);
  });

  it('refuses Return when authoritative readback already points at the destination', async () => {
    const recovery = await fixture();
    recovery.params.publishDestination.mockRejectedValueOnce(new Error('destination publication unavailable'));
    recovery.params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(recovery.params)).resolves.toMatchObject({ status: 'pending' });

    recovery.params.readPublishedDescriptor.mockResolvedValueOnce(publishedDescriptor);
    await expect(coordinatePersonalHomeRelocation({
      ...recovery.params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'pending', recoveryAction: 'finish_move' });

    expect(recovery.destination.abort).not.toHaveBeenCalled();
    expect(recovery.params.publishDestination).toHaveBeenCalledTimes(1);
    expect(recovery.params.activateSource).not.toHaveBeenCalled();
  });

  it('does not return to the source after an abort when published authority points at the destination', async () => {
    const recovery = await fixture();
    recovery.params.publishDestination.mockRejectedValueOnce(new Error('destination publication unavailable'));
    recovery.params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(recovery.params)).resolves.toMatchObject({ status: 'pending' });

    recovery.params.readPublishedDescriptor.mockRejectedValueOnce(new Error('readback transport lost'));
    await expect(coordinatePersonalHomeRelocation({
      ...recovery.params,
      recoveryAction: 'return_to_source',
    })).rejects.toThrow('readback transport lost');

    const aborted = { ...destinationFacts, status: 'aborted' as const };
    recovery.destination.status.mockResolvedValueOnce(aborted);
    recovery.destination.abort.mockResolvedValue(aborted);
    recovery.params.readPublishedDescriptor.mockResolvedValueOnce(publishedDescriptor);

    await expect(coordinatePersonalHomeRelocation({
      ...recovery.params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'pending', recoveryAction: 'finish_move' });
    expect(recovery.params.activateSource).not.toHaveBeenCalled();
    expect(recovery.params.publishDestination).toHaveBeenCalledTimes(1);
  });

  it('re-enters commit when a post-publication activation failure left a verified destination candidate', async () => {
    const { params, destination } = await fixture();
    destination.commit.mockImplementationOnce(async () => {
      destination.status.mockResolvedValue({
        ...destinationFacts,
        status: 'recovery_required' as const,
        failureCode: 'activation_failed',
      });
      throw new Error('destination activation response lost');
    });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('destination activation response lost');

    await expect(coordinatePersonalHomeRelocation({ ...params, recoveryAction: 'finish_move' })).resolves.toMatchObject({
      status: 'committed',
      publishedDescriptor,
    });
    expect(destination.commit).toHaveBeenCalledTimes(2);
    expect(destination.stage).toHaveBeenCalledTimes(1);
    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.createFinalBackup).toHaveBeenCalledTimes(1);
  });

  it('re-enters destination commit to converge retained post-commit cleanup attention', async () => {
    const { params, destination } = await fixture();
    destination.commit.mockResolvedValueOnce({
      ...destinationFacts,
      status: 'active' as const,
      cleanupNeedsAttention: true,
    });

    await expect(coordinatePersonalHomeRelocation(params)).resolves.toMatchObject({
      status: 'committed',
      destinationCleanupNeedsAttention: true,
    });
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
      destinationMachineId: 'machine-b',
      sourceDescriptorRevision: 4,
      primaryAction: 'finish_move',
    });

    destination.status.mockResolvedValueOnce({ ...destinationFacts, status: 'active' as const });
    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'finish_move',
    })).resolves.toMatchObject({
      status: 'committed',
      publishedDescriptor,
    });

    expect(destination.commit).toHaveBeenCalledTimes(2);
    expect(destination.stage).toHaveBeenCalledTimes(1);
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({ status: 'none' });
  });

  it('keeps both Homes intact when the destination cannot prove it owns the relocation candidate', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('Destination Personal Home contains data'));
    destination.status.mockResolvedValueOnce({ operationId: destinationFacts.operationId, status: 'absent' });
    destination.status.mockResolvedValue({
      operationId: destinationFacts.operationId,
      status: 'recovery_required' as const,
      bundleSha256: destinationFacts.bundleSha256,
      expectedHomeServerIdentityId: 'srv_home_1',
      expectedCanonicalServerUrl: 'https://source.example.test',
      sourceDescriptorRevision: 4,
      failureCode: 'stage_failed',
    });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('Destination Personal Home contains data');
    expect(params.activateSource).not.toHaveBeenCalled();

    await expect(coordinatePersonalHomeRelocation({ ...params, recoveryAction: 'return_to_source' })).resolves.toMatchObject({
      status: 'pending',
      recoveryAction: 'return_to_source',
    });
    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
    expect(params.quarantineSource).not.toHaveBeenCalled();
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toMatchObject({
      status: 'recovery_available',
    });
  });

  it('offers only Finish Moving once publication activated the destination and never aborts it', async () => {
    const { params, destination } = await fixture();
    destination.commit.mockImplementationOnce(async () => {
      destination.status.mockResolvedValue({ ...destinationFacts, status: 'active' as const });
      throw new Error('commit response lost after activation');
    });

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('commit response lost after activation');
    await expect(inspectPersonalHomeRelocationSourceRecovery(params.sourceDataDir)).resolves.toEqual({
      status: 'recovery_available',
      operationId: destinationFacts.operationId,
      destinationMachineId: 'machine-b',
      sourceDescriptorRevision: 4,
      primaryAction: 'finish_move',
    });

    await expect(coordinatePersonalHomeRelocation({
      ...params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'committed', publishedDescriptor });
    expect(destination.abort).not.toHaveBeenCalled();
    expect(params.activateSource).not.toHaveBeenCalled();
  });
});
