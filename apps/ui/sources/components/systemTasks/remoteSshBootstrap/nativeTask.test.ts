import { describe, expect, it, vi } from 'vitest';

import tweetnacl from 'tweetnacl';
import { openTerminalProvisioningV3Response, deriveAccountMachineKeyFromRecoverySecret, FeaturesResponseSchema } from '@happier-dev/protocol';
import type { SystemTaskSpec } from '@happier-dev/protocol';
import { SystemTaskExecutionError } from '@happier-dev/cli-common/systemTasks';
import type { NativeSshModule } from '@happier-dev/ssh-native';

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
                    return { ok: true, data: { publicKey: 'pubkey-a' } };
                }
                if (command.includes('auth wait')) {
                    return { ok: true, data: { machineId: 'machine-paired' } };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
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
            publicKey: 'pubkey-a',
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
                    return { ok: true, data: { publicKey: 'pubkey-a' } };
                }
                if (command.includes('auth wait')) {
                    return { ok: true, data: { machineId: 'machine-paired' } };
                }
                return { ok: true, data: {} };
            }),
            runTextCommand: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
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
            publicKey: 'pubkey-a',
        });
        expect(approveLocalAuthRequest).toHaveBeenCalledWith('pubkey-a', { publicKey: 'pubkey-a' });
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

    it('reports a typed upgrade requirement without posting when local credentials are token-only', async () => {
        vi.resetModules();
        const authApprove = vi.fn();
        vi.doMock('@/auth/storage/tokenStorage', async (importOriginal) => {
            const actual = await importOriginal<typeof import('@/auth/storage/tokenStorage')>();
            return {
                ...actual,
                TokenStorage: {
                    getCredentials: vi.fn(async () => ({ token: 'plain-token' })),
                },
            };
        });
        vi.doMock('@/auth/flows/approve', () => ({ authApprove }));

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
            const profiles = await import('@/sync/domains/server/serverProfiles');
            profiles.setActiveServerId(profiles.upsertServerProfile({ serverUrl: 'https://relay.example.test', name: 'Fixture relay', source: 'manual' }).id);
            const publicKey = Buffer.alloc(32, 3).toString('base64url');
            const commandRunner = {
                runJsonCommand: vi.fn(async ({ command }: { command: string }) => {
                    if (command.includes('auth status')) {
                        return { ok: false, data: { code: 'not_authenticated' } };
                    }
                    if (command.includes('auth request')) {
                        return { ok: true, data: { publicKey } };
                    }
                    return { ok: true, data: {} };
                }),
                runTextCommand: vi.fn(async () => ({ status: 0, stdout: '', stderr: '' })),
            };

            await expect(loaded.runNativeRemoteSshBootstrapTask({
                taskId: 'task-token-only',
                nativeModule,
                spec: createRemoteBootstrapSpec(),
                commandRunner,
                prompt: async () => ({ approved: true }),
            })).rejects.toMatchObject({
                name: 'SystemTaskExecutionError',
                code: 'native_ssh_token_only_terminal_approval_upgrade_required',
            });
            expect(authApprove).not.toHaveBeenCalled();
        } finally {
            vi.doUnmock('@/auth/storage/tokenStorage');
            vi.doUnmock('@/auth/flows/approve');
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
    it.each([
        { name: 'keyed / relay v2', supportsV2: true, tokenOnly: false, accountMode: 'e2ee', keylessEnabled: true, supportsTokenOnly: true, allowed: true },
        { name: 'keyed / relay legacy transport', supportsV2: false, tokenOnly: false, accountMode: 'e2ee', keylessEnabled: true, supportsTokenOnly: true, allowed: true },
        { name: 'plain / relay v2', supportsV2: true, tokenOnly: true, accountMode: 'plain', keylessEnabled: true, supportsTokenOnly: true, allowed: true },
        { name: 'plain / relay legacy transport', supportsV2: false, tokenOnly: true, accountMode: 'plain', keylessEnabled: true, supportsTokenOnly: true, allowed: true },
        { name: 'token-only / E2EE account rejected', supportsV2: true, tokenOnly: true, accountMode: 'e2ee', keylessEnabled: true, supportsTokenOnly: true, allowed: false },
        { name: 'token-only / disabled keyless feature rejected', supportsV2: true, tokenOnly: true, accountMode: 'plain', keylessEnabled: false, supportsTokenOnly: true, allowed: false },
        { name: 'token-only / reader capability missing rejected', supportsV2: true, tokenOnly: true, accountMode: 'plain', keylessEnabled: true, supportsTokenOnly: false, allowed: false },
    ])('composes the native task default approval and real HTTP adapter: $name', async ({ supportsV2, tokenOnly, accountMode, keylessEnabled, supportsTokenOnly, allowed }) => {
        const { runNativeRemoteSshBootstrapTask } = await import('./nativeTask');
        const profiles = await import('@/sync/domains/server/serverProfiles');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        const previousServerId = profiles.getActiveServerId();
        const profile = profiles.upsertServerProfile({ serverUrl: 'https://relay.example.test', name: 'Fixture relay', source: 'manual' });
        profiles.setActiveServerId(profile.id);
        const accountSecret = new Uint8Array(32).fill(9);
        expect(await TokenStorage.setCredentials(tokenOnly ? { token: 'fixture-token' } : { token: 'fixture-token', secret: Buffer.from(accountSecret).toString('base64url') })).toBe(true);
        const features = await import('@/sync/api/capabilities/serverFeaturesClient');
        features.resetServerFeaturesClientForTests();
        const accountModeApi = await import('@/sync/api/account/apiAccountEncryptionMode');
        accountModeApi.invalidateAccountEncryptionModeCache();
        const keypair = tweetnacl.box.keyPair();
        const nowMs = Date.now();
        const pairingSecret = new Uint8Array(32).fill(7);
        const packet = { publicKey: Buffer.from(keypair.publicKey).toString('base64'), pairing: { secretB64Url: Buffer.from(pairingSecret).toString('base64url'), createdAtMs: nowMs, expiresAtMs: nowMs + 60000 }, supportsTokenOnly, serverUrl: 'https://relay.example.test', pairingRequirement: 'v3' };
        let opened: unknown = null;
        const runtime = await import('@/utils/system/runtimeFetch');
        const featurePacket = FeaturesResponseSchema.parse({ features: { encryption: { plaintextStorage: { enabled: true } }, e2ee: { keylessAccounts: { enabled: keylessEnabled } } }, capabilities: {} });
        const network = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
            if (String(url).endsWith('/v1/features')) return new Response(JSON.stringify(featurePacket), { status: 200, headers: { 'Content-Type': 'application/json' } });
            if (String(url).endsWith('/v1/account/encryption')) return new Response(JSON.stringify({ mode: accountMode, updatedAt: 1 }), { status: 200 });
            if (String(url).endsWith('/health') || String(url).endsWith('/v1/auth/ping')) return new Response('ok', { status: 200 });
            if (String(url).includes('/v1/auth/request/status')) return new Response(JSON.stringify({ status: 'pending', supportsV2 }), { status: 200 });
            if (String(url).endsWith('/v1/auth/response')) {
                const body = JSON.parse(String(init?.body));
                expect(Object.keys(body).sort()).toEqual(['publicKey', 'response']);
                opened = openTerminalProvisioningV3Response({ payload: new Uint8Array(Buffer.from(body.response, 'base64')), recipientSecretKeyOrSeed: keypair.secretKey, terminalEphemeralPublicKey: keypair.publicKey, pairingSecret, createdAtMs: packet.pairing.createdAtMs, expiresAtMs: packet.pairing.expiresAtMs, nowMs: Date.now() });
                return new Response(JSON.stringify({ success: true }), { status: 200 });
            }
            throw new Error('Unexpected network boundary URL');
        });
        runtime.setRuntimeFetch(network);
        vi.stubGlobal('fetch', network);
        const events: unknown[] = [];
        const nativeModule = {
            getAvailability: () => ({ available: true, platform: 'android', engine: 'russh', moduleVersion: '0.0.0', supportsLoopbackTunnel: true, supportsPersistentHostKeyStorage: false } as const),
            exec: vi.fn(async ({ command }) => {
                if (command.includes('auth status')) return { exitCode: 0, stdout: JSON.stringify({ ok: true, data: { authenticated: false } }), stderr: '' };
                if (command.includes('auth request')) return { exitCode: 0, stdout: JSON.stringify(packet), stderr: '' };
                if (command.includes('auth wait')) {
                    if (!opened) return { exitCode: 1, stdout: '', stderr: 'Current recipient rejects legacy approval' };
                    return { exitCode: 0, stdout: JSON.stringify({ machineId: 'current-native-machine' }), stderr: '' };
                }
                return { exitCode: 0, stdout: JSON.stringify({ ok: true, data: {} }), stderr: '' };
            }),
            cancelRequest: vi.fn(async () => undefined),
        } satisfies NativeSshModule;
        try {
            if (tokenOnly && supportsTokenOnly) {
                expect(await accountModeApi.fetchAccountEncryptionMode({ token: 'fixture-token' }, { retry: 'none' })).toEqual({ mode: accountMode, updatedAt: 1 });
                const snapshot = await features.getServerFeaturesSnapshot();
                expect(snapshot, JSON.stringify({ snapshot, requests: network.mock.calls.map(([url]) => String(url)) })).toMatchObject({ status: 'ready' });
            }
            const result = runNativeRemoteSshBootstrapTask({ taskId: 'native-current-context', nativeModule, spec: createRemoteBootstrapSpec(), prompt: async () => ({ approved: true }), events: { event: (event) => events.push(event) } });
            if (allowed) {
                await expect(result).resolves.toMatchObject({ machineId: 'current-native-machine' });
                expect(opened).toEqual(tokenOnly ? { type: 'tokenOnly' } : { type: 'dataKey', key: deriveAccountMachineKeyFromRecoverySecret(accountSecret) });
            } else {
                await expect(result).rejects.toThrow();
                expect(opened).toBeNull();
                expect(network.mock.calls.some(([url]) => String(url).endsWith('/v1/auth/response'))).toBe(false);
            }
            expect(JSON.stringify(events)).not.toContain(packet.pairing.secretB64Url);
        } finally {
            runtime.resetRuntimeFetch(); vi.unstubAllGlobals(); features.resetServerFeaturesClientForTests(); accountModeApi.invalidateAccountEncryptionModeCache(); profiles.setActiveServerId(previousServerId);
            const supervisors = await import('@/sync/runtime/connectivity/serverReachabilitySupervisorPool'); supervisors.resetServerReachabilitySupervisors();
            const endpoints = await import('@/sync/runtime/connectivity/endpointSupervisorPool'); endpoints.stopAllEndpointSupervisorsForTests();
        }
    });

});
