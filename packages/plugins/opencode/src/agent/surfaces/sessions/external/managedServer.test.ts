import { describe, expect, it } from 'vitest';

import type {
  AgentExternalSessionSource,
} from '@happier-dev/plugin-sdk/sessions/external';
import type { ExecService } from '@happier-dev/plugin-sdk/exec';

import {
  OPENCODE_DATA_ROOT_OVERRIDE_ENV_KEYS,
} from '../../../runtime/server/spawnSpec.js';
import {
  OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID,
  resolveOpenCodeExternalSessionsManagedService,
} from './managedServer.js';

const signal = new AbortController().signal;

/**
 * Boundary fixture for the host's system-tool resolution: the declaration reads
 * only where OpenCode resolved, and the stable executable is what this suite's
 * endpoint-policy rows are about. Generation selection itself is proven in
 * `managedDialect.composed.test.ts`.
 */
const exec = { systemTools: { resolve: async () => ({ executablePath: '/usr/local/bin/opencode' }) } } as unknown as ExecService;

function declareManagedService(source: AgentExternalSessionSource) {
  return resolveOpenCodeExternalSessionsManagedService({ source, signal, exec });
}

describe('OpenCode External Sessions managed server declaration', () => {
  it('declares an authenticated owned server for the default managed-endpoint source', async () => {
    const spec = await declareManagedService({ kind: 'opencodeServer', managedEndpoint: true });

    expect(spec).toMatchObject({
      id: OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID,
      mode: { kind: 'spawn' },
      clientAccess: {
        kind: 'hostBasic',
        username: 'opencode',
        injectPasswordEnvironmentKey: 'OPENCODE_SERVER_PASSWORD',
      },
    });
    expect(spec?.mode.kind === 'spawn' ? spec.mode.launch.args : null)
      .toEqual(['serve', '--hostname', '127.0.0.1']);
  });

  it('never repoints the owned server away from the user OpenCode data root', async () => {
    const spec = await declareManagedService({ kind: 'opencodeServer', managedEndpoint: true });
    const launchEnv = spec?.mode.kind === 'spawn' ? spec.mode.launch.env ?? {} : {};

    // The host replaces rather than merges the child environment, and OpenCode
    // resolves its database under `XDG_DATA_HOME ?? os.homedir()`. Any of these
    // keys in the launch environment silently yields an empty corpus instead of
    // the user's sessions.
    for (const key of OPENCODE_DATA_ROOT_OVERRIDE_ENV_KEYS) {
      expect(launchEnv).not.toHaveProperty(key);
    }
    expect(launchEnv).toMatchObject({ OPENCODE_DISABLE_PRUNE: '1' });
  });

  it('attaches to a user existing server through the same managed-service owner', async () => {
    // A server the user runs must not be duplicated by a competing owned one,
    // but it is still reached the one way every OpenCode server is reached: a
    // managed service whose credential the host resolves and applies.
    const spec = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'http://127.0.0.1:4096' });

    expect(spec).toMatchObject({
      mode: { kind: 'attach', baseUrl: 'http://127.0.0.1:4096' },
      healthCheck: { kind: 'http', target: { kind: 'servicePath', path: '/global/health' } },
      clientAccess: {
        kind: 'declaredSecretBasic',
        username: 'opencode',
        passwordSecretId: 'opencodeServerPassword',
      },
    });
    expect(spec?.id).not.toBe(OPENCODE_EXTERNAL_SESSIONS_SERVICE_ID);
  });

  it('keeps two attached servers on distinct managed-service entries', async () => {
    const first = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'http://127.0.0.1:4096' });
    const second = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'http://127.0.0.1:4097' });

    expect(first?.id).not.toEqual(second?.id);
    const sameAddressAgain = await declareManagedService({
      kind: 'opencodeServer',
      baseUrl: 'http://127.0.0.1:4096',
    });
    expect(sameAddressAgain?.id).toEqual(first?.id);
  });

  it('normalizes an attached endpoint before deriving its managed-service identity', async () => {
    const first = await declareManagedService({
      kind: 'opencodeServer',
      baseUrl: 'https://OpenCode.Example.test:443/first?ignored=1#ignored',
    });
    const sameOrigin = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'https://opencode.example.test/first' });
    const differentPort = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'https://opencode.example.test:444/' });
    const differentScheme = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'http://localhost:4096/' });

    expect(first?.mode).toEqual({ kind: 'attach', baseUrl: 'https://opencode.example.test/first' });
    expect(first?.id).toEqual(sameOrigin?.id);
    expect(first?.id).not.toEqual(differentPort?.id);
    expect(first?.id).not.toEqual(differentScheme?.id);
  });

  // One matrix over the endpoint policy this leaf actually decides. Each row is
  // a distinct decision, not a restatement: which service shape is declared,
  // and — for every rejection — that the leaf declares NOTHING rather than
  // quietly falling back to a server pointed at a different corpus.
  it('fails closed on a malformed override instead of falling back to the managed default', async () => {
    // The same request also asks for the managed endpoint. Declaring the owned
    // spawn here would browse Happier's own data root while the user believes
    // they are attached to the server they named.
    expect(await declareManagedService({
      kind: 'opencodeServer',
      baseUrl: 'not-a-url',
      managedEndpoint: true,
    })).toBeNull();
  });

  it('refuses a non-loopback plain-HTTP override', async () => {
    // `https:` reaches any host; plain `http:` stays on this machine, because a
    // Basic credential over cleartext to a remote host is the one shape the
    // shared endpoint policy will not dial.
    expect(await declareManagedService({ kind: 'opencodeServer', baseUrl: 'http://opencode.example.test:4096' })).toBeNull();
    expect(await declareManagedService({ kind: 'opencodeServer', baseUrl: 'https://opencode.example.test:4096' })).toMatchObject({
      mode: { kind: 'attach', baseUrl: 'https://opencode.example.test:4096' },
    });
  });

  it('keeps the attach credential bound to the service instead of the URL', async () => {
    // A URL-embedded credential is refused outright: it would otherwise be
    // normalized into the attach `baseUrl`, hashed into the service id, and
    // carried through every snapshot and log of that service.
    expect(await declareManagedService({ kind: 'opencodeServer', baseUrl: 'https://opencode:hunter2@opencode.example.test' })).toBeNull();

    const spec = await declareManagedService({ kind: 'opencodeServer', baseUrl: 'https://opencode.example.test' });
    expect(spec?.mode).toEqual({ kind: 'attach', baseUrl: 'https://opencode.example.test' });
    expect(spec?.clientAccess).toEqual({
      kind: 'declaredSecretBasic',
      username: 'opencode',
      passwordSecretId: 'opencodeServerPassword',
    });
  });

  it('declares no service for a source another Agent owns', async () => {
    expect(await declareManagedService({ kind: 'claudeCode' })).toBeNull();
  });
});
