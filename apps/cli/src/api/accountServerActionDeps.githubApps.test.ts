import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fastify from 'fastify';

import { installAxiosFastifyAdapter } from '@/testkit/http/axiosAdapter';
import { createAccountServerActionDeps } from './accountServerActionDeps';

describe('managed GitHub App CLI adapter', () => {
  let app = fastify();
  let restore = () => {};
  beforeEach(() => {
    app = fastify();
    restore = installAxiosFastifyAdapter({ app, origin: 'http://home.test' });
  });
  afterEach(async () => { restore(); await app.close(); });

  it('posts the validated family intent with the bound Account bearer', async () => {
    const seen: unknown[] = [];
    app.post('/v1/identity/github-apps/list', async (request) => {
      seen.push({ body: request.body, authorization: request.headers.authorization });
      return { registrations: [], installations: [] };
    });
    const deps = createAccountServerActionDeps({ token: 'bound', serverId: 'home', serverHttpBaseUrl: 'http://home.test' });

    await expect(deps.homeDomainAction!({
      actionId: 'identity.githubApps.list',
      input: { owner: { kind: 'team', teamId: 'team-1' } },
      context: { surface: 'cli' } as never,
    })).resolves.toEqual({ registrations: [], installations: [] });
    expect(seen).toEqual([{ body: { owner: { kind: 'team', teamId: 'team-1' } }, authorization: 'Bearer bound' }]);
  });

  it('refuses a context for another Home before issuing the bound request', async () => {
    let reached = 0;
    app.post('/v1/identity/github-apps/list', async () => {
      reached++;
      return { registrations: [], installations: [] };
    });
    const deps = createAccountServerActionDeps({
      token: 'bound',
      serverId: 'home-a',
      serverHttpBaseUrl: 'http://home.test',
    });

    await expect(deps.homeDomainAction!({
      actionId: 'identity.githubApps.list',
      input: { owner: { kind: 'team', teamId: 'team-1' } },
      context: { surface: 'cli', serverId: 'home-b' } as never,
    })).resolves.toEqual({
      ok: false,
      errorCode: 'server_target_mismatch',
      error: 'server_target_mismatch',
    });
    expect(reached).toBe(0);
  });
});
