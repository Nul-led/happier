import { afterEach, describe, expect, it, vi } from 'vitest';
import { MMKV } from 'react-native-mmkv';

import { scopedStorageId } from '@/utils/system/storageScope';

function randomScope(): string {
    return `adoption_authority_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function importFresh() {
    vi.resetModules();
    return await import('./serverProfiles');
}

describe('serverProfiles adoption authority', () => {
    const previousScope = process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;

    afterEach(() => {
        if (previousScope === undefined) delete process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE;
        else process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = previousScope;
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('fails direct adoption closed on divergent facts at an equal descriptor revision', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const original = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_equal_revision_owner_1',
                canonicalServerUrl: 'https://equal-owner.example.test',
                revision: 8,
                endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
            },
        });

        await expect(profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_equal_revision_owner_1',
                canonicalServerUrl: 'https://equal-owner.example.test',
                revision: 8,
                endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
            },
        })).resolves.toEqual(original);

        const conflictingDescriptor = {
            v: 1 as const,
            homeServerIdentityId: 'srv_equal_revision_owner_1',
            canonicalServerUrl: 'https://equal-owner.example.test',
            revision: 8,
            endpoints: [{ kind: 'iroh' as const, endpointId: 'b'.repeat(64) }],
        };
        expect(() => profiles.preflightHomeProfileAdoption({
            source: 'account-directory',
            descriptor: conflictingDescriptor,
        })).toThrow(expect.objectContaining({ code: 'equal_revision_conflict' }));
        await expect(profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptor: conflictingDescriptor,
        })).rejects.toMatchObject({ code: 'equal_revision_conflict' });
        await expect(profiles.reconcileServerProfileHomeConnectionDescriptor({
            serverUrl: original.serverUrl,
            observedServerIdentityId: 'srv_equal_revision_owner_1',
            descriptor: conflictingDescriptor,
        })).resolves.toMatchObject({ kind: 'conflict', code: 'equal_revision_conflict' });
        expect(profiles.getServerProfileById(original.id)?.irohEndpoint?.endpointId).toBe('a'.repeat(64));
    });

    it('does not let a newer advisory Directory descriptor retarget an existing Home or focus', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const original = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_advisory_owner_1',
                canonicalServerUrl: 'https://home-authored.example.test',
                revision: 3,
                endpoints: [
                    { kind: 'https', url: 'https://public.home-authored.example.test' },
                    { kind: 'iroh', endpointId: 'a'.repeat(64) },
                ],
            },
        });
        profiles.setActiveServerId(original.id);
        const focusBefore = profiles.getActiveServerSnapshot();
        // Focus updates usage timestamps; compare against the post-focus stored profile
        // so the assertion isolates advisory retargeting (routing facts), not focus.
        const storedBefore = profiles.getServerProfileById(original.id);

        const adopted = await profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_advisory_owner_1',
                canonicalServerUrl: 'https://directory-retarget.example.test',
                revision: 99,
                endpoints: [
                    { kind: 'https', url: 'https://directory-public-retarget.example.test' },
                    { kind: 'iroh', endpointId: 'b'.repeat(64) },
                ],
            },
        });

        expect(adopted).toEqual(storedBefore);
        expect(profiles.getActiveServerSnapshot()).toMatchObject({
            serverId: focusBefore.serverId,
            serverUrl: focusBefore.serverUrl,
        });
    });

    it('rejects the retired redemption-coupled authority instead of treating it as established authority', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const retiredInput = {
            source: 'account-directory' as const,
            descriptorAuthority: 'redemption_coupled',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_retired_authority_1',
                canonicalServerUrl: 'https://directory-route.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://directory-route.example.test' }],
            },
        } as unknown as Parameters<typeof profiles.preflightHomeProfileAdoption>[0];

        expect(() => profiles.preflightHomeProfileAdoption(retiredInput))
            .toThrow('Invalid Home descriptor authority');
        await expect(profiles.adoptHomeProfile(retiredInput))
            .rejects.toThrow('Invalid Home descriptor authority');
        expect(profiles.listServerProfiles()).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ serverIdentityId: 'srv_retired_authority_1' }),
        ]));
    });

    it('keeps an advisory descriptor unchanged when public features expose a projection', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const placeholder = await profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_advisory_public_1',
                canonicalServerUrl: 'https://advisory-public.example.test',
                revision: 99,
                endpoints: [{
                    kind: 'iroh',
                    endpointId: 'a'.repeat(64),
                    relayUrls: ['https://relay-directory.example.test'],
                    directAddresses: ['192.0.2.200:443'],
                }],
            },
        });

        const result = await profiles.reconcileServerProfileHomeConnectionDescriptor({
            serverUrl: placeholder.serverUrl,
            observedServerIdentityId: 'srv_advisory_public_1',
            observation: 'public',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_advisory_public_1',
                canonicalServerUrl: 'https://advisory-public.example.test',
                revision: 1,
                endpoints: [{
                    kind: 'iroh',
                    endpointId: 'a'.repeat(64),
                    relayUrls: ['https://relay-observed.example.test'],
                }],
            },
        });

        expect(result.kind).toBe('stale');
        expect(profiles.getServerProfileById(placeholder.id)?.irohEndpoint).toEqual({
            endpointId: 'a'.repeat(64),
            relayUrls: ['https://relay-directory.example.test'],
            directAddresses: ['192.0.2.200:443'],
        });
    });

    it('keeps an established private descriptor generation unchanged across a reduced public observation', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const established = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_established_public_1',
                canonicalServerUrl: 'https://established-public.example.test',
                revision: 4,
                endpoints: [{
                    kind: 'iroh',
                    endpointId: 'b'.repeat(64),
                    relayUrls: ['https://relay-old.example.test'],
                    directAddresses: ['192.0.2.201:443'],
                }],
            },
        });

        const result = await profiles.reconcileServerProfileHomeConnectionDescriptor({
            serverUrl: established.serverUrl,
            observedServerIdentityId: 'srv_established_public_1',
            observation: 'public',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_established_public_1',
                canonicalServerUrl: 'https://established-public.example.test',
                revision: 5,
                endpoints: [{
                    kind: 'iroh',
                    endpointId: 'b'.repeat(64),
                    relayUrls: ['https://relay-new.example.test'],
                }],
            },
        });

        expect(result.kind).toBe('unchanged');
        expect(profiles.getServerProfileById(established.id)).toMatchObject({
            connectionDescriptorRevision: 4,
            irohEndpoint: {
                endpointId: 'b'.repeat(64),
                relayUrls: ['https://relay-old.example.test'],
                directAddresses: ['192.0.2.201:443'],
            },
        });
    });

    it('keeps current_connection_observation established authority while upgrading advisory-only placeholders wholesale', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const established = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_observed_1',
                canonicalServerUrl: 'https://observed.example.test',
                revision: 4,
                endpoints: [{ kind: 'iroh', endpointId: 'a'.repeat(64) }],
            },
        });
        // Established reconciliation keeps its revision authority: stale observation loses.
        await expect(profiles.reconcileServerProfileHomeConnectionDescriptor({
            serverUrl: established.serverUrl,
            observedServerIdentityId: 'srv_observed_1',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_observed_1',
                canonicalServerUrl: 'https://observed.example.test',
                revision: 2,
                endpoints: [{ kind: 'iroh', endpointId: 'b'.repeat(64) }],
            },
        })).resolves.toMatchObject({ kind: 'stale' });

        const placeholder = await profiles.adoptHomeProfile({
            source: 'account-directory',
            descriptorAuthority: 'advisory',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_observed_2',
                canonicalServerUrl: 'https://observed-fake.example.test',
                revision: 99,
                endpoints: [{ kind: 'https', url: 'https://observed-fake.example.test' }],
            },
        });
        const observed = await profiles.reconcileServerProfileHomeConnectionDescriptor({
            serverUrl: placeholder.serverUrl,
            observedServerIdentityId: 'srv_observed_2',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_observed_2',
                canonicalServerUrl: 'https://observed-real.example.test',
                revision: 2,
                endpoints: [{ kind: 'iroh', endpointId: 'd'.repeat(64) }],
            },
        });
        expect(observed).toMatchObject({ kind: 'applied' });
        const upgraded = profiles.getServerProfileById(placeholder.id);
        expect(upgraded?.descriptorProvenance).toBeUndefined();
        expect(upgraded?.canonicalServerUrl ?? upgraded?.serverUrl).toBe('https://observed-real.example.test');
        expect(upgraded?.connectionDescriptorRevision).toBe(2);
    });

    it('treats durable adoption as committed even when independent observers throw', async () => {
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = randomScope();
        const profiles = await importFresh();
        const laterProfileObserver = vi.fn();
        const laterActiveObserver = vi.fn();
        const reported = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const unsubscribers = [
            profiles.subscribeServerProfiles(() => { throw new Error('profile observer failed'); }),
            profiles.subscribeServerProfiles(laterProfileObserver),
            profiles.subscribeActiveServer(() => { throw new Error('active observer failed'); }),
            profiles.subscribeActiveServer(laterActiveObserver),
        ];

        try {
            const adopted = await profiles.adoptHomeProfile({
                source: 'qr',
                descriptor: {
                    v: 1,
                    homeServerIdentityId: 'srv_observer_owner_1',
                    canonicalServerUrl: 'https://observer-owner.example.test',
                    revision: 1,
                    endpoints: [{ kind: 'https', url: 'https://observer-owner.example.test' }],
                },
            });
            expect(profiles.getServerProfileById(adopted.id)?.serverIdentityId).toBe('srv_observer_owner_1');
            expect(laterProfileObserver).toHaveBeenCalledOnce();
            expect(laterActiveObserver).toHaveBeenCalledOnce();
            expect(reported).toHaveBeenCalledTimes(2);
        } finally {
            for (const unsubscribe of unsubscribers) unsubscribe();
        }
    });

    it('preserves the exact unknown source through a same-profile strict adoption', async () => {
        const scope = randomScope();
        process.env.EXPO_PUBLIC_HAPPY_STORAGE_SCOPE = scope;
        const storage = new MMKV({ id: scopedStorageId('server-profiles', scope) });
        storage.set('server-state-v1', JSON.stringify({
            activeServerId: 'future-home',
            servers: {
                'future-home': {
                    id: 'future-home',
                    name: 'Future Home',
                    serverUrl: 'https://future-owner.example.test',
                    source: 'Future-Directory-V2',
                    createdAt: 1,
                    updatedAt: 1,
                    lastUsedAt: 1,
                },
            },
        }));
        const profiles = await importFresh();

        const adopted = await profiles.adoptHomeProfile({
            source: 'qr',
            descriptor: {
                v: 1,
                homeServerIdentityId: 'srv_future_owner_1',
                canonicalServerUrl: 'https://future-owner.example.test',
                revision: 1,
                endpoints: [{ kind: 'https', url: 'https://future-owner.example.test' }],
            },
        });

        expect(adopted).toMatchObject({ source: 'legacy', legacySource: 'Future-Directory-V2' });
        const persisted = JSON.parse(storage.getString('server-state-v1') ?? '{}') as {
            servers?: Record<string, { source?: string }>;
        };
        expect(persisted.servers?.['future-home']?.source).toBe('Future-Directory-V2');
    });
});
