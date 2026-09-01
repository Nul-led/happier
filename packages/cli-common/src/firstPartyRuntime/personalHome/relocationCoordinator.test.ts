import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPersonalHomeRelocationSourceAllowsActivation,
  coordinatePersonalHomeRelocation,
  inspectPersonalHomeRelocationSourceRecovery,
} from './relocationCoordinator.js';
import type { PersonalHomeRelocationDestinationFacts } from './relocationDestination.js';

const destinationFacts = {
  operationId: 'system-task:relocation-1',
  status: 'quarantined' as const,
  bundleSha256: 'a'.repeat(64),
  expectedHomeServerIdentityId: 'srv_home_1',
  expectedCanonicalServerUrl: 'https://source.example.test',
  sourceDescriptorRevision: 4,
  homeServerIdentityId: 'srv_home_1',
  canonicalServerUrl: 'https://destination.example.test',
  minimumOuterRevisionExclusive: 6,
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

async function fixture() {
  const sourceDataDir = await mkdtemp(join(tmpdir(), 'happier-relocation-source-'));
  roots.push(sourceDataDir);
  const events: string[] = [];
  let sourceRunning = true;
  const destination = {
    stage: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts> => (
      events.push('destination.stage'), destinationFacts
    )),
    status: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts> => destinationFacts),
    commit: vi.fn(async () => (events.push('destination.commit'), { ...destinationFacts, status: 'active' as const })),
    abort: vi.fn(async (): Promise<PersonalHomeRelocationDestinationFacts> => (
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
      stopSource: vi.fn(async () => { events.push('source.stop'); sourceRunning = false; }),
      restoreSourceAfterFailedStage: vi.fn(async () => { events.push('source.restore_after_stage_failure'); sourceRunning = true; }),
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
  it('moves writable authority source → neither → destination through the destination-local owner', async () => {
    const { params, events, destination } = await fixture();

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

  it('reactivates the untouched source when destination staging fails before source quarantine', async () => {
    const { params, destination } = await fixture();
    destination.stage.mockRejectedValueOnce(new Error('remote restore failed'));

    await expect(coordinatePersonalHomeRelocation(params)).rejects.toThrow('remote restore failed');
    expect(params.restoreSourceAfterFailedStage).toHaveBeenCalledTimes(1);
    expect(params.quarantineSource).not.toHaveBeenCalled();
    expect(destination.commit).not.toHaveBeenCalled();
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

  it('returns authority to the original Home only after source publication is read back', async () => {
    const recovery = await fixture();
    recovery.params.publishDestination.mockRejectedValueOnce(new Error('destination publication unavailable'));
    recovery.params.readPublishedDescriptor.mockResolvedValueOnce(null);
    await expect(coordinatePersonalHomeRelocation(recovery.params)).resolves.toMatchObject({ status: 'pending' });

    const returnedSource = { ...sourceDescriptor, revision: 8 };
    recovery.params.readPublishedDescriptor
      .mockImplementationOnce(async () => { recovery.events.push('readback'); return publishedDescriptor; })
      .mockImplementationOnce(async () => { recovery.events.push('readback'); return returnedSource; });
    recovery.params.publishDestination.mockImplementationOnce(async () => { recovery.events.push('publish'); return returnedSource; });
    recovery.params.activateSource.mockImplementationOnce(async () => {
      const marker = JSON.parse(await readFile(join(recovery.params.sourceDataDir, '.operations', 'relocation-source.json'), 'utf8')) as { phase?: unknown };
      expect(marker.phase).toBe('returning_to_source');
      recovery.events.push('source.activate');
    });
    recovery.params.readSourceServiceStatus.mockResolvedValueOnce({ running: true, quarantined: false });
    await expect(coordinatePersonalHomeRelocation({
      ...recovery.params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'returned', publishedDescriptor: returnedSource });

    expect(recovery.destination.abort).toHaveBeenCalledTimes(1);
    expect(recovery.params.activateSource).toHaveBeenCalledTimes(1);
    const abortIndex = recovery.events.lastIndexOf('destination.abort');
    const publishIndex = recovery.events.lastIndexOf('publish');
    const readbackIndex = recovery.events.lastIndexOf('readback');
    const activateIndex = recovery.events.lastIndexOf('source.activate');
    expect(abortIndex).toBeLessThan(publishIndex);
    expect(publishIndex).toBeLessThan(readbackIndex);
    expect(readbackIndex).toBeLessThan(activateIndex);
    await expect(inspectPersonalHomeRelocationSourceRecovery(recovery.params.sourceDataDir)).resolves.toEqual({ status: 'none' });
  });

  it('resumes returning to the source after the destination was already durably aborted', async () => {
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
    const returnedSource = { ...sourceDescriptor, revision: 9 };
    recovery.params.readPublishedDescriptor
      .mockResolvedValueOnce(publishedDescriptor)
      .mockResolvedValueOnce(returnedSource);
    recovery.params.publishDestination.mockResolvedValueOnce(returnedSource);

    await expect(coordinatePersonalHomeRelocation({
      ...recovery.params,
      recoveryAction: 'return_to_source',
    })).resolves.toMatchObject({ status: 'returned', publishedDescriptor: returnedSource });
    expect(recovery.params.activateSource).toHaveBeenCalledTimes(1);
  });
});
