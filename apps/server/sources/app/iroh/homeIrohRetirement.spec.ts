import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    createFileHomeConnectionDescriptorContinuityStore,
} from '@/app/features/homeConnectionDescriptorContinuity';
import {
    readHomeConnectionDescriptor,
    resetHomeConnectionDescriptorRevisionOwnerForTests,
} from '@/app/features/homeConnectionDescriptorPublication';

import * as owner from './homeIrohEndpoint';

vi.mock('@/utils/logging/log', () => ({ log: vi.fn() }));
vi.mock('@/app/serverIdentity/serverIdentity', () => ({
    getOrCreateServerIdentityId: vi.fn(async () => 'srv_iroh_retirement_spec'),
    readCachedServerIdentityIdForHotPath: vi.fn(() => 'srv_iroh_retirement_spec'),
}));

const FIRST_ENDPOINT_ID = 'a'.repeat(64);
const SECOND_ENDPOINT_ID = 'b'.repeat(64);
const API_PORT = 3005;

type NativeLifecycle = NonNullable<Parameters<typeof owner.ensureHomeIrohEndpoint>[0]['native']>;

/** The native transport is the system boundary; each created endpoint reports the next identity. */
function createNativeFake(endpointIds: string[]): NativeLifecycle {
    let current = endpointIds[0]!;
    return {
        createEndpoint: vi.fn(async (request: { keyPath: string; relayPolicy: string; relayUrls: readonly string[] }) => {
            current = endpointIds.shift()!;
            return {
                endpointHandle: `${request.keyPath}#${current}`,
                endpointId: current,
                relayMode: 'custom',
                capProfile: 'homeInteractive',
                relayUrls: [...request.relayUrls],
            };
        }),
        startHomeAcceptor: vi.fn(async (request: { endpointHandle: string }) => ({
            endpointHandle: request.endpointHandle,
            reused: false,
            status: { running: true },
        })),
        stopHomeAcceptor: vi.fn(async () => {}),
        getEndpointStatus: vi.fn(async () => ({ endpointId: current, directAddresses: [], active: true })),
        shutdownEndpoint: vi.fn(async () => {}),
    } as unknown as NativeLifecycle;
}

describe('owner-initiated Iroh retirement (plan §3.2, AM-2)', () => {
    let dataDir: string;

    beforeEach(async () => {
        dataDir = await mkdtemp(join(tmpdir(), 'home-iroh-retirement-'));
        resetHomeConnectionDescriptorRevisionOwnerForTests();
    });

    afterEach(async () => {
        await owner.resetHomeIrohEndpointStateForTests();
        resetHomeConnectionDescriptorRevisionOwnerForTests();
        await rm(dataDir, { recursive: true, force: true });
    });

    it('publishes `retired` through the continuity owner, forgets the identity, and re-enabling mints a new one', async () => {
        const env: NodeJS.ProcessEnv = {
            HAPPIER_CANONICAL_SERVER_URL: 'https://home.example.test',
            HAPPIER_PUBLIC_SERVER_URL: 'https://ingress.example.test',
            HAPPIER_MANAGED_RELAY_PURPOSE: 'personal-home',
            HAPPIER_SERVER_LIGHT_DATA_DIR: dataDir,
        };
        const keyPath = join(dataDir, 'runtime', 'iroh', 'endpoint.key');
        await mkdir(join(dataDir, 'runtime', 'iroh'), { recursive: true });
        await writeFile(keyPath, Buffer.alloc(32, 7));
        const continuityPath = join(dataDir, 'runtime', 'iroh', 'home.descriptor.json');
        const continuityStore = createFileHomeConnectionDescriptorContinuityStore(continuityPath);
        const native = createNativeFake([FIRST_ENDPOINT_ID, SECOND_ENDPOINT_ID]);
        owner.registerHomeIrohComposition({ env, apiPort: API_PORT, continuityStore, native });
        const publish = async () => await readHomeConnectionDescriptor({ env, continuityStore, visibility: 'authenticated' });

        await expect(owner.resumeHomeIrohEndpoint()).resolves.toMatchObject({ status: 'active' });
        const active = await publish();
        expect(active?.endpoints.map((endpoint) => endpoint.kind)).toEqual(['https', 'iroh']);
        expect(JSON.parse(await readFile(continuityPath, 'utf8'))).toMatchObject({ irohEndpointId: FIRST_ENDPOINT_ID });

        await expect(owner.retireHomeIrohEndpoint()).resolves.toMatchObject({ status: 'retired' });
        await expect(owner.getHomeIrohEndpointState()).resolves.toMatchObject({ status: 'retired' });
        await expect(stat(keyPath)).rejects.toMatchObject({ code: 'ENOENT' });
        const retired = await publish();
        expect(retired?.revision).toBe((active?.revision ?? 0) + 1);
        expect(retired?.endpoints).toEqual([{ kind: 'https', url: 'https://ingress.example.test' }]);
        expect(JSON.parse(await readFile(continuityPath, 'utf8'))).not.toHaveProperty('irohEndpointId');

        await expect(owner.resumeHomeIrohEndpoint()).resolves.toMatchObject({ status: 'active' });
        const renewed = await publish();
        expect(renewed?.revision).toBe((retired?.revision ?? 0) + 1);
        expect(renewed?.endpoints).toContainEqual(expect.objectContaining({ kind: 'iroh', endpointId: SECOND_ENDPOINT_ID }));
        expect(JSON.parse(await readFile(continuityPath, 'utf8'))).toMatchObject({ irohEndpointId: SECOND_ENDPOINT_ID });
    });

    it('stays retired across a start when the Home keeps direct connections off', async () => {
        owner.markHomeIrohEndpointRetired();
        await expect(owner.getHomeIrohEndpointState()).resolves.toEqual({ status: 'retired', snapshot: null, failureReason: null });
    });
});
