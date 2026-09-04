import { describe, expect, it, vi } from 'vitest';

import type { SystemTaskSpec } from '@happier-dev/protocol';
import { SystemTaskExecutionError } from '@happier-dev/cli-common/systemTasks';
import type { NativeSshModule } from '@happier-dev/ssh-native';

const HOME_TARGET = {
    profileId: 'home-profile',
    homeServerIdentityId: 'srv_home_identity',
    descriptor: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_identity',
        canonicalServerUrl: 'https://relay.example.test',
        revision: 1,
        endpoints: [{ kind: 'https' as const, url: 'https://relay.example.test' }],
    },
    canonicalAuthUrl: 'https://relay.example.test',
    applicationUrl: 'https://relay.example.test',
    webappUrl: 'https://relay.example.test',
    credentialDestination: {
        v: 1 as const,
        homeServerIdentityId: 'srv_home_identity',
        canonicalServerUrl: 'https://relay.example.test',
        applicationEndpointUrls: ['https://relay.example.test'],
        irohEndpointIds: [],
    },
    preferredTransport: 'https' as const,
    authority: 'saved_profile' as const,
};

const REMOTE_PUBLIC_KEY = Buffer.alloc(32, 3).toString('base64');
const PAIRING_SECRET = Buffer.alloc(32, 7).toString('base64url');

function completeRemoteEnrollment(
    options: Readonly<{ onStdoutChunk?: (text: string) => void }>,
    input: Readonly<{
        homeServerIdentityId?: string;
        publicKey?: string;
        createdAtMs?: number;
        expiresAtMs?: number;
    }> = {},
) {
    const homeServerIdentityId = input.homeServerIdentityId ?? HOME_TARGET.homeServerIdentityId;
    const request = JSON.stringify({
        kind: 'remote_home_enrollment_pairing_request',
        protocolVersion: 1,
        publicKey: input.publicKey ?? REMOTE_PUBLIC_KEY,
        homeServerIdentityId,
        pairing: {
            secretB64Url: PAIRING_SECRET,
            createdAtMs: input.createdAtMs ?? 123,
            expiresAtMs: input.expiresAtMs ?? 456,
        },
        supportsTokenOnly: true,
        pairingRequirement: 'v3',
    });
    const result = JSON.stringify({
        kind: 'remote_home_enrollment_result',
        protocolVersion: 1,
        success: true,
        homeServerIdentityId,
        machineId: 'machine-paired',
        encryptionType: 'tokenOnly',
        pairingAuthentication: 'v3',
        remoteProfileId: 'remote-home-profile',
    });
    const stdout = `${request}\n${result}\n`;
    options.onStdoutChunk?.(stdout);
    return { status: 0, stdout, stderr: '' };
}

function createRemoteBootstrapSpec(overrides: Partial<SystemTaskSpec> = {}): SystemTaskSpec {
    return {
        protocolVersion: 1,
        kind: 'remote.ssh.bootstrapMachine.v1',
        params: {
            remoteHostId: 'host-a',
            ssh: {
                target: 'dev@10.0.0.5',
                port: 2222,
                auth: 'password',
                password: 'secret',
            },
            relay: {
                relayUrl: 'https://relay.example.test',
                webappUrl: 'http://localhost.:3005',
            },
            channel: 'stable',
            serviceMode: 'none',
            knownHostsMode: 'app',
        },
        ...overrides,
    };
}

