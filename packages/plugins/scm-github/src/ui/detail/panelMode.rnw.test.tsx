// @vitest-environment jsdom
import { act } from 'react';
import type { JsonValue } from '@happier-dev/plugin-sdk';
import { createPluginUiTestkit, createSurfaceContextFixture } from '@happier-dev/plugin-sdk/testing';
import type { PluginUiTestkit } from '@happier-dev/plugin-sdk/testing';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GITHUB_CONNECTED_ACCOUNT_PURPOSE,
  GITHUB_PLUGIN_ID,
} from '../../observations/githubProviderContracts.js';
import { GITHUB_TRIAGE_DETAIL_ACTION_IDS_V1 } from '../../triage/contribution.js';

import { renderSurface } from '../renderSurface.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

/**
 * (Fixture shared in shape with the Checks Session-start test.)
 * The mounted Checks plane's Session-start boundary (`core/SESSIONS.md` §1).
 *
 * The Triage common header is the sole source-neutral Session-intent owner,
 * and the canonical configurable action path lives in the aggregate's detail
 * region right beside this body. A source detail body therefore mounts zero
 * Session-start controls: it shows GitHub's own facts and nothing that starts,
 * seeds or opens a Session. This test pins that boundary on the one plane that
 * historically carried a provider-local "Fix CI" shortcut, and would catch its
 * reintroduction in any other plane's clothes.
 */

const SOURCE_CONTRIBUTION = Object.freeze({
  pluginId: GITHUB_PLUGIN_ID,
  localId: 'github-forge',
});

const HEAD_REVISION = '9f2c1a7d4b6e08f3a5c9d2e1b0847af63d5c1e29';

function launchInput(): JsonValue {
  return {
    v: 1,
    instance: {
      v: 1,
      instance: {
        source: SOURCE_CONTRIBUTION,
        sourceInstanceId: '9d2a6b1e-6c1a-4b7d-9f31-1d4a6c8b2e70',
      },
      binding: {
        purpose: GITHUB_CONNECTED_ACCOUNT_PURPOSE,
        account: {
          service: { pluginId: GITHUB_PLUGIN_ID, localId: 'github-account' },
          accountId: 'account-1',
        },
      },
      localInstanceKey: 'github.com',
      configuration: { v: 1, token: 'github-configuration-token-v1' },
    },
    observation: {
      entryRef: {
        source: SOURCE_CONTRIBUTION,
        kindId: 'pull-request',
        collisionScope: 'github:1296269',
        entryId: '1284',
      },
      observedAtMs: 1_760_000_700_000,
      locator: {
        v: 1,
        webUrl: 'https://github.com/octo-org/example-app/pull/1284',
        displayPath: 'octo-org/example-app#1284',
        routingToken: 'octo-org/example-app',
      },
      snapshot: {
        v: 1,
        title: 'Consolidate the duplicated normalizer',
        scopeLabel: 'octo-org/example-app',
        state: { presentation: 'active', nativeLabel: 'Open' },
        facts: [],
      },
      viewer: { involvement: [] },
    },
    linkedSessions: [],
  } as JsonValue;
}

/** The failing-check read answer, carrying exactly the evidence a reader sees. */
function failingChecksAnswer(): JsonValue {
  return {
    kind: 'checks',
    rowState: { kind: 'failing', failingCount: 1 },
    headRevision: HEAD_REVISION,
    state: 'resolved',
    rows: [{
      key: 'github-check-run:9003',
      resourceKind: 'check-run',
      name: 'build',
      status: 'completed',
      conclusion: 'failure',
      logExcerpt: 'Typecheck found 2 errors in src/pump.ts.',
    }],
    failingCount: 1,
    runningCount: 0,
    passingCount: 0,
    omittedRowCount: 0,
    projectionTruncated: false,
  } as JsonValue;
}

function emptyFeedbackAnswer(kind: string): JsonValue {
  return { kind, rows: [] } as JsonValue;
}

const mounted: PluginUiTestkit[] = [];

afterEach(async () => {
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

/**
 * Panel mode (r0.42): the Triage detail frame owns the tab strip and asks this
 * body for exactly one panel. The body renders that panel and no tab strip of
 * its own, and its Overview panel is the story rail's source half.
 */
async function mountPanel(panel: string): Promise<PluginUiTestkit> {
  let detail!: PluginUiTestkit;
  await act(async () => {
    detail = await createPluginUiTestkit({
      identity: { instanceId: `fixture-instance-panel-${panel}`, mountNonce: `fixture-mount-panel-${panel}` },
      authorPlugin: { id: GITHUB_PLUGIN_ID, version: '0.0.0' },
      surface: renderSurface,
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
      launchInput: { ...(launchInput() as Record<string, JsonValue>), panel } as JsonValue,
      handlers: {
        executeAction: async ({ action }) => {
          const localId = (action as { localId: string }).localId;
          if (localId === GITHUB_TRIAGE_DETAIL_ACTION_IDS_V1.readChecks) return failingChecksAnswer();
          if (localId === GITHUB_TRIAGE_DETAIL_ACTION_IDS_V1.listChangedFiles) {
            return {
              kind: 'changedFiles',
              rows: [
                { path: 'src/cart/totals.ts', status: 'modified', additions: 96, deletions: 71, changes: 167, diffAvailable: true },
                { path: 'README.md', status: 'modified', additions: 1, deletions: 0, changes: 1, diffAvailable: true },
              ],
              omittedRowCount: 0,
              projectionTruncated: false,
            } as JsonValue;
          }
          return { kind: 'unavailable', failure: { class: 'transient', code: 'not-under-test' } } as JsonValue;
        },
      },
    });
  });
  mounted.push(detail);
  return detail;
}

describe('the GitHub detail as Triage panels', () => {
  it('renders only the requested panel, with no tab strip of its own', async () => {
    const detail = await mountPanel('checks');
    await expect(detail.getByText('build')).resolves.toBeDefined();
    await expect(detail.queryAllByRole('tab')).resolves.toEqual([]);
  });

  it('draws the story rail: the ask, what changed, and the failing checks state in words', async () => {
    const detail = await mountPanel('overview');
    await expect(detail.getByRole('heading', { name: 'The ask' })).resolves.toBeDefined();
    await expect(detail.getByRole('heading', { name: 'What changed' })).resolves.toBeDefined();
    await expect(detail.getByText('src/cart/totals.ts')).resolves.toBeDefined();
    await expect(detail.getByText('+97 −71 in 2 files')).resolves.toBeDefined();
    await expect(detail.getByRole('image', { name: '1 failing' })).resolves.toBeDefined();
  });
});
