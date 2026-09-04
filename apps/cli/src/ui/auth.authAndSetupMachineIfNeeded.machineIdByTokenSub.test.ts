import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const machineRegistrationMocks = vi.hoisted(() => ({
  apiCreate: vi.fn(async () => ({})),
  ensureMachineRegistered: vi.fn(async ({ machineId }: { machineId: string }) => ({
    machine: { id: machineId },
    machineId,
    didRotateMachineId: false,
  })),
}));
const descriptorRuntimeMocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  fetchFeatures: vi.fn(),
}));

vi.mock('@/api/api', () => ({
  ApiClient: { create: machineRegistrationMocks.apiCreate },
}));

vi.mock('@/api/machine/ensureMachineRegistered', () => ({
  ensureMachineRegistered: machineRegistrationMocks.ensureMachineRegistered,
}));

vi.mock('@/auth/terminalAuthEnrollmentRuntime', () => ({
  acquireTerminalAuthEnrollmentRuntime: descriptorRuntimeMocks.acquire,
}));

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: descriptorRuntimeMocks.fetchFeatures,
}));

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function makeJwtWithSub(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub })).toString('base64url');
  return `${header}.${payload}.signature`;
}

describe('authAndSetupMachineIfNeeded (machine id binding)', () => {
  const previousHomeDir = process.env.HAPPIER_HOME_DIR;
  const previousActiveServerId = process.env.HAPPIER_ACTIVE_SERVER_ID;
  const previousServerUrl = process.env.HAPPIER_SERVER_URL;
  const previousWebappUrl = process.env.HAPPIER_WEBAPP_URL;
  const previousAutostart = process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

  afterEach(() => {
    if (previousHomeDir === undefined) delete process.env.HAPPIER_HOME_DIR;
    else process.env.HAPPIER_HOME_DIR = previousHomeDir;
    if (previousActiveServerId === undefined) delete process.env.HAPPIER_ACTIVE_SERVER_ID;
    else process.env.HAPPIER_ACTIVE_SERVER_ID = previousActiveServerId;
    if (previousServerUrl === undefined) delete process.env.HAPPIER_SERVER_URL;
    else process.env.HAPPIER_SERVER_URL = previousServerUrl;
    if (previousWebappUrl === undefined) delete process.env.HAPPIER_WEBAPP_URL;
    else process.env.HAPPIER_WEBAPP_URL = previousWebappUrl;
    if (previousAutostart === undefined) delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;
    else process.env.HAPPIER_SESSION_AUTOSTART_DAEMON = previousAutostart;
    vi.clearAllMocks();
    machineRegistrationMocks.apiCreate.mockResolvedValue({});
    machineRegistrationMocks.ensureMachineRegistered.mockImplementation(async ({ machineId }: { machineId: string }) => ({
      machine: { id: machineId },
      machineId,
      didRotateMachineId: false,
    }));
    descriptorRuntimeMocks.acquire.mockReset();
    descriptorRuntimeMocks.fetchFeatures.mockReset();
    vi.resetModules();
  });

  it('keeps a descriptor carrier open through machine registration and closes it afterward', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-machine-iroh-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'iroh-home';
    process.env.HAPPIER_SERVER_URL = 'http://localhost:3010';
    process.env.HAPPIER_WEBAPP_URL = 'https://app.happier.dev';
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;
    const events: string[] = [];
    const descriptor = {
      v: 1 as const,
      homeServerIdentityId: 'srv_iroh_machine_home',
      canonicalServerUrl: 'http://localhost:3010',
      revision: 1,
      endpoints: [{ kind: 'iroh' as const, endpointId: 'd'.repeat(64) }],
    };
    const close = vi.fn(async () => { events.push('close'); });
    descriptorRuntimeMocks.acquire.mockResolvedValue({
      ok: true,
      runtime: {
        runtimeOrigin: 'http://127.0.0.1:48123',
        carrier: 'iroh',
        authenticatedCredentialDestination: { kind: 'iroh', endpointId: 'd'.repeat(64) },
      },
      close,
    });
    descriptorRuntimeMocks.fetchFeatures.mockResolvedValue({
      status: 'ready',
      features: {
        capabilities: { serverIdentity: { serverIdentityId: descriptor.homeServerIdentityId } },
        homeConnectionDescriptor: descriptor,
      },
    });
    machineRegistrationMocks.apiCreate.mockImplementation(async () => {
      events.push('api');
      return {};
    });
    machineRegistrationMocks.ensureMachineRegistered.mockImplementation(async ({ machineId }: { machineId: string }) => {
      events.push('register');
      return { machine: { id: machineId }, machineId, didRotateMachineId: false };
    });

    try {
      writeFileSync(join(homeDir, 'settings.json'), JSON.stringify({
        schemaVersion: 6,
        activeServerId: 'iroh-home',
        servers: {
          'iroh-home': {
            id: 'iroh-home',
            name: 'Iroh Home',
            serverUrl: descriptor.canonicalServerUrl,
            webappUrl: 'https://app.happier.dev',
            homeConnectionDescriptor: descriptor,
            homeConnectionDescriptorAuthority: 'exact',
            createdAt: 0,
            updatedAt: 0,
            lastUsedAt: 0,
          },
        },
      }), 'utf8');
      const serverDir = join(homeDir, 'servers', 'iroh-home');
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(join(serverDir, 'access.key'), JSON.stringify({ token: makeJwtWithSub('acct-iroh') }), 'utf8');

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      await expect(authAndSetupMachineIfNeeded({ callerIntent: 'setup-managed' })).resolves.toMatchObject({
        credentials: { token: expect.any(String) },
        machineId: expect.any(String),
      });

      expect(descriptorRuntimeMocks.acquire).toHaveBeenCalledWith(descriptor, 'iroh');
      expect(events).toEqual(['api', 'register', 'close']);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('selects machine id based on decoded token sub', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-machine-id-sub-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'cloud';
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 6,
            onboardingCompleted: true,
            activeServerId: 'cloud',
            servers: {
              cloud: {
                id: 'cloud',
                name: 'cloud',
                serverUrl: 'https://api.happier.dev',
                webappUrl: 'https://app.happier.dev',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
            machineIdByServerId: { cloud: 'machine-acct-a' },
            lastTokenSubByServerId: { cloud: 'acct-a' },
            machineIdByServerIdByAccountId: {
              cloud: {
                'acct-a': 'machine-acct-a',
                'acct-b': 'machine-acct-b',
              },
            },
          },
          null,
          2,
        ),
        'utf8',
      );

      const serverDir = join(homeDir, 'servers', 'cloud');
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'access.key'),
        JSON.stringify({ token: makeJwtWithSub('acct-b'), secret: Buffer.from('x').toString('base64') }, null, 2),
        'utf8',
      );

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      const result = await authAndSetupMachineIfNeeded();

      expect(result.machineId).toBe('machine-acct-b');
      expect(result.credentials.token).toContain('.');
      expect(machineRegistrationMocks.ensureMachineRegistered).toHaveBeenCalledWith(expect.objectContaining({
        machineId: 'machine-acct-b',
        caller: 'auth.login',
      }));

      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(raw.machineIdByServerId.cloud).toBe('machine-acct-b');
      expect(raw.lastTokenSubByServerId.cloud).toBe('acct-b');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('uses an existing token-only credential without starting keyed authentication', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-token-only-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'cloud';
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify({
          schemaVersion: 6,
          onboardingCompleted: true,
          activeServerId: 'cloud',
          servers: {
            cloud: {
              id: 'cloud',
              name: 'cloud',
              serverUrl: 'https://api.happier.dev',
              webappUrl: 'https://app.happier.dev',
              createdAt: 0,
              updatedAt: 0,
              lastUsedAt: 0,
            },
          },
          machineIdByServerId: { cloud: 'machine-token-only' },
        }, null, 2),
        'utf8',
      );

      const serverDir = join(homeDir, 'servers', 'cloud');
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'access.key'),
        JSON.stringify({ token: makeJwtWithSub('acct-plain') }, null, 2),
        'utf8',
      );

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      const result = await authAndSetupMachineIfNeeded();

      expect(result.credentials).toEqual({
        token: makeJwtWithSub('acct-plain'),
        encryption: null,
        credentialProvenance: 'stored_session',
      });
      expect(result.machineId).toBe('machine-token-only');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('falls back to server-scoped machine ids when the token payload cannot be decoded', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-machine-id-invalid-token-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'cloud';
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 6,
            onboardingCompleted: true,
            activeServerId: 'cloud',
            servers: {
              cloud: {
                id: 'cloud',
                name: 'cloud',
                serverUrl: 'https://api.happier.dev',
                webappUrl: 'https://app.happier.dev',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
            machineIdByServerId: { cloud: 'machine-server-scoped' },
            machineIdConfirmedByServerByServerId: { cloud: true },
            lastTokenSubByServerId: { cloud: 'acct-a' },
          },
          null,
          2,
        ),
        'utf8',
      );

      const serverDir = join(homeDir, 'servers', 'cloud');
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'access.key'),
        JSON.stringify({ token: 'not-a-jwt', secret: Buffer.from('x').toString('base64') }, null, 2),
        'utf8',
      );

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      const result = await authAndSetupMachineIfNeeded();

      expect(result.machineId).toBe('machine-server-scoped');

      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(raw.machineIdConfirmedByServerByServerId?.cloud).toBeUndefined();
      expect(raw.lastTokenSubByServerId?.cloud).toBeUndefined();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rotates the machine id when credentials are freshly issued but the token is opaque', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-machine-id-new-opaque-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'cloud';
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 6,
            onboardingCompleted: true,
            activeServerId: 'cloud',
            servers: {
              cloud: {
                id: 'cloud',
                name: 'cloud',
                serverUrl: 'https://api.happier.dev',
                webappUrl: 'https://app.happier.dev',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
            machineIdByServerId: { cloud: 'machine-before-login' },
            machineIdConfirmedByServerByServerId: { cloud: true },
            lastTokenSubByServerId: { cloud: 'acct-a' },
          },
          null,
          2,
        ),
        'utf8',
      );

      vi.resetModules();
      const { ensureMachineIdForCredentials } = await import('./auth');
      const result = await ensureMachineIdForCredentials({
        token: 'opaque-token',
        encryption: { type: 'legacy', secret: new Uint8Array([1]) },
      }, { forceNew: true });

      expect(result.machineId).not.toBe('machine-before-login');

      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(raw.machineIdByServerId.cloud).toBe(result.machineId);
      expect(raw.machineIdConfirmedByServerByServerId?.cloud).toBeUndefined();
      expect(raw.lastTokenSubByServerId?.cloud).toBeUndefined();
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('clears machine confirmation when the account changes without changing the machine id', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-machine-id-confirmation-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_ACTIVE_SERVER_ID = 'cloud';

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 6,
            onboardingCompleted: true,
            activeServerId: 'cloud',
            servers: {
              cloud: {
                id: 'cloud',
                name: 'cloud',
                serverUrl: 'https://api.happier.dev',
                webappUrl: 'https://app.happier.dev',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
            machineIdByServerId: { cloud: 'machine-shared' },
            machineIdByServerIdByAccountId: {
              cloud: {
                'acct-a': 'machine-shared',
                'acct-b': 'machine-shared',
              },
            },
            machineIdConfirmedByServerByServerId: { cloud: true },
            lastTokenSubByServerId: { cloud: 'acct-a' },
          },
          null,
          2,
        ),
        'utf8',
      );

      const serverDir = join(homeDir, 'servers', 'cloud');
      mkdirSync(serverDir, { recursive: true });
      writeFileSync(
        join(serverDir, 'access.key'),
        JSON.stringify({ token: makeJwtWithSub('acct-b'), secret: Buffer.from('x').toString('base64') }, null, 2),
        'utf8',
      );

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      const result = await authAndSetupMachineIfNeeded();

      expect(result.machineId).toBe('machine-shared');

      const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
      expect(raw.machineIdConfirmedByServerByServerId.cloud).toBeUndefined();
      expect(raw.lastTokenSubByServerId.cloud).toBe('acct-b');

      const { logger } = await import('./logger');
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('[AUTH] tokenSub changed for server=cloud machineId=machine-shared'),
      );
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('acct-a'));
      expect(logger.info).not.toHaveBeenCalledWith(expect.stringContaining('acct-b'));
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rehydrates relay scope env from the active relay profile before any post-auth daemon autostart', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'happier-cli-auth-relay-scope-env-'));
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.HAPPIER_SERVER_URL = 'http://127.0.0.1:24541';
    process.env.HAPPIER_WEBAPP_URL = 'http://happier-stack.localhost:24541';
    delete process.env.HAPPIER_ACTIVE_SERVER_ID;
    delete process.env.HAPPIER_PUBLIC_SERVER_URL;
    delete process.env.HAPPIER_SESSION_AUTOSTART_DAEMON;

    try {
      const settingsPath = join(homeDir, 'settings.json');
      writeFileSync(
        settingsPath,
        JSON.stringify(
          {
            schemaVersion: 6,
            onboardingCompleted: true,
            activeServerId: 'stack_main__id_default',
            servers: {
              stack_main__id_default: {
                id: 'stack_main__id_default',
                name: 'stack',
                serverUrl: 'http://127.0.0.1:24541',
                publicServerUrl: 'http://localhost:24541',
                webappUrl: 'http://happier-stack.localhost:24541',
                createdAt: 0,
                updatedAt: 0,
                lastUsedAt: 0,
              },
            },
            machineIdByServerId: { stack_main__id_default: 'machine-stack' },
            lastTokenSubByServerId: { stack_main__id_default: 'acct-a' },
          },
          null,
          2,
        ),
        'utf8',
      );

      const serverDir = join(homeDir, 'servers', 'stack_main__id_default');
      mkdirSync(serverDir, { recursive: true });
      const accessKeyPayload = JSON.stringify(
        { token: makeJwtWithSub('acct-a'), secret: Buffer.from('x').toString('base64') },
        null,
        2,
      );
      writeFileSync(join(serverDir, 'access.key'), accessKeyPayload, 'utf8');
      writeFileSync(join(homeDir, 'access.key'), accessKeyPayload, 'utf8');

      vi.resetModules();
      const { authAndSetupMachineIfNeeded } = await import('./auth');
      const result = await authAndSetupMachineIfNeeded();

      expect(result.machineId).toBe('machine-stack');
      expect(process.env.HAPPIER_ACTIVE_SERVER_ID).toBe('stack_main__id_default');
      expect(process.env.HAPPIER_WEBAPP_URL).toBe('http://happier-stack.localhost:24541');
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