describe('runNativeRemoteSshBootstrapTask', () => {
    it('runs the shared bootstrap recipe over native SSH for remotes with an installed Happier CLI', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const commands: string[] = [];
        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async (request) => {
                commands.push(request.command);
                if (request.command.includes('auth status')) {
                    return {
                        exitCode: 0,
                        stdout: JSON.stringify({
                            ok: true,
                            data: {
                                authenticated: true,
                                credentialState: 'valid',
                                machineRegistered: true,
                                machineRegistrationState: 'server-confirmed',
                                machineId: 'machine-a',
                            },
                        }),
                        stderr: '',
                    };
                }
                return {
                    exitCode: 0,
                    stdout: JSON.stringify({
                        ok: true,
                        data: {},
                    }),
                    stderr: '',
                };
            }),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;

        await expect(loaded!.runNativeRemoteSshBootstrapTask({
            taskId: 'task-a',
            nativeModule,
            spec: createRemoteBootstrapSpec(),
        })).resolves.toEqual({
            machineId: 'machine-a',
        });
        expect(commands.some((command) => command.includes('server set'))).toBe(true);
        expect(commands.some((command) => command.includes('http://localhost.:3005'))).toBe(false);
        expect(commands.some((command) => command.includes('auth status'))).toBe(true);
    });

    it('installs the remote CLI through the verified native self-download hook for fresh remotes', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 127,
                stdout: '',
                stderr: 'happier: command not found',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        const commands: string[] = [];
        let serverConfigureAttempts = 0;
        const commandRunner = {
            runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                commands.push(command);
                if (command.includes('server set')) {
                    serverConfigureAttempts += 1;
                    return serverConfigureAttempts === 1
                        ? { ok: false, data: {} }
                        : { ok: true, data: {} };
                }
                if (command.includes('auth status')) {
                    return {
                        ok: true,
                        data: {
                            authenticated: true,
                            credentialState: 'valid',
                            machineRegistered: true,
                            machineRegistrationState: 'server-confirmed',
                            machineId: 'machine-fresh',
                        },
                    };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async ({ command }: { command: string }) => {
                commands.push(command);
                if (command.includes('uname -s')) {
                    return {
                        status: 0,
                        stdout: JSON.stringify({ platform: 'linux', arch: 'x86_64' }),
                        stderr: '',
                    };
                }
                return { status: 0, stdout: '', stderr: '' };
            }),
        };

        await expect(loaded!.runNativeRemoteSshBootstrapTask({
            taskId: 'task-a',
            nativeModule,
            spec: createRemoteBootstrapSpec(),
            commandRunner,
            resolveInstallPlan: async () => ({
                binaryPath: '$HOME/.happier/cli/current/happier',
                versionId: '1.2.3',
                source: 'https://downloads.example.test/happier.tar.gz',
                command: 'verified self-download install command',
            }),
        })).resolves.toEqual({
            machineId: 'machine-fresh',
        });
        expect(commands).toContain('verified self-download install command');
    });

    it('normalizes failed auth status probes as unauthenticated so pairing can continue', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: {} }),
                stderr: '',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        const commandRunner = {
            runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                if (command.includes('auth status')) {
                    return { ok: false, data: { code: 'not_authenticated' } };
                }
                if (command.includes('auth request')) {
                    return {
                        ok: true,
                        data: {
                            publicKey: 'pubkey-a',
                            homeServerIdentityId: 'srv_home_identity',
                            pairing: { secretB64Url: 'secret', createdAtMs: 123, expiresAtMs: 456 },
                            supportsTokenOnly: true,
                            pairingRequirement: 'v3',
                        },
                    };
                }
                if (command.includes('auth wait')) {
                    return { ok: true, data: { machineId: 'machine-paired' } };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async (options: { onStdoutChunk?: (text: string) => void }) => completeRemoteEnrollment(options)),
        };

        await expect(loaded!.runNativeRemoteSshBootstrapTask({
            taskId: 'task-a',
            nativeModule,
            spec: createRemoteBootstrapSpec(),
            commandRunner,
            prompt: async () => ({ approved: true }),
            approveLocalAuthRequest: async () => undefined,
        })).resolves.toEqual({
            machineId: 'machine-paired',
            publicKey: REMOTE_PUBLIC_KEY,
        });
    });

    it('approves local terminal auth after the user accepts remote provisioning', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: {} }),
                stderr: '',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        const commandRunner = {
            runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                if (command.includes('auth status')) {
                    return { ok: false, data: { code: 'not_authenticated' } };
                }
                if (command.includes('auth request')) {
                    return {
                        ok: true,
                        data: {
                            publicKey: 'pubkey-a',
                            homeServerIdentityId: 'srv_home_identity',
                            pairing: {
                                secretB64Url: 'pairing-secret-b64url',
                                createdAtMs: 123,
                                expiresAtMs: 456,
                            },
                            supportsTokenOnly: true,
                            pairingRequirement: 'v3',
                        },
                    };
                }
                if (command.includes('auth wait')) {
                    return { ok: true, data: { machineId: 'machine-paired' } };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async (options: { onStdoutChunk?: (text: string) => void }) => completeRemoteEnrollment(options)),
        };
        const approveLocalAuthRequest = vi.fn(async () => undefined);

        await expect(loaded!.runNativeRemoteSshBootstrapTask({
            taskId: 'task-a',
            nativeModule,
            spec: createRemoteBootstrapSpec(),
            commandRunner,
            prompt: async () => ({ approved: true }),
            approveLocalAuthRequest,
        })).resolves.toEqual({
            machineId: 'machine-paired',
            publicKey: REMOTE_PUBLIC_KEY,
        });
        expect(approveLocalAuthRequest).toHaveBeenCalledWith({
            publicKey: REMOTE_PUBLIC_KEY,
            homeServerIdentityId: 'srv_home_identity',
            pairing: {
                secretB64Url: PAIRING_SECRET,
                createdAtMs: 123,
                expiresAtMs: 456,
            },
            supportsTokenOnly: true,
            endpointUrl: 'https://relay.example.test',
        });
    });

    it('installs optional relay runtime through the remote CLI over native SSH exec', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const commands: string[] = [];
        const nativeModule = {
            getAvailability: () => ({
                available: true,
                platform: 'android',
                engine: 'russh',
                moduleVersion: '0.0.0',
                supportsLoopbackTunnel: true,
                supportsPersistentHostKeyStorage: false,
            } as const),
            exec: vi.fn(async () => ({
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: {} }),
                stderr: '',
            })),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        const commandRunner = {
            runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                commands.push(command);
                if (command.includes('relay host install')) {
                    return {
                        ok: true,
                        data: {
                            relayUrl: 'http://127.0.0.1:40123',
                            mode: 'user',
                        },
                    };
                }
                if (command.includes('auth status')) {
                    return {
                        ok: true,
                        data: {
                            authenticated: true,
                            credentialState: 'valid',
                            machineRegistered: true,
                            machineRegistrationState: 'server-confirmed',
                            machineId: 'machine-relay',
                        },
                    };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
        };

        await expect(loaded!.runNativeRemoteSshBootstrapTask({
            taskId: 'task-a',
            nativeModule,
            spec: createRemoteBootstrapSpec({
                params: {
                    ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                    relayRuntime: {
                        enabled: true,
                        mode: 'user',
                    },
                },
            }),
            commandRunner,
        })).resolves.toEqual({
            machineId: 'machine-relay',
            relayRuntime: {
                relayUrl: 'http://127.0.0.1:40123',
                mode: 'user',
            },
        });
        expect(commands.some((command) => command.includes('relay host install'))).toBe(true);
    });

    it('rejects mobile-unsupported SSH agent credentials before native execution', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        expect(() => loaded!.readNativeSshTaskCredentials(createRemoteBootstrapSpec({
            params: {
                ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                ssh: {
                    target: 'dev@10.0.0.5',
                    port: 2222,
                    auth: 'agent',
                },
            },
        }))).toThrow('native_ssh_missing_credentials');
    });

    it('posts a pairing-bound data-key v3 response to the exact Home target', async () => {
        vi.resetModules();
        const authApproveWithTransport = vi.fn(async () => 'approved' as const);
        const machineKey = new Uint8Array(32).fill(5);
        const contentPublicKey = (await import('tweetnacl')).default.box.keyPair.fromSecretKey(machineKey).publicKey;
        const getCredentialsForServerUrl = vi.fn(async () => ({
            token: 'home-token',
            encryption: {
                publicKey: Buffer.from(contentPublicKey).toString('base64'),
                machineKey: Buffer.from(machineKey).toString('base64'),
            },
        }));
        vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
            return {
                ...actual,
                TokenStorage: {
                    getCredentialsForServerUrl,
                },
            };
        });
        vi.doMock('@/auth/flows/approve', () => ({ authApproveWithTransport }));
        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const profile = {
                id: 'home-profile',
                serverIdentityId: 'srv_home_identity',
                serverUrl: 'https://relay.example.test',
            };
            return {
                ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
                listServerProfiles: () => [profile],
                getServerProfileById: (profileId: string) => profileId === profile.id ? profile : null,
            };
        });

        try {
            const loaded = await import('./nativeTask');
            const nativeModule = {
                getAvailability: () => ({
                    available: true,
                    platform: 'android',
                    engine: 'russh',
                    moduleVersion: '0.0.0',
                    supportsLoopbackTunnel: true,
                    supportsPersistentHostKeyStorage: false,
                } as const),
                exec: vi.fn(async () => ({
                    exitCode: 0,
                    stdout: JSON.stringify({ ok: true, data: {} }),
                    stderr: '',
                })),
                cancelRequest: vi.fn(async () => undefined),
            } satisfies NativeSshModule;
            const publicKey = REMOTE_PUBLIC_KEY;
            const createdAtMs = Date.now() - 1_000;
            const expiresAtMs = Date.now() + 60_000;
            let remoteHomeServerIdentityId = 'srv_home_identity';
            let enrollmentCompleted = false;
            const commandRunner = {
                runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                    if (command.includes('auth status')) {
                        if (enrollmentCompleted) {
                            return {
                                ok: true,
                                data: {
                                    authenticated: true,
                                    credentialState: 'valid',
                                    machineRegistrationState: 'server-confirmed',
                                    machineId: 'machine-paired',
                                },
                            };
                        }
                        return { ok: false, data: { code: 'not_authenticated' } };
                    }
                    if (command.includes('auth request')) {
                        return {
                            ok: true,
                            data: {
                                publicKey,
                                pairing: {
                                    secretB64Url: Buffer.alloc(32, 7).toString('base64url'),
                                    createdAtMs,
                                    expiresAtMs,
                                },
                                supportsTokenOnly: true,
                                pairingRequirement: 'v3',
                                homeServerIdentityId: remoteHomeServerIdentityId,
                            },
                        };
                    }
                    if (command.includes('auth wait')) {
                        return { ok: true, data: { machineId: 'machine-paired' } };
                    }
                    return { ok: true, data: {} };
                }),
                runTextCommand: vi.fn(async (options: { onStdoutChunk?: (text: string) => void }) => {
                    const result = completeRemoteEnrollment(options, {
                        homeServerIdentityId: remoteHomeServerIdentityId,
                        publicKey,
                        createdAtMs,
                        expiresAtMs,
                    });
                    enrollmentCompleted = true;
                    return result;
                }),
            };

            await expect(loaded.runNativeRemoteSshBootstrapTask({
                taskId: 'task-token-only',
                nativeModule,
                spec: createRemoteBootstrapSpec({
                    params: {
                        ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                        homeTarget: HOME_TARGET,
                    },
                }),
                commandRunner,
                prompt: async () => ({ approved: true }),
            })).resolves.toMatchObject({ machineId: 'machine-paired' });
            expect(authApproveWithTransport).toHaveBeenCalledWith(expect.objectContaining({
                transport: expect.objectContaining({
                    runtimeOrigin: 'https://relay.example.test',
                    homeServerIdentityId: 'srv_home_identity',
                }),
                token: 'home-token',
                responseKind: 'dataKey',
            }));
            expect(getCredentialsForServerUrl).toHaveBeenCalledWith(
                'https://relay.example.test',
                { serverId: 'home-profile' },
            );

            remoteHomeServerIdentityId = 'srv_different_home';
            await expect(loaded.runNativeRemoteSshBootstrapTask({
                taskId: 'task-wrong-home',
                nativeModule,
                spec: createRemoteBootstrapSpec({
                    params: {
                        ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                        homeTarget: HOME_TARGET,
                    },
                }),
                commandRunner,
                prompt: async () => ({ approved: true }),
            })).rejects.toMatchObject({ code: 'home_identity_mismatch' });
            expect(authApproveWithTransport).toHaveBeenCalledTimes(1);
        } finally {
            vi.doUnmock('@/auth/storage/tokenStorage');
            vi.doUnmock('@/auth/flows/approve');
            vi.doUnmock('@/sync/domains/server/serverProfiles');
            vi.resetModules();
        }
    });

    it('acquires and releases the canonical Iroh enrollment transport for an Iroh-only Home target', async () => {
        vi.resetModules();
        const irohEndpointId = 'a'.repeat(64);
        const authApproveWithTransport = vi.fn(async () => 'approved' as const);
        const release = vi.fn(async () => undefined);
        const acquireIrohHomeRuntimeOrigin = vi.fn(async () => ({
            leaseId: 'native-task-iroh-lease',
            localUrl: 'http://127.0.0.1:45992',
            runtimeOrigin: 'http://127.0.0.1:45992',
            homeServerIdentityId: 'srv_home_identity',
            endpointId: irohEndpointId,
            carrier: 'iroh' as const,
            observedPath: 'direct' as const,
            status: 'ready' as const,
            release,
        }));
        const machineKey = new Uint8Array(32).fill(5);
        const contentPublicKey = (await import('tweetnacl')).default.box.keyPair.fromSecretKey(machineKey).publicKey;
        const getCredentialsForServerUrl = vi.fn(async () => ({
            token: 'home-token',
            encryption: {
                publicKey: Buffer.from(contentPublicKey).toString('base64'),
                machineKey: Buffer.from(machineKey).toString('base64'),
            },
        }));
        vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => ({
            ...await importOriginal<typeof import('@/auth/storage/tokenStorage')>(),
            TokenStorage: { getCredentialsForServerUrl },
        }));
        vi.doMock('@/auth/flows/approve', () => ({ authApproveWithTransport }));
        vi.doMock('@/sync/runtime/nativeIrohTunnels/runtime', () => ({ acquireIrohHomeRuntimeOrigin }));
        vi.doMock('@/sync/domains/server/serverProfiles', async (importOriginal) => {
            const profile = {
                id: 'home-profile',
                serverIdentityId: 'srv_home_identity',
                serverUrl: 'http://localhost:3010',
            };
            return {
                ...await importOriginal<typeof import('@/sync/domains/server/serverProfiles')>(),
                listServerProfiles: () => [profile],
                getServerProfileById: (profileId: string) => profileId === profile.id ? profile : null,
            };
        });

        try {
            const loaded = await import('./nativeTask');
            const nativeModule = {
                getAvailability: () => ({
                    available: true,
                    platform: 'android',
                    engine: 'russh',
                    moduleVersion: '0.0.0',
                    supportsLoopbackTunnel: true,
                    supportsPersistentHostKeyStorage: false,
                } as const),
                exec: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
                cancelRequest: vi.fn(async () => undefined),
            } satisfies NativeSshModule;
            let enrollmentCompleted = false;
            const commandRunner = {
                runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                    if (command.includes('auth status')) {
                        return enrollmentCompleted
                            ? {
                                ok: true,
                                data: {
                                    authenticated: true,
                                    credentialState: 'valid',
                                    machineRegistrationState: 'server-confirmed',
                                    machineId: 'machine-paired',
                                },
                            }
                            : { ok: false, data: { code: 'not_authenticated' } };
                    }
                    return { ok: true, data: {} };
                }),
                runTextCommand: vi.fn(async (options: { onStdoutChunk?: (text: string) => void }) => {
                    const result = completeRemoteEnrollment(options, {
                        createdAtMs: Date.now() - 1_000,
                        expiresAtMs: Date.now() + 60_000,
                    });
                    enrollmentCompleted = true;
                    return result;
                }),
            };
            const irohHomeTarget = {
                ...HOME_TARGET,
                descriptor: {
                    v: 1 as const,
                    homeServerIdentityId: 'srv_home_identity',
                    canonicalServerUrl: 'http://localhost:3010',
                    revision: 2,
                    endpoints: [{ kind: 'iroh' as const, endpointId: irohEndpointId }],
                },
                canonicalAuthUrl: 'http://localhost:3010',
                applicationUrl: 'http://localhost:3010',
                webappUrl: 'http://localhost:3010',
                credentialDestination: {
                    v: 1 as const,
                    homeServerIdentityId: 'srv_home_identity',
                    canonicalServerUrl: 'http://localhost:3010',
                    applicationEndpointUrls: [],
                    irohEndpointIds: [irohEndpointId],
                },
                preferredTransport: 'iroh' as const,
            };

            await expect(loaded.runNativeRemoteSshBootstrapTask({
                taskId: 'task-iroh-only',
                nativeModule,
                spec: createRemoteBootstrapSpec({
                    params: {
                        ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                        homeTarget: irohHomeTarget,
                    },
                }),
                commandRunner,
                prompt: async () => ({ approved: true }),
            })).resolves.toMatchObject({ machineId: 'machine-paired' });

            expect(acquireIrohHomeRuntimeOrigin).toHaveBeenCalledWith({
                homeServerIdentityId: 'srv_home_identity',
                endpoint: { kind: 'iroh', endpointId: irohEndpointId },
                canonicalServerUrl: 'http://localhost:3010',
                verification: { kind: 'enrollment' },
            });
            expect(authApproveWithTransport).toHaveBeenCalledWith(expect.objectContaining({
                transport: expect.objectContaining({
                    carrier: 'iroh',
                    endpointUrl: 'http://localhost:3010',
                    runtimeOrigin: 'http://127.0.0.1:45992',
                    homeServerIdentityId: 'srv_home_identity',
                }),
            }));
            expect(release).toHaveBeenCalledTimes(1);
        } finally {
            vi.doUnmock('@/auth/storage/tokenStorage');
            vi.doUnmock('@/auth/flows/approve');
            vi.doUnmock('@/sync/runtime/nativeIrohTunnels/runtime');
            vi.doUnmock('@/sync/domains/server/serverProfiles');
            vi.resetModules();
        }
    });

    it('passes encrypted private keys to native SSH so the shared passphrase prompt can unlock them', async () => {
        const loaded = await import('./nativeTask').catch(() => null);
        expect(loaded).not.toBeNull();

        const credentials = loaded!.readNativeSshTaskCredentials(createRemoteBootstrapSpec({
            params: {
                ...createRemoteBootstrapSpec().params as Record<string, unknown>,
                ssh: {
                    target: 'dev@10.0.0.5',
                    port: 2222,
                    auth: 'keyfile',
                    identityPrivateKey: [
                        '-----BEGIN ENCRYPTED PRIVATE KEY-----',
                        'private-key-body',
                        '-----END ENCRYPTED PRIVATE KEY-----',
                    ].join('\n'),
                },
            },
        }));

        expect(credentials.auth.privateKeyPem).toContain('BEGIN ENCRYPTED PRIVATE KEY');
    });
});
