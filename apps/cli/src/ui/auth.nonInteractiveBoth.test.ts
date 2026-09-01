import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  sealTerminalProvisioningV3TokenOnlyPayload,
  type HomeConnectionDescriptorV1,
} from '@happier-dev/protocol';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';
import { setStdioTtyForTest } from '@/testkit/process/stdio';

const runTailscaleServeStatusMock = vi.fn<
  (params: Readonly<{ timeoutMs: number; env: NodeJS.ProcessEnv; tailscaleBin: string }>) => Promise<string>
>();

const displayQRCodeMock = vi.fn<(url: string) => void>();
const fixedNowMs = 1_800_000_000_000;
const deterministicRandomByte = 7;
type ServerFeaturesSnapshotMock =
  | Readonly<{
      status: 'ready';
      features: Readonly<{
        capabilities: Readonly<{
          serverIdentity: Readonly<{ serverIdentityId: string }>;
        }>;
        homeConnectionDescriptor?: HomeConnectionDescriptorV1;
      }>;
    }>
  | Readonly<{ status: 'unsupported'; reason: 'endpoint_missing' }>;
const fetchServerFeaturesSnapshotMock = vi.fn<
  (params: Readonly<{ serverUrl: string }>) => Promise<ServerFeaturesSnapshotMock>
>(async () => ({
  status: 'ready' as const,
  features: {
    capabilities: {
      serverIdentity: { serverIdentityId: 'srv_interactive_auth_home' },
    },
  },
}));
const setActiveServerProfileHomeConnectionDescriptorMock = vi.fn(async () => ({}));

vi.mock('@/integrations/tailscale/tailscaleCommand', () => ({
  runTailscaleServeStatus: (params: Readonly<{ timeoutMs: number; env: NodeJS.ProcessEnv; tailscaleBin: string }>) =>
    runTailscaleServeStatusMock(params),
}));

vi.mock('./qrcode', () => ({
  displayQRCode: (url: string) => displayQRCodeMock(url),
}));

vi.mock('@/features/serverFeaturesClient', () => ({
  fetchServerFeaturesSnapshot: fetchServerFeaturesSnapshotMock,
}));

vi.mock('@/server/serverProfiles', () => ({
  setActiveServerProfileHomeConnectionDescriptor: setActiveServerProfileHomeConnectionDescriptorMock,
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (length: number) => Buffer.alloc(length, 7),
  };
});

type AxiosRequestResponse = { state: 'requested' };
type AxiosClaimResponse = { state: 'authorized'; token: string; response: string };
type AxiosStatusResponse = { status: 'authorized' };
type AxiosResponse<T> = { data: T };

type AxiosLike = {
  post: (url: string, body?: unknown) => Promise<AxiosResponse<AxiosRequestResponse | AxiosClaimResponse | unknown>>;
  get: (url: string) => Promise<AxiosResponse<AxiosStatusResponse | unknown>>;
};

let capturedPublicKeyBase64: string | null = null;
let claimServerIdentityId = 'srv_interactive_auth_home';

function sealCurrentTerminalResponse(recipientPublicKeyBase64: string): string {
  return Buffer.from(sealTerminalProvisioningV3TokenOnlyPayload({
    terminalEphemeralPublicKey: new Uint8Array(Buffer.from(recipientPublicKeyBase64, 'base64')),
    pairingSecret: new Uint8Array(32).fill(deterministicRandomByte),
    createdAtMs: fixedNowMs,
    expiresAtMs: fixedNowMs + 60 * 60 * 1_000,
    randomBytes: (length) => new Uint8Array(length).fill(9),
  })).toString('base64');
}

