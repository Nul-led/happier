import { describe, expect, it } from 'vitest';

import { admitGitlabItemIdentity, resolveGitlabItemRoute } from '../admission.js';
import { normalizeGitlabConfiguredBaseUrl } from '../origin.js';

describe('GitLab mutation route admission', () => {
  it('routes from the canonical repository locator and keeps collision scope as identity only', () => {
    const origin = normalizeGitlabConfiguredBaseUrl('https://gitlab.com');
    if (origin === null) throw new Error('unusable test origin');
    const identity = admitGitlabItemIdentity({
      localRef: {
        kindId: 'merge-request',
        collisionScope: `gitlab:${Buffer.from(origin.normalized).toString('base64url')}:3`,
        entryId: '7',
      },
      admissibleKinds: ['merge-request'],
    });
    if (!identity.ok) throw new Error('unusable test identity');

    expect(resolveGitlabItemRoute(identity.identity, origin, 'group/subgroup/project'))
      .toMatchObject({
        ok: true,
        route: { repositoryKey: 'group/subgroup/project', iid: '7' },
      });
    expect(resolveGitlabItemRoute(identity.identity, origin, 'not-a-repository-key'))
      .toMatchObject({ ok: false, failure: { code: 'locator-routing-token-invalid' } });
  });
});
