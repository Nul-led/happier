// @vitest-environment jsdom
import React, { act } from 'react';
import type { JsonValue } from '@happier-dev/plugin-sdk';
import { createPluginUiTestkit, createSurfaceContextFixture } from '@happier-dev/plugin-sdk/testing';
import type { PluginUiTestkit, PluginUiTestkitHostHandlers } from '@happier-dev/plugin-sdk/testing';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { TriagePostMutationCompletionProvider } from '@happier-dev/triage-sources/ui';
import { afterEach, describe, expect, it } from 'vitest';

import {
  GITLAB_CONNECTED_ACCOUNT_PURPOSE,
  GITLAB_PLUGIN_ID,
  GITLAB_TRIAGE_DETAIL_ACTION_IDS,
} from '../../triage/contribution.js';
import { renderSurface } from '../renderSurface.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SOURCE = Object.freeze({ pluginId: GITLAB_PLUGIN_ID, localId: 'gitlab-forge' });
const LOCAL_REF = Object.freeze({
  kindId: 'merge-request',
  collisionScope: 'gitlab.com:group/project',
  entryId: '412',
});
const LOCATOR = Object.freeze({
  v: 1,
  webUrl: 'https://gitlab.com/group/project/-/merge_requests/412',
  displayPath: 'group/project !412',
  routingToken: 'group/project',
});
const SNAPSHOT = Object.freeze({
  v: 1,
  title: 'Read the provider description',
  scopeLabel: 'group/project',
  state: Object.freeze({ presentation: 'active', nativeLabel: 'Opened' }),
  facts: Object.freeze([]),
});
const VIEWER = Object.freeze({ involvement: Object.freeze(['reviewRequested']) });
const LAUNCH_INPUT = {
  v: 1,
  instance: {
    v: 1,
    instance: {
      source: SOURCE,
      sourceInstanceId: '9d2a6b1e-6c1a-4b7d-9f31-1d4a6c8b2e70',
    },
    binding: {
      purpose: GITLAB_CONNECTED_ACCOUNT_PURPOSE,
      account: {
        service: { pluginId: GITLAB_PLUGIN_ID, localId: 'gitlab-account' },
        accountId: 'account-1',
      },
    },
    localInstanceKey: 'gitlab-com',
    configuration: { v: 1, token: 'gitlab-configuration-token-v1' },
  },
  observation: {
    entryRef: { source: SOURCE, ...LOCAL_REF },
    observedAtMs: 1_760_000_700_000,
    locator: LOCATOR,
    snapshot: SNAPSHOT,
    viewer: VIEWER,
  },
  linkedSessions: [],
} as unknown as JsonValue;

function overviewResult(description: string): JsonValue {
  return {
    kind: 'overview',
    observedAtMs: 1_760_000_700_100,
    observation: {
      kind: 'present',
      localRef: LOCAL_REF,
      locator: LOCATOR,
      snapshot: SNAPSHOT,
      viewer: VIEWER,
    },
    description,
    descriptionTruncated: false,
  } as unknown as JsonValue;
}

function changesResult(
  path: string,
  continuation: string | null,
): JsonValue {
  return {
    kind: 'changes',
    rows: [{
      path,
      newFile: false,
      renamedFile: false,
      deletedFile: false,
      collapsed: false,
      tooLarge: false,
    }],
    diffLimitStatus: 'reported',
    omittedRowCount: 0,
    projectionTruncated: false,
    ...(continuation === null ? {} : { continuation }),
  } as unknown as JsonValue;
}

const mounted: PluginUiTestkit[] = [];

afterEach(async () => {
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

async function mountDetail(
  executeAction: NonNullable<PluginUiTestkitHostHandlers['executeAction']>,
): Promise<PluginUiTestkit> {
  let detail!: PluginUiTestkit;
  await act(async () => {
    detail = await createPluginUiTestkit({
      identity: {
        pluginId: GITLAB_PLUGIN_ID,
        pluginVersion: '0.0.0',
        viewId: 'gitlab-detail',
        generation: 'gitlab-panel-lifecycle',
      },
      surface: (context) => (
        <TriagePostMutationCompletionProvider onComplete={async () => {}}>
          {renderSurface(context) as React.ReactNode}
        </TriagePostMutationCompletionProvider>
      ),
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
      launchInput: LAUNCH_INPUT,
      handlers: { executeAction },
    });
  });
  mounted.push(detail);
  return detail;
}

async function openTab(detail: PluginUiTestkit, name: string): Promise<void> {
  await act(async () => {
    await detail.press(await detail.getByRole('tab', { name }));
  });
}

describe('the mounted GitLab detail-panel lifecycle', () => {
  it('reads the provider description when the initially active Overview mounts', async () => {
    const dispatched: string[] = [];
    const detail = await mountDetail(async ({ action }) => {
      const localId = (action as Readonly<{ localId?: string }>).localId ?? '';
      dispatched.push(localId);
      if (localId === GITLAB_TRIAGE_DETAIL_ACTION_IDS.readOverview) {
        return overviewResult('Description fetched from GitLab on the first active interval.');
      }
      throw new Error(`unexpected action ${localId}`);
    });

    await expect(detail.getByText('Description fetched from GitLab on the first active interval.'))
      .resolves.toBeDefined();
    expect(dispatched.filter((id) => id === GITLAB_TRIAGE_DETAIL_ACTION_IDS.readOverview))
      .toHaveLength(1);
  });

  it('retains the Changes viewport mount but clears parsed rows and its cursor on leave', async () => {
    const continuations: Array<string | undefined> = [];
    let resolveRestart!: (value: JsonValue) => void;
    const restartedFirstPage = new Promise<JsonValue>((resolve) => { resolveRestart = resolve; });
    const detail = await mountDetail(async ({ action, input }) => {
      const localId = (action as Readonly<{ localId?: string }>).localId ?? '';
      if (localId === GITLAB_TRIAGE_DETAIL_ACTION_IDS.readOverview) {
        return overviewResult('Current provider description.');
      }
      if (localId === GITLAB_TRIAGE_DETAIL_ACTION_IDS.listChanges) {
        const continuation = (input as Readonly<{ continuation?: string }>).continuation;
        continuations.push(continuation);
        if (continuations.length === 1) return changesResult('src/first.ts', 'changes-page-2');
        if (continuations.length === 2) return changesResult('src/second.ts', null);
        return restartedFirstPage;
      }
      throw new Error(`unexpected action ${localId}`);
    });

    await openTab(detail, 'Changes');
    await expect(detail.getByText('src/first.ts')).resolves.toBeDefined();
    await act(async () => {
      await detail.press(await detail.getByRole('button', { name: 'Show more files' }));
    });
    await expect(detail.getByText('src/second.ts')).resolves.toBeDefined();

    await openTab(detail, 'Overview');
    await openTab(detail, 'Changes');

    await expect(detail.getByText('Reading the changed files from GitLab')).resolves.toBeDefined();
    await expect(detail.queryByText('src/first.ts')).resolves.toBeUndefined();
    await expect(detail.queryByText('src/second.ts')).resolves.toBeUndefined();
    expect(continuations).toEqual([undefined, 'changes-page-2', undefined]);

    await act(async () => {
      resolveRestart(changesResult('src/restarted.ts', null));
      await Promise.resolve();
    });
    await expect(detail.getByText('src/restarted.ts')).resolves.toBeDefined();
  });
});