vi.mock('axios', async () => {
  const axios: AxiosLike = {
    post: vi.fn(async (url: string, body?: unknown) => {
      if (url.endsWith('/v1/auth/request')) {
        const publicKey = (body as { publicKey?: unknown } | undefined)?.publicKey;
        capturedPublicKeyBase64 = typeof publicKey === 'string' ? publicKey : '';
        return { data: { state: 'requested' } };
      }
      if (url.endsWith('/v1/auth/request/claim')) {
        const claimBody = body as { publicKey?: unknown } | undefined;
        const publicKey = typeof claimBody?.publicKey === 'string' ? claimBody.publicKey : capturedPublicKeyBase64 ?? '';
        return {
          data: {
            state: 'authorized',
            token: 'tok',
            response: sealCurrentTerminalResponse(publicKey),
            serverIdentityId: claimServerIdentityId,
          },
        };
      }
      throw new Error(`Unexpected axios.post URL: ${url}`);
    }),
    get: vi.fn(async (url: string) => {
      if (url.endsWith('/v1/auth/request/status')) {
        return { data: { status: 'authorized' } };
      }
      throw new Error(`Unexpected axios.get URL: ${url}`);
    }),
  };
  return { default: axios };
});

describe.sequential('doAuth (non-interactive)', () => {
  const envKeys = [
    'HAPPIER_HOME_DIR',
    'HAPPIER_SERVER_URL',
    'HAPPIER_WEBAPP_URL',
    'HAPPIER_PUBLIC_SERVER_URL',
    'HAPPIER_NO_BROWSER_OPEN',
    'HAPPIER_AUTH_POLL_INTERVAL_MS',
    'HAPPIER_AUTH_METHOD',
    'HAPPIER_TAILSCALE_AUTO_PUBLIC_URL',
  ] as const;

  beforeEach(() => {
    claimServerIdentityId = 'srv_interactive_auth_home';
    capturedPublicKeyBase64 = null;
    displayQRCodeMock.mockClear();
    fetchServerFeaturesSnapshotMock.mockClear();
    setActiveServerProfileHomeConnectionDescriptorMock.mockClear();
    vi.spyOn(Date, 'now').mockReturnValue(fixedNowMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints both web + mobile instructions when method is not specified', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();
    fetchServerFeaturesSnapshotMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const out = output.logs.join('\n');
      expect(out.toLowerCase()).toContain('terminal is connected to: https://server.example.test');
      expect(out).toContain('Web app URL: https://webapp.example.test');
      expect(out.toLowerCase()).toContain('recommended: use the mobile app first');
      expect(out.toLowerCase()).toContain('already have a happier account on another device');
      expect(out).toContain('webapp.example.test/terminal/connect#key=');
      expect(out).toContain('happier://terminal?');
      expect(displayQRCodeMock).toHaveBeenCalledTimes(1);
      expect(displayQRCodeMock).toHaveBeenCalledWith(expect.stringContaining(
        'serverIdentityId=srv_interactive_auth_home',
      ));
      expect(fetchServerFeaturesSnapshotMock).toHaveBeenCalledTimes(1);
      expect(fetchServerFeaturesSnapshotMock).toHaveBeenCalledWith({
        serverUrl: 'https://server.example.test',
      });
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('persists the exact Home descriptor only after authentication succeeds', async () => {
    const home = await createTempDir('happier-cli-auth-home-descriptor-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    const descriptor: HomeConnectionDescriptorV1 = {
      v: 1,
      homeServerIdentityId: 'srv_interactive_auth_home',
      canonicalServerUrl: 'https://server.example.test',
      revision: 3,
      endpoints: [{ kind: 'iroh', endpointId: 'c'.repeat(64) }],
    };
    fetchServerFeaturesSnapshotMock.mockResolvedValueOnce({
      status: 'ready',
      features: {
        capabilities: { serverIdentity: { serverIdentityId: 'srv_interactive_auth_home' } },
        homeConnectionDescriptor: descriptor,
      },
    });

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
      });
      vi.resetModules();
      const { doAuth } = await import('./auth');
      expect((await doAuth())?.token).toBe('tok');
      expect(setActiveServerProfileHomeConnectionDescriptorMock).toHaveBeenCalledWith(descriptor);
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('rejects a claimed credential from a different stable Home before persistence', async () => {
    const home = await createTempDir('happier-cli-auth-wrong-home-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    claimServerIdentityId = 'srv_other_home';

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      await expect(doAuth()).resolves.toBeNull();
      expect(output.logs.join('\n')).toContain('different Home identity');

      const { readStoredCredentials } = await import('@/persistence');
      await expect(readStoredCredentials()).resolves.toBeNull();
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('does not create or publish an authentication request when the Home identity is unavailable', async () => {
    const home = await createTempDir('happier-cli-auth-no-home-identity-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    capturedPublicKeyBase64 = null;
    displayQRCodeMock.mockClear();
    fetchServerFeaturesSnapshotMock.mockResolvedValueOnce({
      status: 'unsupported',
      reason: 'endpoint_missing',
    });

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      await expect(doAuth()).resolves.toBeNull();
      expect(output.logs.join('\n')).toContain('authentication request was not created');
      expect(capturedPublicKeyBase64).toBeNull();
      expect(displayQRCodeMock).not.toHaveBeenCalled();
      expect(fetchServerFeaturesSnapshotMock).toHaveBeenCalledTimes(1);
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('prefers Tailscale Serve https:// URL for QR/deep links when serverUrl is loopback and public url is unset', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-tailscale-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    runTailscaleServeStatusMock.mockResolvedValueOnce(
      [
        'https://my-machine.tailnet.ts.net',
        '|-- / proxy http://127.0.0.1:53545',
        '',
      ].join('\n'),
    );

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'http://127.0.0.1:53545',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const out = output.logs.join('\n');
      expect(out).toContain(encodeURIComponent('https://my-machine.tailnet.ts.net'));
      expect(out).not.toContain(encodeURIComponent('http://127.0.0.1:53545'));
      expect(displayQRCodeMock).toHaveBeenCalledTimes(1);
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
      runTailscaleServeStatusMock.mockReset();
    }
  }, 15_000);

  it('prints a LAN-only hint when canonical serverUrl is local HTTP', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-lan-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'http://192.168.1.10:3005',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const out = output.logs.join('\n').toLowerCase();
      expect(out).toContain('same lan');
      expect(displayQRCodeMock).toHaveBeenCalledTimes(1);
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('prints a hint when mobile links cannot embed localhost server URLs', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-loopback-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'http://127.0.0.1:53545',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const out = output.logs.join('\n').toLowerCase();
      expect(out).toContain('does not include a server url');
      expect(displayQRCodeMock).toHaveBeenCalledTimes(1);
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('keeps localhost in web auth links and describes it as same-machine only', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-web-loopback-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'http://localhost:3010',
        HAPPIER_WEBAPP_URL: 'http://happier-dev-auth.localhost:8082',
        HAPPIER_PUBLIC_SERVER_URL: undefined,
        HAPPIER_TAILSCALE_AUTO_PUBLIC_URL: '0',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: 'web',
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const out = output.logs.join('\n').toLowerCase();
      expect(out).toContain(encodeURIComponent('http://localhost:3010').toLowerCase());
      expect(out).toContain('same machine');
      expect(out).not.toContain('same lan');
      expect(out).toContain('does not include a server url');
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('uses apiServerUrl for auth API calls when HAPPIER_PUBLIC_SERVER_URL is set', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-apiServerUrl-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'http://127.0.0.1:53545',
        HAPPIER_PUBLIC_SERVER_URL: 'https://my-stack.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: 'web',
      });

      vi.resetModules();
      const axiosModule = await import('axios');
      const axiosDefault = axiosModule.default as AxiosLike;
      (axiosDefault.post as unknown as { mockClear: () => void }).mockClear();
      (axiosDefault.get as unknown as { mockClear: () => void }).mockClear();

      const { doAuth } = await import('./auth');
      const creds = await doAuth();
      expect(creds?.token).toBe('tok');

      const postMock = axiosDefault.post as unknown as { mock: { calls: unknown[][] } };
      const getMock = axiosDefault.get as unknown as { mock: { calls: unknown[][] } };
      const postUrls = postMock.mock.calls.map((c) => String(c[0]));
      const getUrls = getMock.mock.calls.map((c) => String(c[0]));
      expect(postUrls.join('\n')).toContain('http://127.0.0.1:53545/v1/auth/request');
      expect(getUrls.join('\n')).toContain('http://127.0.0.1:53545/v1/auth/request/status');
      expect(postUrls.join('\n')).not.toContain('https://my-stack.example.test');
      expect(getUrls.join('\n')).not.toContain('https://my-stack.example.test');

      const out = output.logs.join('\n');
      expect(out).toContain(encodeURIComponent('https://my-stack.example.test'));
      expect(out).not.toContain(encodeURIComponent('http://127.0.0.1:53545'));
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('routes fresh authentication through a published runtime origin while keeping canonical links', async () => {
    const home = await createTempDir('happier-cli-auth-runtime-origin-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    let releaseRuntimeOrigin: (() => void) | null = null;

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://canonical-home.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: 'web',
      });

      vi.resetModules();
      const runtimeOrigin = 'http://127.0.0.1:48123';
      const httpBase = await import('@/api/client/serverHttpBaseUrl');
      releaseRuntimeOrigin = httpBase.publishServerHttpRuntimeOrigin(runtimeOrigin, 'iroh');
      const axiosModule = await import('axios');
      const axiosDefault = axiosModule.default as AxiosLike;
      (axiosDefault.post as unknown as { mockClear: () => void }).mockClear();
      (axiosDefault.get as unknown as { mockClear: () => void }).mockClear();

      const { doAuth } = await import('./auth');
      expect((await doAuth())?.token).toBe('tok');

      expect(fetchServerFeaturesSnapshotMock).toHaveBeenCalledWith({ serverUrl: runtimeOrigin });
      const postUrls = (axiosDefault.post as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((call) => String(call[0]));
      const getUrls = (axiosDefault.get as unknown as { mock: { calls: unknown[][] } }).mock.calls
        .map((call) => String(call[0]));
      expect([...postUrls, ...getUrls].every((url) => url.startsWith(runtimeOrigin))).toBe(true);
      expect(output.logs.join('\n')).toContain('https://canonical-home.example.test');
    } finally {
      releaseRuntimeOrigin?.();
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 30_000);

  it('fails fast with a clear message when claim response token/response are invalid', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-invalid-claim-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();

    const axiosModule = await import('axios');
    const axiosDefault = axiosModule.default as AxiosLike;
    const originalPost = axiosDefault.post;

    try {
      axiosDefault.post = vi.fn(async (url: string, body?: unknown) => {
        if (url.endsWith('/v1/auth/request')) {
          const publicKey = (body as { publicKey?: unknown } | undefined)?.publicKey;
          capturedPublicKeyBase64 = typeof publicKey === 'string' ? publicKey : '';
          return { data: { state: 'requested' } };
        }
        if (url.endsWith('/v1/auth/request/claim')) {
          return {
            data: {
              state: 'authorized',
              token: 123,
              response: null,
            },
          };
        }
        throw new Error(`Unexpected axios.post URL: ${url}`);
      }) as AxiosLike['post'];

      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: undefined,
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');
      const creds = await doAuth();

      expect(creds).toBeNull();
      expect(output.logs.join('\n')).toContain('Unexpected response from server. Please try again.');
    } finally {
      axiosDefault.post = originalPost;
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);

  it('does not print a QR code when method is web', async () => {
    const home = await createTempDir('happier-cli-auth-noninteractive-web-');
    const envScope = createEnvKeyScope(envKeys);
    const restoreTty = setStdioTtyForTest({ stdin: false, stdout: false });
    const output = captureConsoleLogAndMuteStdout();
    displayQRCodeMock.mockClear();

    try {
      envScope.patch({
        HAPPIER_HOME_DIR: home,
        HAPPIER_SERVER_URL: 'https://server.example.test',
        HAPPIER_WEBAPP_URL: 'https://webapp.example.test',
        HAPPIER_NO_BROWSER_OPEN: '1',
        HAPPIER_AUTH_POLL_INTERVAL_MS: '1',
        HAPPIER_AUTH_METHOD: 'web',
      });

      vi.resetModules();
      const { doAuth } = await import('./auth');

      const creds = await doAuth();
      expect(creds?.token).toBe('tok');
      expect(displayQRCodeMock).not.toHaveBeenCalled();

      const out = output.logs.join('\n');
      expect(out).toContain('webapp.example.test/terminal/connect#key=');
      expect(out).toContain('happier://terminal?');
    } finally {
      output.restore();
      restoreTty();
      envScope.restore();
      await removeTempDir(home);
    }
  }, 15_000);
});
