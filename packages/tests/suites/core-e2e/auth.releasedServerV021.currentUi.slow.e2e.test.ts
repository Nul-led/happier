import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createTestAuth } from '../../src/testkit/auth';
import { fetchJson } from '../../src/testkit/http';
import { repoRootDir } from '../../src/testkit/paths';
import {
  resolveReleasedServerV021ArtifactPrerequisite,
  startReleasedServerLight,
  type StartedReleasedServerLight,
} from '../../src/testkit/process/releasedServerLight';
import { createRunDirs } from '../../src/testkit/runDir';

const run = createRunDirs({ runLabel: 'core' });
const releasedServerArtifact = resolveReleasedServerV021ArtifactPrerequisite({
  defaultArtifactDir: join(repoRootDir(), '.project/tmp/c1-server-v0.2.1'),
});

const describeReleasedServer = releasedServerArtifact.status === 'ready' ? describe : describe.skip;
const suiteName = releasedServerArtifact.status === 'ready'
  ? 'core e2e: current UI ordinary Home auth against immutable server-v0.2.1'
  : `core e2e: current UI ordinary Home auth against immutable server-v0.2.1 [skipped: ${releasedServerArtifact.reason}]`;

describeReleasedServer(suiteName, () => {
  let server: StartedReleasedServerLight | null = null;

  afterEach(async () => {
    await server?.stop().catch(() => {});
    server = null;
  });

  it('falls back to the released v1 request and obtains a usable ordinary Home credential', async () => {
    if (releasedServerArtifact.status !== 'ready') throw new Error(releasedServerArtifact.reason);
    server = await startReleasedServerLight({
      testDir: run.testDir('auth-released-server-v0-2-1-current-ui'),
      archivePath: releasedServerArtifact.archivePath,
      manifestPath: releasedServerArtifact.manifestPath,
      expectedArchiveSha256: releasedServerArtifact.expectedArchiveSha256,
    });
    const account = await createTestAuth(server.baseUrl);

    // @ts-expect-error -- this composed suite's Vitest config maps @/ to UI source; the package-wide TS program maps it to CLI source.
    const { authGetTokenAtEndpoint } = await import('@/auth/flows/getToken');
    const credentials = await authGetTokenAtEndpoint({
      endpointUrl: server.baseUrl,
      secret: account.accountSigningSeed,
      requireKeyChallengeV2: false,
    });

    expect(credentials).toEqual({ token: expect.any(String) });
    const profile = await fetchJson<unknown>(`${server.baseUrl}/v1/account/profile`, {
      headers: { Authorization: `Bearer ${credentials.token}` },
    });
    expect(profile.status).toBe(200);
  });
});
