import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScmHostingProviderRef } from '@happier-dev/plugin-sdk/scm/hosting';
import { gitlabRestPullRequestAdapter as adapter } from './restAdapter.js';

const provider: ScmHostingProviderRef = {
  id: 'happier.scm.forge.gitlab/gitlab', kind: 'gitlab', displayName: 'GitLab',
  baseUrl: 'https://forge.example.test:8443/GitLab', nameWithOwner: 'platform/nested/app',
  urlSafety: { allowedSchemes: ['https:'] },
};
const runtimeServices = {
  resolveScmHostingTokenMaterialization: async () => ({ kind: 'available' as const, token: 'bound-token' }),
};
const api = `${provider.baseUrl}/api/v4/projects/platform%2Fnested%2Fapp/merge_requests`;
function row(iid = 9) {
  return { iid, title: 'Review', web_url: `${provider.baseUrl}/platform/nested/app/-/merge_requests/${iid}`,
    state: 'opened', source_branch: 'feature', target_branch: 'main', description: 'Full body' };
}

afterEach(() => vi.unstubAllGlobals());

describe('GitLab Connected Account REST pull requests', () => {
  it('exhausts provider pagination and resolves a branch reference through the same exact deployment', async () => {
    const continuation = `${api}?page=2`;
    const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(
      url === continuation ? [row(10)] : [row()],
    ), { status: 200, headers: url === continuation ? {} : { Link: `<${continuation}>; rel="next"` } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(adapter.listPullRequests({ provider, runtimeServices, head: 'feature', base: 'main' }))
      .resolves.toMatchObject([{ number: 9 }, { number: 10 }]);
    expect(fetcher.mock.calls[0]?.[0]).toContain('source_branch=feature');
    expect(fetcher.mock.calls[0]?.[0]).toContain('target_branch=main');
    fetcher.mockImplementation(async (url) => new Response(JSON.stringify(url.endsWith('/9') ? row() : [row()]), { status: 200 }));
    await expect(adapter.getPullRequest({ provider, runtimeServices, reference: { headBranch: 'feature' } }))
      .resolves.toMatchObject({ number: 9, description: 'Full body' });
  });

  it('reads a URL reference only within the exact repository and preserves detail body', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(row()), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(adapter.getPullRequest({ provider, runtimeServices, reference: { url: row().web_url } }))
      .resolves.toMatchObject({ number: 9, description: 'Full body' });
    await expect(adapter.getPullRequest({ provider, runtimeServices,
      reference: { url: row().web_url.replace('/GitLab/', '/Other/') } }))
      .rejects.toMatchObject({ errorCode: 'INVALID_REQUEST', effectNotApplied: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 500])('distinguishes a definite HTTP rejection from an uncertain creation (%s)', async (status) => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ message: 'Rejected' }), { status }));
    await expect(adapter.createPullRequest({ provider, runtimeServices, head: 'feature', base: 'main', title: 'Review' }))
      .rejects.toMatchObject({ effectNotApplied: status === 400 });
  });

  it('fails closed without a bound account and preserves cancellation at the HTTP boundary', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      return new Response(JSON.stringify(row()), { status: 201 });
    });
    vi.stubGlobal('fetch', fetcher);
    const create = { provider, head: 'feature', base: 'main', title: 'Review' };
    await expect(adapter.createPullRequest(create)).rejects.toMatchObject({ errorCode: 'REMOTE_AUTH_REQUIRED', effectNotApplied: true });
    expect(fetcher).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(adapter.createPullRequest({ ...create, runtimeServices, signal: controller.signal }))
      .rejects.toMatchObject({ effectNotApplied: false });
  });

  it('does not label an unreadable creation response as an unsupported non-effect', async () => {
    vi.stubGlobal('fetch', async () => new Response('unreadable JSON', { status: 201 }));
    await expect(adapter.createPullRequest({ provider, runtimeServices, head: 'feature', base: 'main', title: 'Review' }))
      .rejects.toMatchObject({ errorCode: 'COMMAND_FAILED', effectNotApplied: false });
  });
});
