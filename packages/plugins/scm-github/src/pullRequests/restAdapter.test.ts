import type { ScmHostingProviderRef } from '@happier-dev/plugin-sdk/scm/hosting';
import { describe, expect, it } from 'vitest';
import { GITHUB_API_VERSION } from '../observations/githubProviderContracts.js';
import { createGithubRestAdapter } from './restAdapter.js';

const githubProvider: ScmHostingProviderRef = {
  id: 'scm.github',
  kind: 'github',
  displayName: 'GitHub',
  baseUrl: 'https://github.com',
  nameWithOwner: 'happier-dev/happier',
  urlSafety: { allowedSchemes: ['https:'] },
};

const enterpriseProvider: ScmHostingProviderRef = {
  ...githubProvider,
  baseUrl: 'https://ghe.internal.test',
};

function jsonResponse(body: unknown, init?: Readonly<{
  status?: number;
  statusText?: string;
  headers?: Readonly<Record<string, string>>;
}>) {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init?.statusText ?? 'OK',
    ...(init?.headers ? { headers: new Headers(init.headers) } : {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('GitHub REST pull request adapter', () => {
  it('marks a definite provider rejection as a non-effect without assuming the same for server errors', async () => {
    const create = { provider: githubProvider, base: 'main', head: 'feature', title: 'Review' };
    const rejected = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'bound-token' }),
      fetcher: async () => jsonResponse({ message: 'Validation failed' }, { status: 422 }),
    });
    await expect(rejected.createPullRequest(create)).rejects.toMatchObject({ errorCode: 'COMMAND_FAILED', effectNotApplied: true });
    const uncertain = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'bound-token' }),
      fetcher: async () => jsonResponse({ message: 'Server failed' }, { status: 500 }),
    });
    const error = await uncertain.createPullRequest(create).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toMatchObject({ effectNotApplied: true });
  });

  it('uses a github.com connected-account token for REST list requests', async () => {
    const requests: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token', profileKey: 'github:work' }),
      fetcher: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonResponse([
          {
            number: 1,
            title: 'PR from REST',
            html_url: 'https://github.com/happier-dev/happier/pull/1',
            state: 'open',
            base: { ref: 'main' },
            head: {
              ref: 'feature/rest',
              repo: { full_name: 'happier-dev/happier' },
            },
          },
        ]);
      },
    });
    const controller = new AbortController();

    await expect(adapter.listPullRequests({
      provider: githubProvider,
      base: 'main',
      head: 'feature/rest',
      state: 'open',
      signal: controller.signal,
    })).resolves.toEqual([
      expect.objectContaining({
        number: 1,
        title: 'PR from REST',
        baseBranch: 'main',
        headBranch: 'feature/rest',
        headRepositoryNameWithOwner: 'happier-dev/happier',
      }),
    ]);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('https://api.github.com/repos/happier-dev/happier/pulls?state=open&base=main&head=feature%2Frest');
    expect(requests[0]?.init?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      Authorization: ['Bearer', 'redacted-test-token'].join(' '),
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
    });
    expect(requests[0]?.init?.signal).toBe(controller.signal);
  });

  it('uses operation-scoped runtime token materialization when constructor token resolver is absent', async () => {
    const requests: Array<Readonly<{ url: string; init?: RequestInit }>> = [];
    const adapter = createGithubRestAdapter({
      fetcher: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonResponse([]);
      },
    });
    const input = {
      provider: githubProvider,
      head: 'feature/runtime-services',
      runtimeServices: {
        resolveScmHostingTokenMaterialization: async (request: Readonly<{
          kind: 'scm_hosting_token';
          providerId: string;
          host: string;
        }>) => ({
          kind: 'available' as const,
          token: [
            'redacted',
            request.kind,
            request.providerId,
            request.host,
          ].join(':'),
          profileKey: 'github:runtime',
        }),
      },
    };

    await expect(adapter.listPullRequests(input)).resolves.toEqual([]);

    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer redacted:scm_hosting_token:scm.github:github.com',
    });
    expect(adapter.getPullRequestAuthProfileKey({ provider: githubProvider })).toBe('github:runtime');
  });

  it('keeps auth profile keys scoped to the provider context that resolved them', async () => {
    const otherProvider: ScmHostingProviderRef = {
      ...githubProvider,
      id: 'scm.github.other',
      nameWithOwner: 'other-owner/other-repo',
    };
    const adapter = createGithubRestAdapter({
      resolveToken: async ({ provider }) => ({
        kind: 'available',
        token: `redacted-${provider.id}`,
        profileKey: provider.id === githubProvider.id ? 'github:work' : 'github:other',
      }),
      fetcher: async () => jsonResponse([]),
    });

    await adapter.listPullRequests({ provider: githubProvider, head: 'feature/one' });
    await adapter.listPullRequests({ provider: otherProvider, head: 'feature/two' });

    expect(adapter.getPullRequestAuthProfileKey({ provider: githubProvider })).toBe('github:work');
    expect(adapter.getPullRequestAuthProfileKey({ provider: otherProvider })).toBe('github:other');
  });

  it('does not send github.com token material to Enterprise hosts', async () => {
    const requests: unknown[] = [];
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token', profileKey: 'github:work' }),
      fetcher: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonResponse([]);
      },
    });

    await expect(adapter.listPullRequests({
      provider: enterpriseProvider,
      head: 'feature/rest',
    })).rejects.toMatchObject({
      errorCode: 'REMOTE_AUTH_REQUIRED',
    });
    expect(requests).toEqual([]);
  });

  it('rejects forged github.com provider base URLs before attaching token material', async () => {
    const requests: unknown[] = [];
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token' }),
      fetcher: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonResponse([]);
      },
    });

    await expect(adapter.listPullRequests({
      provider: {
        ...githubProvider,
        baseUrl: 'https://github.com:8443/path?x=1#fragment',
      },
      head: 'feature/rest',
    })).rejects.toMatchObject({
      errorCode: 'REMOTE_AUTH_REQUIRED',
    });
    expect(requests).toEqual([]);
  });

  it('rejects pull request URL references from a different repository before fetching current-repo data', async () => {
    const requests: unknown[] = [];
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token' }),
      fetcher: async (url: string, init?: RequestInit) => {
        requests.push({ url, init });
        return jsonResponse({});
      },
    });

    await expect(adapter.getPullRequest({
      provider: githubProvider,
      reference: { url: 'https://github.com/other-owner/other-repo/pull/12' },
    })).resolves.toBeNull();
    expect(requests).toEqual([]);
  });

  it('resolves checkout reference metadata without checkout orchestration', async () => {
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token', profileKey: 'github:work' }),
      fetcher: async (url: string) => {
        return jsonResponse({
          number: 12,
          title: 'Checkout metadata only',
          html_url: 'https://github.com/happier-dev/happier/pull/12',
          state: 'open',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'feature/checkout', sha: 'head-sha' },
        });
      },
    });

    await expect(adapter.resolvePullRequestCheckoutReference({
      provider: githubProvider,
      reference: { number: 12 },
    })).resolves.toMatchObject({
      branch: 'feature/checkout',
      headSha: 'head-sha',
      baseSha: 'base-sha',
      pullRequest: {
        number: 12,
      },
    });
  });

  it('classifies a throttled GitHub 403 as a retryable backend limit, not a credential failure', async () => {
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token' }),
      fetcher: async () => jsonResponse({ message: 'API rate limit exceeded for user ID 1.' }, {
        status: 403,
        statusText: 'Forbidden',
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': '1700000000',
        },
      }),
    });

    // The credential is fine; GitHub exhausted its primary limit. Reporting this
    // as REMOTE_AUTH_REQUIRED tells the owner to reconnect an account that works.
    await expect(adapter.listPullRequests({
      provider: githubProvider,
      head: 'feature/rest',
    })).rejects.toMatchObject({
      errorCode: 'BACKEND_UNAVAILABLE',
    });
  });

  it('still reports an unthrottled GitHub 403 as remote authentication required', async () => {
    const adapter = createGithubRestAdapter({
      resolveToken: async () => ({ kind: 'available', token: 'redacted-test-token' }),
      fetcher: async () => jsonResponse({ message: 'Resource not accessible by personal access token' }, {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'X-Accepted-GitHub-Permissions': 'pull_requests=read' },
      }),
    });

    await expect(adapter.listPullRequests({
      provider: githubProvider,
      head: 'feature/rest',
    })).rejects.toMatchObject({
      errorCode: 'REMOTE_AUTH_REQUIRED',
    });
  });
});
