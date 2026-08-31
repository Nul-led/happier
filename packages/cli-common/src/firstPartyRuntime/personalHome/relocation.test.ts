import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { HomeConnectionDescriptorV1 } from '@happier-dev/protocol';
import { withPersonalHomeOperationLock } from './lock.js';
import {
    assertPersonalHomeRelocationAllowsActivation,
    PersonalHomeRelocationMarker,
    readPersonalHomeRelocationMarker,
    recoverPersonalHomeRelocation,
    relocatePersonalHome,
} from './relocation.js';

const IDENTITY = 'srv_same';

function descriptor(url = 'https://home.example.test'): HomeConnectionDescriptorV1 {
    return { v: 1, homeServerIdentityId: IDENTITY, canonicalServerUrl: url, revision: 1, endpoints: [{ kind: 'https', url }] };
}

async function seedMarker(dataDir: string, phase: PersonalHomeRelocationMarker['phase'], overrides: Partial<PersonalHomeRelocationMarker> = {}): Promise<PersonalHomeRelocationMarker> {
    const marker: PersonalHomeRelocationMarker = {
        version: 1,
        phase,
        sourceDataDir: join(dataDir, '..', 'source'),
        destinationDataDir: join(dataDir, '..', 'destination'),
        homeServerIdentityId: IDENTITY,
        bundleSha256: 'a'.repeat(64),
        priorSourceRunning: true,
        ...overrides,
    };
    await mkdir(join(dataDir, '.operations'), { recursive: true });
    await writeFile(join(dataDir, '.operations', 'relocation.json'), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    return marker;
}

async function readMarker(dataDir: string): Promise<PersonalHomeRelocationMarker | null> {
    return readPersonalHomeRelocationMarker(dataDir);
}

async function makeRoots(): Promise<{ root: string; source: string; destination: string }> {
    const root = await mkdtemp(join(tmpdir(), 'happier-home-relocate-'));
    return { root, source: join(root, 'source'), destination: join(root, 'destination') };
}

describe('Personal Home relocation owner', () => {
    it.each([
        { boundary: 'after private destination start', phase: 'staged' as const, sourceAllowed: false, destinationAllowed: false },
        { boundary: 'after pending marker persistence', phase: 'pending' as const, sourceAllowed: false, destinationAllowed: false },
        { boundary: 'after publication succeeds but before committed persistence', phase: 'pending' as const, sourceAllowed: false, destinationAllowed: false },
        { boundary: 'after committed persistence but before final destination start', phase: 'committed' as const, sourceAllowed: false, destinationAllowed: true },
    ])('fails closed on ordinary starts $boundary', async ({ phase, sourceAllowed, destinationAllowed }) => {
        const { root, source, destination } = await makeRoots();
        try {
            const marker = await seedMarker(source, phase, { sourceDataDir: source, destinationDataDir: destination });
            await seedMarker(destination, phase, marker);
            const sourceActivation = assertPersonalHomeRelocationAllowsActivation(source);
            const destinationActivation = assertPersonalHomeRelocationAllowsActivation(destination);
            if (sourceAllowed) await expect(sourceActivation).resolves.toBeUndefined();
            else await expect(sourceActivation).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' });
            if (destinationAllowed) await expect(destinationActivation).resolves.toBeUndefined();
            else await expect(destinationActivation).rejects.toMatchObject({ code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED' });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('blocks activation when an existing relocation marker is corrupt instead of treating it as absent', async () => {
        const { root, source } = await makeRoots();
        try {
            await mkdir(join(source, '.operations'), { recursive: true });
            await writeFile(join(source, '.operations', 'relocation.json'), '{"version":1}\n', { mode: 0o600 });
            await expect(assertPersonalHomeRelocationAllowsActivation(source)).rejects.toMatchObject({
                code: 'PERSONAL_HOME_RELOCATION_ACTIVATION_BLOCKED',
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('transfers a verified bundle, verifies destination, publishes once, and keeps source stopped', { timeout: 60_000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-relocate-'));
        const source = join(root, 'source');
        const destination = join(root, 'destination');
        const bundle = join(root, 'home.tar');
        const events: string[] = [];
        await writeFile(bundle, 'bundle-bytes');
        const destinationDescriptor = descriptor('http://127.0.0.1:43123');
        let signalRelocationEntered: () => void = () => undefined;
        const relocationEntered = new Promise<void>((resolveReady) => { signalRelocationEntered = resolveReady; });
        let signalIndependentSettled: () => void = () => undefined;
        const independentSettled = new Promise<void>((resolveSettled) => { signalIndependentSettled = resolveSettled; });
        const independentFlow = (async () => {
            await relocationEntered;
            try {
                await expect(withPersonalHomeOperationLock(source, 'lifecycle', async () => undefined)).rejects.toMatchObject({ code: 'operation_in_progress' });
            } finally {
                signalIndependentSettled();
            }
        })();
        const publish = vi.fn(async () => {
            events.push('publish');
            expect((await readMarker(source))?.phase).toBe('pending');
            expect((await readMarker(destination))?.phase).toBe('pending');
            expect(events).toEqual([
                'prepare',
                'stop',
                'restore',
                'verify',
                'start-destination',
                'stop-destination',
                'quarantine-destination',
                'publish',
            ]);
        });
        const result = await relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: 'srv_same' },
            destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: bundle, sha256: 'a'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => {
                signalRelocationEntered();
                await expect(withPersonalHomeOperationLock(destination, 'lifecycle', async () => 'prepared')).resolves.toBe('prepared');
                await independentSettled;
                events.push('prepare');
            },
            stopSource: async () => {
                await expect(withPersonalHomeOperationLock(source, 'lifecycle', async () => 'stopped')).resolves.toBe('stopped');
                events.push('stop');
            },
            startSource: async () => {
                await expect(assertPersonalHomeRelocationAllowsActivation(join(root, 'source'))).resolves.toBeUndefined();
                events.push('start-source');
            },
            transfer: {
                send: async ({ sourcePath }) => ({ receivedPath: sourcePath, bytes: 12, sha256: 'a'.repeat(64) }),
            },
            restoreDestination: async () => { events.push('restore'); },
            verifyDestination: async () => { events.push('verify'); return { homeServerIdentityId: 'srv_same' }; },
            startDestination: async () => {
                await expect(assertPersonalHomeRelocationAllowsActivation(destination)).resolves.toBeUndefined();
                events.push('start-destination');
                const expectedPhase = events.filter((event) => event === 'start-destination').length === 1 ? 'staged' : 'committed';
                expect((await readMarker(source))?.phase).toBe(expectedPhase);
                expect((await readMarker(destination))?.phase).toBe(expectedPhase);
                return { healthy: true, homeServerIdentityId: 'srv_same' };
            },
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: publish,
            destinationDescriptor,
        });

        expect(result).toMatchObject({ homeServerIdentityId: 'srv_same', destinationVerified: true, sourceStopped: true, followerAction: 'reconnect' });
        expect(events).toEqual([
            'prepare',
            'stop',
            'restore',
            'verify',
            'start-destination',
            'stop-destination',
            'quarantine-destination',
            'publish',
            'start-destination',
        ]);
        await independentFlow;
        expect(publish).toHaveBeenCalledWith({ homeServerIdentityId: 'srv_same', newConnectionDescriptor: destinationDescriptor });
        await expect(stat(join(source, '.operations', 'relocation.json'))).resolves.toBeTruthy();
        expect((await readMarker(source))?.phase).toBe('committed');
        await rm(root, { recursive: true, force: true });
    });

    it('keeps both homes stopped and marks publication pending when the callback fails', { timeout: 60_000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-relocate-pending-'));
        const events: string[] = [];
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: join(root, 'source'), homeServerIdentityId: 'srv_same' },
            destination: { dataDir: join(root, 'destination') },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: 'b'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => {},
            stopSource: async () => { events.push('stop'); },
            startSource: async () => {
                await expect(assertPersonalHomeRelocationAllowsActivation(join(root, 'source'))).resolves.toBeUndefined();
                events.push('start-source');
            },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: 'b'.repeat(64) }) },
            restoreDestination: async () => {},
            verifyDestination: async () => ({ homeServerIdentityId: 'srv_same' }),
            startDestination: async () => { events.push('start-destination'); return { healthy: true, homeServerIdentityId: 'srv_same' }; },
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => { throw new Error('offline'); },
            destinationDescriptor: descriptor('http://127.0.0.1:43123'),
        })).rejects.toThrow('offline');
        expect(events).toEqual(['stop', 'start-destination', 'stop-destination', 'quarantine-destination']);
        expect((await readMarker(join(root, 'source')))?.phase).toBe('pending');
        expect((await readMarker(join(root, 'destination')))?.phase).toBe('pending');
        await rm(root, { recursive: true, force: true });
    });

    it('quarantines a failed destination and restarts the source before publication begins', { timeout: 60_000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-relocate-rollback-'));
        const bundle = join(root, 'home.tar');
        const events: string[] = [];
        await writeFile(bundle, 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: join(root, 'source'), homeServerIdentityId: 'srv_same' },
            destination: { dataDir: join(root, 'destination') },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: bundle, sha256: 'c'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => {},
            stopSource: async () => { events.push('stop-source'); },
            startSource: async () => {
                await expect(assertPersonalHomeRelocationAllowsActivation(join(root, 'source'))).resolves.toBeUndefined();
                events.push('start-source');
            },
            transfer: { send: async () => { throw new Error('transfer failed'); } },
            restoreDestination: async () => {},
            verifyDestination: async () => ({ homeServerIdentityId: 'srv_same' }),
            startDestination: async () => ({ healthy: true, homeServerIdentityId: 'srv_same' }),
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => undefined,
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('transfer failed');
        expect(events).toEqual(['stop-source', 'quarantine-destination', 'start-source']);
        await rm(root, { recursive: true, force: true });
    });

    it('quarantines the prepared destination when cancelled after staging but before the source stops', { timeout: 60_000 }, async () => {
        const { root, source, destination } = await makeRoots();
        const events: string[] = [];
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: 'e'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => { events.push('prepare'); },
            stopSource: async () => { events.push('stop-source'); },
            startSource: async () => { events.push('start-source'); },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: 'e'.repeat(64) }) },
            restoreDestination: async () => {},
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => undefined,
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
            checkCancelledBeforeCutover: () => { throw new Error('cancelled before cutover'); },
        })).rejects.toThrow('cancelled before cutover');
        expect(events).toEqual(['prepare', 'quarantine-destination']);
        expect((await readMarker(source))?.phase).toBe('staged');
        await rm(root, { recursive: true, force: true });
    });

    it('quarantines the prepared destination without restarting when stopping the source fails', { timeout: 60_000 }, async () => {
        const { root, source, destination } = await makeRoots();
        const startSource = vi.fn(async () => undefined);
        const quarantineDestination = vi.fn(async () => undefined);
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: '8'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => undefined,
            stopSource: async () => { throw new Error('source stop failed'); },
            startSource,
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: '8'.repeat(64) }) },
            restoreDestination: async () => undefined,
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
            stopDestination: async () => undefined,
            quarantineDestination,
            commitSameHomeRelocation: async () => undefined,
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('source stop failed');
        expect(quarantineDestination).toHaveBeenCalledTimes(1);
        expect(startSource).not.toHaveBeenCalled();
        expect((await readMarker(source))?.phase).toBe('staged');
        expect((await readMarker(destination))?.phase).toBe('staged');
        await rm(root, { recursive: true, force: true });
    });

    it('restarts the source after destination quarantine when stop throws after stopping it', { timeout: 60_000 }, async () => {
        const { root, source, destination } = await makeRoots();
        let sourceRunning = true;
        const events: string[] = [];
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: '9'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => undefined,
            stopSource: async () => { sourceRunning = false; throw new Error('source stop failed after stopping'); },
            isSourceRunning: async () => sourceRunning,
            startSource: async () => { events.push('start-source'); sourceRunning = true; },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: '9'.repeat(64) }) },
            restoreDestination: async () => undefined,
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
            stopDestination: async () => undefined,
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => undefined,
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('source stop failed after stopping');
        expect(events).toEqual(['quarantine-destination', 'start-source']);
        expect(sourceRunning).toBe(true);
        await rm(root, { recursive: true, force: true });
    });

    it('rolls a failed destination activation back to the source without publishing', { timeout: 60_000 }, async () => {
        const { root, source } = await makeRoots();
        const events: string[] = [];
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: join(root, 'destination') },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: 'f'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => { events.push('prepare'); },
            stopSource: async () => { events.push('stop-source'); },
            startSource: async () => { events.push('start-source'); },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: 'f'.repeat(64) }) },
            restoreDestination: async () => { events.push('restore'); },
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => ({ healthy: false, homeServerIdentityId: IDENTITY }),
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => { events.push('publish'); },
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('health or identity attestation');
        expect(events).toEqual(['prepare', 'stop-source', 'restore', 'stop-destination', 'quarantine-destination', 'start-source']);
        expect(events).not.toContain('publish');
        expect((await readMarker(source))?.phase).toBe('staged');
        await rm(root, { recursive: true, force: true });
    });

    it('does not restart the source or hide incomplete destination quarantine', { timeout: 60_000 }, async () => {
        const { root, source, destination } = await makeRoots();
        const startSource = vi.fn(async () => undefined);
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        let observed: unknown;
        try {
            await relocatePersonalHome({
                source: { dataDir: source, homeServerIdentityId: IDENTITY },
                destination: { dataDir: destination },
                revalidateSourceUnderLocks: async () => undefined,
                createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: '9'.repeat(64), manifest: {} as never }),
                prepareDestination: async () => undefined,
                stopSource: async () => undefined,
                startSource,
                transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: '9'.repeat(64) }) },
                restoreDestination: async () => undefined,
                verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
                startDestination: async () => ({ healthy: false, homeServerIdentityId: IDENTITY }),
                stopDestination: async () => { throw new Error('destination stop failed'); },
                quarantineDestination: async () => { throw new Error('destination quarantine failed'); },
                commitSameHomeRelocation: async () => undefined,
                destinationDescriptor: descriptor(),
                priorSourceRunning: true,
            });
        } catch (error) {
            observed = error;
        }
        expect(observed).toBeInstanceOf(AggregateError);
        expect((observed as AggregateError).errors.map((error) => (error as Error).message)).toEqual(expect.arrayContaining([
            expect.stringContaining('health or identity attestation'),
            'destination stop failed',
            'destination quarantine failed',
        ]));
        expect(startSource).not.toHaveBeenCalled();
        expect((await readMarker(source))?.phase).toBe('staged');
        await rm(root, { recursive: true, force: true });
    });

    it('keeps publication pending and both homes stopped when the publication response is lost', { timeout: 60_000 }, async () => {
        const { root, source } = await makeRoots();
        const events: string[] = [];
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: join(root, 'destination') },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: '0'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => {},
            stopSource: async () => { events.push('stop-source'); },
            startSource: async () => { events.push('start-source'); },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: '0'.repeat(64) }) },
            restoreDestination: async () => {},
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => { events.push('start-destination'); return { healthy: true, homeServerIdentityId: IDENTITY }; },
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => {
                events.push('publish');
                expect(events).toEqual([
                    'stop-source',
                    'start-destination',
                    'stop-destination',
                    'quarantine-destination',
                    'publish',
                ]);
                throw new Error('publication outcome unknown');
            },
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('publication outcome unknown');
        expect(events).toEqual(['stop-source', 'start-destination', 'stop-destination', 'quarantine-destination', 'publish']);
        expect(events).not.toContain('start-source');
        expect((await readMarker(source))?.phase).toBe('pending');
        await rm(root, { recursive: true, force: true });
    });

    it('keeps a known committed destination stopped and quarantined when final activation is interrupted', { timeout: 60_000 }, async () => {
        const { root, source, destination } = await makeRoots();
        const events: string[] = [];
        let activationCount = 0;
        await writeFile(join(root, 'home.tar'), 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: IDENTITY },
            destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: join(root, 'home.tar'), sha256: '7'.repeat(64), manifest: {} as never }),
            prepareDestination: async () => undefined,
            stopSource: async () => { events.push('stop-source'); },
            startSource: async () => { events.push('start-source'); },
            transfer: { send: async () => ({ receivedPath: join(root, 'received.tar'), bytes: 12, sha256: '7'.repeat(64) }) },
            restoreDestination: async () => undefined,
            verifyDestination: async () => ({ homeServerIdentityId: IDENTITY }),
            startDestination: async () => {
                activationCount += 1;
                events.push(`start-destination-${activationCount}`);
                if (activationCount === 2) throw new Error('activation interrupted');
                return { healthy: true, homeServerIdentityId: IDENTITY };
            },
            stopDestination: async () => { events.push('stop-destination'); },
            quarantineDestination: async () => { events.push('quarantine-destination'); },
            commitSameHomeRelocation: async () => { events.push('publish'); },
            destinationDescriptor: descriptor(),
            priorSourceRunning: true,
        })).rejects.toThrow('activation interrupted');
        expect(events).toEqual([
            'stop-source',
            'start-destination-1',
            'stop-destination',
            'quarantine-destination',
            'publish',
            'start-destination-2',
            'stop-destination',
            'quarantine-destination',
        ]);
        expect(events).not.toContain('start-source');
        expect((await readMarker(source))?.phase).toBe('committed');
        expect((await readMarker(destination))?.phase).toBe('committed');
        await rm(root, { recursive: true, force: true });
    });

    it('reattests a pending destination before retrying publication without restarting the source', { timeout: 60_000 }, async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-home-relocate-retry-'));
        const source = join(root, 'source'); const destination = join(root, 'destination'); const bundle = join(root, 'home.tar');
        await writeFile(bundle, 'bundle-bytes');
        await expect(relocatePersonalHome({
            source: { dataDir: source, homeServerIdentityId: 'srv_same' }, destination: { dataDir: destination },
            revalidateSourceUnderLocks: async () => undefined,
            createFinalBackup: async () => ({ path: bundle, sha256: 'd'.repeat(64), manifest: {} as never }), prepareDestination: async () => undefined,
            stopSource: async () => undefined, startSource: async () => undefined,
            transfer: { send: async () => ({ receivedPath: bundle, bytes: 12, sha256: 'd'.repeat(64) }) }, restoreDestination: async () => undefined,
            verifyDestination: async () => ({ homeServerIdentityId: 'srv_same' }), startDestination: async () => ({ healthy: true, homeServerIdentityId: 'srv_same' }),
            stopDestination: async () => undefined, quarantineDestination: async () => undefined,
            commitSameHomeRelocation: async () => { throw new Error('publication unknown'); }, destinationDescriptor: descriptor('https://new.example.test'),
        })).rejects.toThrow('publication unknown');
        expect((await readPersonalHomeRelocationMarker(source))?.phase).toBe('pending');
        const startSource = vi.fn(async () => undefined);
        const retryEvents: string[] = [];
        const publish = vi.fn(async () => { retryEvents.push('publish'); });
        const recovered = await recoverPersonalHomeRelocation({
            sourceDataDir: source,
            destinationDataDir: destination,
            action: 'retry_publication',
            destinationDescriptor: descriptor(),
            startSource,
            stopDestination: async () => { retryEvents.push('stop-destination'); },
            quarantineDestination: async () => { retryEvents.push('quarantine-destination'); },
            activateDestination: async () => { retryEvents.push('activate-destination'); return { healthy: true, homeServerIdentityId: 'srv_same' }; },
            commitSameHomeRelocation: publish,
        });
        expect(recovered).toMatchObject({ phase: 'committed', sourceRunning: false, destinationRunning: true });
        expect(startSource).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledTimes(1);
        expect(retryEvents).toEqual([
            'activate-destination',
            'stop-destination',
            'quarantine-destination',
            'publish',
            'activate-destination',
        ]);
        expect(publish).toHaveBeenCalledWith({ homeServerIdentityId: IDENTITY, newConnectionDescriptor: descriptor() });
        expect((await readMarker(source))?.phase).toBe('committed');
        await rm(root, { recursive: true, force: true });
    });

    describe('recovery phase machine', () => {
        it('rolls a staged relocation back by quarantining and discarding the destination and restarting the prior source', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'staged');
            await seedMarker(destination, 'staged');
            const startSource = vi.fn(async () => undefined);
            const stopDestination = vi.fn(async () => undefined);
            const quarantineDestination = vi.fn(async () => undefined);
            const discardDestination = vi.fn(async () => undefined);
            const activateDestination = vi.fn(async () => ({ healthy: true, homeServerIdentityId: IDENTITY }));
            const publish = vi.fn(async () => undefined);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource, stopDestination, quarantineDestination, discardDestination, activateDestination, commitSameHomeRelocation: publish,
            });
            expect(result).toMatchObject({ action: 'rollback', phase: 'staged', sourceRunning: true, destinationRunning: false });
            expect(quarantineDestination).toHaveBeenCalledTimes(1);
            expect(discardDestination).toHaveBeenCalledTimes(1);
            expect(startSource).toHaveBeenCalledTimes(1);
            expect(activateDestination).not.toHaveBeenCalled();
            expect(publish).not.toHaveBeenCalled();
            await expect(readMarker(source)).resolves.toBeNull();
            await expect(readMarker(destination)).resolves.toBeNull();
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('discards a staged destination and restores the previously-running source authority', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'staged');
            await seedMarker(destination, 'staged');
            const startSource = vi.fn(async () => undefined);
            const discardDestination = vi.fn(async () => undefined);
            const activateDestination = vi.fn(async () => ({ healthy: true, homeServerIdentityId: IDENTITY }));
            const publish = vi.fn(async () => undefined);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'discard',
                startSource, stopDestination: async () => undefined, quarantineDestination: async () => undefined, discardDestination, activateDestination, commitSameHomeRelocation: publish,
            });
            expect(result).toMatchObject({ action: 'discard', phase: 'staged', sourceRunning: true, destinationRunning: false });
            expect(discardDestination).toHaveBeenCalledTimes(1);
            expect(startSource).toHaveBeenCalledTimes(1);
            expect(activateDestination).not.toHaveBeenCalled();
            expect(publish).not.toHaveBeenCalled();
            await expect(readMarker(source)).resolves.toBeNull();
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('rejects publication retry from the staged phase because nothing was verified', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'staged');
            await seedMarker(destination, 'staged');
            const activateDestination = vi.fn(async () => ({ healthy: true, homeServerIdentityId: IDENTITY }));
            const publish = vi.fn(async () => undefined);
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'retry_publication', destinationDescriptor: descriptor(),
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination, commitSameHomeRelocation: publish,
            })).rejects.toThrow('staged');
            expect(activateDestination).not.toHaveBeenCalled();
            expect(publish).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('staged');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('re-attests and publishes a verified destination once, then marks the relocation committed', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'verified');
            await seedMarker(destination, 'verified');
            const startSource = vi.fn(async () => undefined);
            const activateDestination = vi.fn(async () => ({ healthy: true, homeServerIdentityId: IDENTITY }));
            const publish = vi.fn(async () => undefined);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'retry_publication', destinationDescriptor: descriptor(),
                startSource, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination, commitSameHomeRelocation: publish,
            });
            expect(result).toMatchObject({ action: 'retry_publication', phase: 'committed', sourceRunning: false, destinationRunning: true });
            expect(activateDestination).toHaveBeenCalledTimes(2);
            expect(publish).toHaveBeenCalledTimes(1);
            expect(startSource).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('committed');
            expect((await readMarker(destination))?.phase).toBe('committed');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('demotes a verified relocation to pending, stopped and quarantined when re-attestation fails', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'verified');
            await seedMarker(destination, 'verified');
            const stopDestination = vi.fn(async () => undefined);
            const quarantineDestination = vi.fn(async () => undefined);
            const publish = vi.fn(async () => undefined);
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'retry_publication', destinationDescriptor: descriptor(),
                startSource: async () => undefined, stopDestination, quarantineDestination,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: false, homeServerIdentityId: IDENTITY }), commitSameHomeRelocation: publish,
            })).rejects.toThrow('health or identity attestation');
            expect(stopDestination).toHaveBeenCalledTimes(1);
            expect(quarantineDestination).toHaveBeenCalledTimes(1);
            expect(publish).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('pending');
            expect((await readMarker(destination))?.phase).toBe('pending');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('keeps a pending relocation pending, stopped and quarantined when the retried publication fails', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'pending');
            await seedMarker(destination, 'pending');
            const stopDestination = vi.fn(async () => undefined);
            const quarantineDestination = vi.fn(async () => undefined);
            const startSource = vi.fn(async () => undefined);
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'retry_publication', destinationDescriptor: descriptor(),
                startSource, stopDestination, quarantineDestination, discardDestination: async () => undefined,
                activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => { throw new Error('directory unreachable'); },
            })).rejects.toThrow('directory unreachable');
            expect(stopDestination).toHaveBeenCalledTimes(1);
            expect(quarantineDestination).toHaveBeenCalledTimes(1);
            expect(startSource).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('pending');
            expect((await readMarker(destination))?.phase).toBe('pending');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('rolls a verified relocation back by stopping, quarantining and discarding the destination, then restarting the prior source', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'verified');
            await seedMarker(destination, 'verified');
            const stopDestination = vi.fn(async () => undefined);
            const quarantineDestination = vi.fn(async () => undefined);
            const discardDestination = vi.fn(async () => undefined);
            const startSource = vi.fn(async () => undefined);
            const publish = vi.fn(async () => undefined);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource, stopDestination, quarantineDestination, discardDestination,
                activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }), commitSameHomeRelocation: publish,
            });
            expect(result).toMatchObject({ action: 'rollback', phase: 'verified', sourceRunning: true, destinationRunning: false });
            expect(stopDestination).toHaveBeenCalledTimes(1);
            expect(quarantineDestination).toHaveBeenCalledTimes(1);
            expect(discardDestination).toHaveBeenCalledTimes(1);
            expect(startSource).toHaveBeenCalledTimes(1);
            expect(publish).not.toHaveBeenCalled();
            await expect(readMarker(source)).resolves.toBeNull();
            await expect(readMarker(destination)).resolves.toBeNull();
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('rolls a pending relocation back without restarting a source that was not running before', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'pending', { priorSourceRunning: false });
            await seedMarker(destination, 'pending', { priorSourceRunning: false });
            const startSource = vi.fn(async () => undefined);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource, stopDestination: async () => undefined, quarantineDestination: async () => undefined, discardDestination: async () => undefined,
                activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }), commitSameHomeRelocation: async () => undefined,
            });
            expect(result).toMatchObject({ action: 'rollback', phase: 'pending', sourceRunning: false, destinationRunning: false });
            expect(startSource).not.toHaveBeenCalled();
            await expect(readMarker(source)).resolves.toBeNull();
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('does not restart the source when explicit rollback cannot stop and quarantine the destination', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'pending');
            await seedMarker(destination, 'pending');
            const startSource = vi.fn(async () => undefined);
            let observed: unknown;
            try {
                await recoverPersonalHomeRelocation({
                    sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                    startSource,
                    stopDestination: async () => { throw new Error('destination stop failed'); },
                    quarantineDestination: async () => { throw new Error('destination quarantine failed'); },
                    discardDestination: async () => undefined,
                    activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                    commitSameHomeRelocation: async () => undefined,
                });
            } catch (error) {
                observed = error;
            }
            expect(observed).toBeInstanceOf(AggregateError);
            expect(startSource).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('pending');
            expect((await readMarker(destination))?.phase).toBe('pending');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('rejects every action on a committed relocation without touching either home or the markers', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'committed');
            await seedMarker(destination, 'committed');
            const startSource = vi.fn(async () => undefined);
            const stopDestination = vi.fn(async () => undefined);
            const quarantineDestination = vi.fn(async () => undefined);
            const discardDestination = vi.fn(async () => undefined);
            const activateDestination = vi.fn(async () => ({ healthy: true, homeServerIdentityId: IDENTITY }));
            const publish = vi.fn(async () => undefined);
            for (const action of ['retry_publication', 'rollback', 'discard'] as const) {
                await expect(recoverPersonalHomeRelocation({
                    sourceDataDir: source, destinationDataDir: destination, action,
                    ...(action === 'retry_publication' ? { destinationDescriptor: descriptor() } : {}),
                    startSource, stopDestination, quarantineDestination, discardDestination, activateDestination, commitSameHomeRelocation: publish,
                })).rejects.toThrow('committed');
            }
            expect(startSource).not.toHaveBeenCalled();
            expect(stopDestination).not.toHaveBeenCalled();
            expect(quarantineDestination).not.toHaveBeenCalled();
            expect(discardDestination).not.toHaveBeenCalled();
            expect(activateDestination).not.toHaveBeenCalled();
            expect(publish).not.toHaveBeenCalled();
            expect((await readMarker(source))?.phase).toBe('committed');
            expect((await readMarker(destination))?.phase).toBe('committed');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it.each([
            { phase: 'staged' as const, destinationPhase: null },
            { phase: 'verified' as const, destinationPhase: 'staged' as const },
            { phase: 'pending' as const, destinationPhase: 'verified' as const },
        ])('reconciles an interrupted source-first $phase marker write before rollback', { timeout: 60_000 }, async ({ phase, destinationPhase }) => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, phase);
            if (destinationPhase) await seedMarker(destination, destinationPhase);
            const result = await recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            });
            expect(result.phase).toBe(phase);
            await expect(readMarker(source)).resolves.toBeNull();
            await expect(readMarker(destination)).resolves.toBeNull();
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('reconciles an interrupted committed marker write before rejecting recovery actions', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(source, 'committed');
            await seedMarker(destination, 'pending');
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            })).rejects.toThrow('committed');
            expect((await readMarker(source))?.phase).toBe('committed');
            expect((await readMarker(destination))?.phase).toBe('committed');
            await rm(join(source, '..'), { recursive: true, force: true });
        });

        it('fails closed when the source marker is missing, markers diverge, are malformed, or record other directories', { timeout: 60_000 }, async () => {
            const { source, destination } = await makeRoots();
            await seedMarker(destination, 'pending');
            // A destination-only marker cannot result from the source-first persistence order.
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            })).rejects.toThrow('missing, malformed, or divergent');
            // A destination marker ahead of the source contradicts source-first persistence.
            await seedMarker(source, 'verified');
            await seedMarker(destination, 'pending');
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            })).rejects.toThrow('missing, malformed, or divergent');
            // malformed phase value
            await seedMarker(destination, 'pending');
            await writeFile(join(destination, '.operations', 'relocation.json'), `${JSON.stringify({ ...(await readMarker(destination)), phase: 'bogus' })}\n`);
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            })).rejects.toThrow('missing, malformed, or divergent');
            // marker recorded against foreign directories
            await seedMarker(source, 'pending', { sourceDataDir: '/elsewhere/source', destinationDataDir: '/elsewhere/destination' });
            await seedMarker(destination, 'pending', { sourceDataDir: '/elsewhere/source', destinationDataDir: '/elsewhere/destination' });
            await expect(recoverPersonalHomeRelocation({
                sourceDataDir: source, destinationDataDir: destination, action: 'rollback',
                startSource: async () => undefined, stopDestination: async () => undefined, quarantineDestination: async () => undefined,
                discardDestination: async () => undefined, activateDestination: async () => ({ healthy: true, homeServerIdentityId: IDENTITY }),
                commitSameHomeRelocation: async () => undefined,
            })).rejects.toThrow('missing, malformed, or divergent');
            await rm(join(source, '..'), { recursive: true, force: true });
        });
    });
});
