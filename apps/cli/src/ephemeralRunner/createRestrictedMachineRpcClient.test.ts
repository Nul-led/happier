import {
  DEFAULT_SESSION_CAPABILITIES,
  FeaturesResponseSchema,
  MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1,
  PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT,
} from '@happier-dev/protocol';
import type { ManagedConnectionSupervisorConfig } from '@happier-dev/connection-supervisor';
import { RPC_ERROR_CODES, RPC_METHODS } from '@happier-dev/protocol/rpc';
import { EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1 } from '@happier-dev/protocol/actions';
import { signMachineInstallationProof } from '@happier-dev/protocol/machines/identity/installationIdentity';
import { encodeBase64 } from '@happier-dev/protocol/crypto/base64';
import { VerifiedEphemeralSessionRunnerPrincipalSchema } from '@happier-dev/protocol/ephemeralRunner/principal';
import tweetnacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';

import { HttpStatusError } from '@/api/client/httpStatusError';
import { logger } from '@/ui/logger';

import { createRestrictedMachineRpcClient } from './createRestrictedMachineRpcClient';

describe('restricted Runner Machine RPC client', () => {
  it('registers only the declared exact-Machine handlers and retains them across reconnect', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000013', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const managers: unknown[] = [];
    const sockets: Array<{
      emitWithAck: ReturnType<typeof vi.fn>;
      handlers: Map<string, (payload: unknown) => void>;
    }> = [];
    const createTransport = vi.fn(() => {
      const handlers = new Map<string, (payload: unknown) => void>();
      const socket: {
        on: ReturnType<typeof vi.fn>;
        emit: ReturnType<typeof vi.fn>;
        emitWithAck: ReturnType<typeof vi.fn>;
        timeout: ReturnType<typeof vi.fn>;
        connected: boolean;
      } = {
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
          handlers.set(event, handler);
        }),
        emit: vi.fn(),
        emitWithAck: vi.fn(async (event: string) => {
          if (event === MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1) {
            return { v: 1, result: 'success', revision: 1 };
          }
          return { ok: true };
        }),
        timeout: vi.fn(),
        connected: true,
      };
      socket.timeout.mockReturnValue(socket);
      sockets.push({ ...socket, handlers });
      return {
        socket: socket as never,
        transport: {} as never,
      };
    });
    const dependencies = {
      createSupervisor: (configuration: Parameters<NonNullable<Parameters<typeof createRestrictedMachineRpcClient>[0]['dependencies']>['createSupervisor']>[0]) => ({
        start: async () => {
          const first = configuration.createTransport();
          managers.push(first);
          await configuration.onConnected?.({ state: {} as never });
          const second = configuration.createTransport();
          managers.push(second);
          await configuration.onConnected?.({ state: {} as never });
        },
        stop: async () => undefined,
        getState: () => ({}) as never,
      }),
      createTransport,
      probeReadiness: () => async () => ({ status: 'ready' as const }),
      // The target-admission leaf is negotiated by the daemon-wide owner
      // (`resolveMachineSessionInputAdmissionCapability`), never asserted locally.
      fetchFeatures: async () => ({
        status: 'ready' as const,
        features: FeaturesResponseSchema.parse({
          features: {},
          capabilities: { session: { ...DEFAULT_SESSION_CAPABILITIES, pendingInput: { protocolVersion: 3 } } },
        }),
      }),
    };
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home', TMPDIR: '/runner-home/tmp' },
      irohEndpoint: {
        endpointId: 'a'.repeat(64),
        relayUrls: ['https://relay.example.test'],
        directAddresses: ['192.0.2.10:443'],
      },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => {
        rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true }));
        // Installing the closed dispatch receiver is what publishes the
        // protected-Action capability the Home requires before it relays one.
        rpc.registerHandler(EXTERNAL_ACTION_DAEMON_RPC_METHOD_V1, async () => ({ ok: true }));
      },
      dependencies,
    });

    await client.connect();
    expect(managers).toHaveLength(2);
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      env: { HOME: '/runner-home', TMPDIR: '/runner-home/tmp' },
    }));
    expect(sockets).toHaveLength(2);
    for (const socket of sockets) {
      expect(socket.emitWithAck).toHaveBeenCalledWith(
        MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1,
        {
          machineId: 'machine-1',
          capabilities: {
            sessionInputAdmission: { protocolVersions: [1, 2] },
            sessionFollow: { contextV1: true },
            finiteTransferRpc: { protocolVersions: [1] },
            externalActionExecutionAuthorization: { protocolVersions: [1] },
            irohMachineEndpoint: {
              protocolVersions: [1], endpointId: 'a'.repeat(64),
              relayUrls: ['https://relay.example.test'], directAddresses: ['192.0.2.10:443'],
            },
          },
        },
      );
    }
    const uninstallWakeReceiver = client.installSessionFollowWakeReceiver();
    await vi.waitFor(() => expect(sockets[1]?.emitWithAck).toHaveBeenCalledWith(
      MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1,
      {
        machineId: 'machine-1',
        capabilities: {
          finiteTransferRpc: { protocolVersions: [1] },
          externalActionExecutionAuthorization: { protocolVersions: [1] },
          sessionInputAdmission: { protocolVersions: [1, 2] },
          sessionFollow: { contextV1: true, wakeOnHumanChangeV1: true },
          irohMachineEndpoint: {
            protocolVersions: [1], endpointId: 'a'.repeat(64),
            relayUrls: ['https://relay.example.test'], directAddresses: ['192.0.2.10:443'],
          },
        },
      },
    ));
    uninstallWakeReceiver();
    await vi.waitFor(() => expect(sockets[1]?.emitWithAck).toHaveBeenLastCalledWith(
      MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1,
      {
        machineId: 'machine-1',
        capabilities: {
          finiteTransferRpc: { protocolVersions: [1] },
          externalActionExecutionAuthorization: { protocolVersions: [1] },
          sessionInputAdmission: { protocolVersions: [1, 2] },
          sessionFollow: { contextV1: true },
          irohMachineEndpoint: {
            protocolVersions: [1], endpointId: 'a'.repeat(64),
            relayUrls: ['https://relay.example.test'], directAddresses: ['192.0.2.10:443'],
          },
        },
      },
    ));
    await expect(client.rpc.invokeLocal(RPC_METHODS.READ_FILE, {})).resolves.toEqual({ ok: true });
    await expect(client.rpc.invokeLocal('not-declared', {})).resolves.toMatchObject({ errorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND });
    expect(() => createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example', runtimeToken: 'runner-token', transport: { encryptionMode: 'plain' },
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      registerHandlers: (rpc) => rpc.registerHandler('competing.runner.engine', async () => ({})),
      dependencies,
    })).toThrow('runner_rpc_method_not_classified');
    await client.close();
  });

  it('consumes the shared exact-Machine tunnel relay owner without constructing the broad daemon client', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(5));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000014', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const socketHandlers = new Map<string, (payload: unknown) => void>();
    const socket = {
      on: vi.fn((event: string, handler: (payload: unknown) => void) => {
        socketHandlers.set(event, handler);
      }),
      emit: vi.fn(),
      emitWithAck: vi.fn(async (event: string) => {
        if (event === MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1) {
          return { v: 1, result: 'success', revision: 1 };
        }
        return { ok: true };
      }),
      timeout: vi.fn(),
      connected: true,
    };
    socket.timeout.mockReturnValue(socket);
    const features = FeaturesResponseSchema.parse({
      features: {
        machines: {
          enabled: true,
          tunnel: {
            enabled: true,
            directPeer: { enabled: false },
            serverRouted: { enabled: true },
          },
        },
      },
      capabilities: {
        machines: {
          peerMediation: {
            grantSigningKeys: [{
              keyId: 'relay-key-1',
              publicKey: encodeBase64(tweetnacl.sign.keyPair().publicKey, 'base64url'),
            }],
          },
        },
      },
    });
    let didStartSupervisor = false;
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      dependencies: {
        createSupervisor: (configuration) => ({
          start: async () => {
            configuration.createTransport();
            didStartSupervisor = true;
            await configuration.onConnected?.({ state: {} as never });
          },
          stop: async () => undefined,
          getState: () => ({}) as never,
        }),
        createTransport: () => ({ socket: socket as never, transport: {} as never }),
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => ({ status: 'ready' as const, features }),
      },
    });

    await client.connect();

    expect(didStartSupervisor).toBe(true);
    expect(socketHandlers.has(PEER_TCP_TUNNEL_RELAY_SOCKET_EVENT)).toBe(true);
    expect(socket.emitWithAck).toHaveBeenCalledWith(
      MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1,
      {
        machineId: 'machine-1',
        capabilities: {
          finiteTransferRpc: { protocolVersions: [1] },
          sessionInputAdmission: { protocolVersions: [1] },
          sessionFollow: { contextV1: true },
        },
      },
    );
    await client.close();
  });

  it('keeps exact-Machine RPC available when optional tunnel feature discovery fails', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(6));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000015', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    let didStartSupervisor = false;
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      dependencies: {
        createSupervisor: (configuration) => ({
          start: async () => {
            configuration.createTransport();
            didStartSupervisor = true;
            await configuration.onConnected?.({ state: {} as never });
          },
          stop: async () => undefined,
          getState: () => ({}) as never,
        }),
        createTransport: () => ({
          socket: (() => {
            const socket = {
              on: vi.fn(),
              emit: vi.fn(),
              emitWithAck: vi.fn(async (event: string) => {
                if (event === MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1) {
                  return { v: 1, result: 'success', revision: 1 };
                }
                return { ok: true };
              }),
              timeout: vi.fn(),
              connected: true,
            };
            socket.timeout.mockReturnValue(socket);
            return socket;
          })() as never,
          transport: {} as never,
        }),
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => { throw new Error('features unavailable'); },
      },
    });

    await expect(client.connect()).resolves.toBeUndefined();
    expect(didStartSupervisor).toBe(true);
    await expect(client.rpc.invokeLocal(RPC_METHODS.READ_FILE, {})).resolves.toEqual({ ok: true });
    await client.close();
  });

  it('fails the initial connection when the Home rejects the authenticated capability projection', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000016', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const socket = {
      on: vi.fn(),
      emit: vi.fn(),
      emitWithAck: vi.fn(async () => ({
        v: 1 as const,
        result: 'error' as const,
        code: 'machine_unavailable' as const,
      })),
      timeout: vi.fn(),
      connected: true,
    };
    socket.timeout.mockReturnValue(socket);
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      dependencies: {
        createSupervisor: (configuration) => ({
          start: async () => {
            configuration.createTransport();
            await configuration.onConnected?.({ state: {} as never });
          },
          stop: async () => undefined,
          getState: () => ({}) as never,
        }),
        createTransport: () => ({ socket: socket as never, transport: {} as never }),
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => ({ status: 'unsupported' as const, reason: 'endpoint_missing' as const }),
      },
    });

    await expect(client.connect()).rejects.toThrow(
      'Machine operation protocol capability update failed: machine_unavailable',
    );
    await client.close();
  });

  it('keeps rejected capability generations unacknowledged and retries the latest projection on existing lifecycle triggers', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000019', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const capabilityPayloads: unknown[] = [];
    const createSocket = (outcomes: Array<'success' | 'failure'>) => {
      let attempt = 0;
      const socket = {
        on: vi.fn(),
        emit: vi.fn(),
        emitWithAck: vi.fn(async (event: string, payload: unknown) => {
          if (event !== MACHINE_UPDATE_OPERATION_PROTOCOL_CAPABILITIES_EVENT_V1) return { ok: true };
          capabilityPayloads.push(payload);
          const outcome = outcomes[attempt++] ?? 'success';
          return outcome === 'success'
            ? { v: 1 as const, result: 'success' as const, revision: attempt }
            : { v: 1 as const, result: 'error' as const, code: 'machine_unavailable' as const };
        }),
        timeout: vi.fn(),
        connected: true,
      };
      socket.timeout.mockReturnValue(socket);
      return socket;
    };
    const initialSocket = createSocket(['success', 'failure', 'success']);
    const reconnectSocket = createSocket(['failure', 'success', 'success']);
    const sockets = [initialSocket, reconnectSocket];
    let nextSocket = 0;
    let supervisorConfiguration: ManagedConnectionSupervisorConfig | null = null;
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      dependencies: {
        createSupervisor: (configuration) => {
          supervisorConfiguration = configuration;
          return {
            start: async () => {
              configuration.createTransport();
              await configuration.onConnected?.({ state: {} as never });
            },
            stop: async () => undefined,
            getState: () => ({}) as never,
          };
        },
        createTransport: () => ({ socket: sockets[nextSocket++] as never, transport: {} as never }),
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => ({ status: 'unsupported' as const, reason: 'endpoint_missing' as const }),
      },
    });

    await client.connect();

    const uninstallWakeReceiver = client.installSessionFollowWakeReceiver();
    await vi.waitFor(() => expect(initialSocket.emitWithAck).toHaveBeenCalledTimes(2));
    uninstallWakeReceiver();
    await vi.waitFor(() => expect(initialSocket.emitWithAck).toHaveBeenCalledTimes(3));
    expect(capabilityPayloads[2]).toEqual({
      machineId: 'machine-1',
      capabilities: {
        finiteTransferRpc: { protocolVersions: [1] },
        sessionInputAdmission: { protocolVersions: [1] },
        sessionFollow: { contextV1: true },
      },
    });

    supervisorConfiguration!.createTransport();
    await supervisorConfiguration!.onConnected?.({ state: {} as never });
    await vi.waitFor(() => expect(reconnectSocket.emitWithAck).toHaveBeenCalledTimes(1));
    const uninstallAfterReconnect = client.installSessionFollowWakeReceiver();
    await vi.waitFor(() => expect(reconnectSocket.emitWithAck).toHaveBeenCalledTimes(2));
    expect(capabilityPayloads[4]).toEqual({
      machineId: 'machine-1',
      capabilities: {
        finiteTransferRpc: { protocolVersions: [1] },
        sessionInputAdmission: { protocolVersions: [1] },
        sessionFollow: { contextV1: true, wakeOnHumanChangeV1: true },
      },
    });
    expect(warn).toHaveBeenCalledTimes(2);

    uninstallAfterReconnect();
    await vi.waitFor(() => expect(reconnectSocket.emitWithAck).toHaveBeenCalledTimes(3));
    await client.close();
    warn.mockRestore();
  });

  it('reports terminal Machine authentication loss to the owning Session lifecycle', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(8));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000017', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const onTerminalConnectionFailure = vi.fn();
    const supervisorConfiguration: { current: ManagedConnectionSupervisorConfig | null } = { current: null };
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      onTerminalConnectionFailure,
      dependencies: {
        createSupervisor: (configuration) => {
          supervisorConfiguration.current = configuration;
          return {
            start: async () => undefined,
            stop: async () => undefined,
            getState: () => ({}) as never,
          };
        },
        createTransport: vi.fn() as never,
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => ({ status: 'unsupported' as const, reason: 'endpoint_missing' as const }),
      },
    });

    await supervisorConfiguration.current?.onAuthFailed?.({
      state: {
        phase: 'auth_failed',
        reason: 'auth_invalid',
        attempt: 2,
        nextRetryAt: null,
        lastConnectedAt: 1,
        lastDisconnectedAt: 2,
        lastErrorMessage: 'revoked',
      },
      probe: { status: 'auth_failed', statusCode: 401 },
    });

    expect(onTerminalConnectionFailure).toHaveBeenCalledOnce();

    // The supervisor defaults every failed connect to `server_unreachable`, so
    // without the shared classifier `onAuthFailed` above could never fire for a
    // Home that rejected this Runner's credential: it would retry offline with a
    // live child Agent instead of stopping.
    const classify = supervisorConfiguration.current?.classifyTransportErrorToProbeResult;
    expect(classify?.(new HttpStatusError(401, 'revoked runner token')))
      .toMatchObject({ status: 'auth_failed', statusCode: 401 });
    expect(classify?.(new Error('socket hang up'))).toBeNull();
    await client.close();
  });

  it('cancels a pending initial Machine connection and stops its existing supervisor', async () => {
    const installation = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(11));
    const installationPublicKey = encodeBase64(installation.publicKey, 'base64url');
    const installationPrivateKey = encodeBase64(installation.secretKey, 'base64url');
    const principal = VerifiedEphemeralSessionRunnerPrincipalSchema.parse({
      kind: 'ephemeral_session_runner', authority: 'session_runtime', accountId: 'account-1',
      activationId: '00000000-0000-4000-8000-000000000021', sessionId: 'session-1', machineId: 'machine-1',
      installationId: 'installation-1', installationPublicKey, creatorTokenEpoch: 1,
    });
    const installationProof = signMachineInstallationProof({
      payload: {
        version: 1,
        installationId: principal.installationId,
        machineId: principal.machineId,
        accountId: principal.accountId,
      },
      privateKey: installationPrivateKey,
    });
    const stop = vi.fn(async () => undefined);
    const client = createRestrictedMachineRpcClient({
      principal,
      homeServerIdentityId: 'home-1',
      runtimeOrigin: 'https://home.example',
      runtimeToken: 'runner-token',
      transportEnvironment: { HOME: '/runner-home' },
      installationProof,
      transport: { encryptionMode: 'plain' },
      registerHandlers: (rpc) => rpc.registerHandler(RPC_METHODS.READ_FILE, async () => ({ ok: true })),
      dependencies: {
        createSupervisor: () => ({
          start: async () => await new Promise<void>(() => {}),
          stop,
          getState: () => ({}) as never,
        }),
        createTransport: vi.fn() as never,
        probeReadiness: () => async () => ({ status: 'ready' as const }),
        fetchFeatures: async () => ({ status: 'unsupported' as const, reason: 'endpoint_missing' as const }),
      },
    });
    const controller = new AbortController();
    const connecting = client.connect({ signal: controller.signal });

    controller.abort(new Error('window-closed'));

    await expect(connecting).rejects.toMatchObject({ name: 'AbortError' });
    expect(stop).toHaveBeenCalledOnce();
  });
});
