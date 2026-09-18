// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import {
  createPluginUiTestkit,
  createSurfaceContextFixture,
  type PluginUiTestkit,
} from '@happier-dev/plugin-sdk/testing';
import {
  Button,
  defineUiSurface,
  usePluginUiFocusTarget,
} from '@happier-dev/plugin-ui';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1 } from '../../actions/entrySessionProtocol.js';
import type { TriagePendingPullRequestReviewV1 } from './useEntrySessionStart.js';
import { TriagePullRequestReviewChooser } from './PullRequestReviewChooser.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PENDING = Object.freeze({
  sessionId: 'session-review',
  instructions: 'Review the exact selected pull request.',
  review: {
    instance: {
      v: 1,
      instance: {
        source: { pluginId: 'happier.example.source', localId: 'example-forge' },
        sourceInstanceId: '11111111-1111-4111-8111-111111111111',
      },
      binding: {
        purpose: 'triage-source',
        account: {
          service: { pluginId: 'happier.example.source', localId: 'accounts' },
          accountId: 'account-1',
        },
      },
      localInstanceKey: 'example/repository',
      configuration: { v: 1, token: 'routing-token' },
      locator: { v: 1, displayLabel: 'example/repository' },
    },
    entryRef: {
      source: { pluginId: 'happier.example.source', localId: 'example-forge' },
      kindId: 'pull-request',
      collisionScope: 'example/repository',
      entryId: '17',
    },
    lastKnownLocator: { webUrl: 'https://example.test/example/repository/pull/17' },
    observed: {
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      nativeRevision: 'revision-1',
      observedAtMs: 1_760_000_800_000,
    },
    workspace: {
      serverId: 'server-a',
      machineId: 'machine-a',
      rootPath: '/workspaces/repository',
    },
    repositoryPath: '/workspaces/repository-review-17',
    pullRequest: { number: 17 },
  },
}) as unknown as TriagePendingPullRequestReviewV1;

const mounted: PluginUiTestkit[] = [];

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mountChooser(executeAction: (
  action: string,
  input: unknown,
) => Promise<unknown>): Promise<Readonly<{
  fixture: PluginUiTestkit;
  focusedLabels: readonly string[];
}>> {
  const focusedLabels: string[] = [];
  const surface = defineUiSurface(function ReviewChooserProbe(): React.ReactElement {
    const invokingAction = usePluginUiFocusTarget();
    const [visible, setVisible] = React.useState(false);
    return (
      <>
        <Button
          title="Run code review"
          focusTarget={invokingAction}
          onPress={() => { setVisible(true); }}
        />
        {visible ? (
          <TriagePullRequestReviewChooser
            pending={PENDING}
            onFinished={() => { setVisible(false); }}
          />
        ) : null}
      </>
    );
  });
  const fixture = await createPluginUiTestkit({
    identity: { instanceId: 'fixture-instance-191', mountNonce: 'fixture-mount-191' },
    authorPlugin: { id: 'happier.triage', version: '0.0.0' },
    surface,
    surfaceContext: createSurfaceContextFixture(),
    adapter: createPluginUiRnwSemanticSurfaceAdapter({
      physicalFocus(target) {
        target.focus();
        const label = document.activeElement?.getAttribute('aria-label');
        if (label !== null && label !== undefined) focusedLabels.push(label);
        return true;
      },
    }),
    handlers: {
      executeAction: async ({ action, input }) => await executeAction(String(action), input),
    },
  });
  mounted.push(fixture);
  await fixture.press(await fixture.getByRole('button', { name: 'Run code review' }));
  await settle();
  return { fixture, focusedLabels };
}

afterEach(async () => {
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

describe('the mounted selected-PR review chooser', () => {
  it('lists exact current engines, requires an explicit choice, starts once, then opens the stable Session', async () => {
    const calls: Array<Readonly<{ action: string; input: unknown }>> = [];
    const { fixture, focusedLabels } = await mountChooser(async (action, input) => {
      calls.push({ action, input });
      if (action === 'review.engines.list') {
        return {
          sessionId: 'session-review',
          items: [
            { engineId: 'codex', label: 'Codex', enabled: true },
            { engineId: 'claude', label: 'Claude', enabled: true },
          ],
        };
      }
      if (action === TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1) {
        return {
          v: 1,
          status: 'started',
          startedEngineIds: ['codex', 'claude'],
          failedEngineIds: [],
        };
      }
      if (action === 'session.open') return null;
      throw new Error(`Unexpected action ${action}`);
    });

    expect(focusedLabels.at(-1)).toBe('Codex');
    expect(calls.map((call) => call.action)).toEqual(['review.engines.list']);

    await fixture.press(await fixture.getByRole('checkbox', { name: 'Codex' }));
    await fixture.press(await fixture.getByRole('checkbox', { name: 'Claude' }));
    await fixture.press(await fixture.getByRole('button', { name: 'Start review' }));
    await settle();

    expect(calls.map((call) => call.action)).toEqual([
      'review.engines.list',
      TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1,
      'session.open',
    ]);
    expect(calls[1]?.input).toMatchObject({
      v: 1,
      sessionId: 'session-review',
      engineIds: ['codex', 'claude'],
      instructions: PENDING.instructions,
      review: PENDING.review,
    });
  });

  it('focuses Retry after a list failure, recovers only that read, and opens the stable Session on Cancel', async () => {
    let reads = 0;
    const calls: string[] = [];
    const { fixture, focusedLabels } = await mountChooser(async (action) => {
      calls.push(action);
      if (action === 'session.open') return null;
      if (action !== 'review.engines.list') throw new Error(`Unexpected action ${action}`);
      reads += 1;
      if (reads === 1) throw new Error('temporarily unavailable');
      return {
        sessionId: 'session-review',
        items: [{ engineId: 'codex', label: 'Codex', enabled: true }],
      };
    });

    expect(focusedLabels.at(-1)).toBe('Try again');
    await fixture.press(await fixture.getByRole('button', { name: 'Try again' }));
    await settle();
    expect(reads).toBe(2);
    expect(focusedLabels.at(-1)).toBe('Codex');

    await fixture.press(await fixture.getByRole('button', { name: 'Cancel' }));
    await settle();
    expect(calls).toEqual(['review.engines.list', 'review.engines.list', 'session.open']);
    await expect(fixture.queryByRole('checkbox', { name: 'Codex' })).resolves.toBeUndefined();
  });

  /**
   * The canonical fan-out reports each engine independently inside one
   * successful Action, so "the review started" can be true of one engine and
   * false of another. Opening the Session as an unqualified success hid the
   * refused half; repeating the whole selection would start the successful half
   * twice.
   */
  it('keeps a partly started review visible and retries only the engines that did not start', async () => {
    const startRequests: unknown[] = [];
    const calls: string[] = [];
    const { fixture } = await mountChooser(async (action, input) => {
      calls.push(action);
      if (action === 'review.engines.list') {
        return {
          sessionId: 'session-review',
          items: [
            { engineId: 'codex', label: 'Codex', enabled: true },
            { engineId: 'claude', label: 'Claude', enabled: true },
          ],
        };
      }
      if (action === TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1) {
        startRequests.push(input);
        return startRequests.length === 1
          ? { v: 1, status: 'started', startedEngineIds: ['codex'], failedEngineIds: ['claude'] }
          : { v: 1, status: 'started', startedEngineIds: ['claude'], failedEngineIds: [] };
      }
      if (action === 'session.open') return null;
      throw new Error(`Unexpected action ${action}`);
    });

    await fixture.press(await fixture.getByRole('checkbox', { name: 'Codex' }));
    await fixture.press(await fixture.getByRole('checkbox', { name: 'Claude' }));
    await fixture.press(await fixture.getByRole('button', { name: 'Start review' }));
    await settle();

    // The Session is not opened as a clean success while an engine is missing.
    expect(calls).not.toContain('session.open');
    await expect(fixture.getByRole('button', { name: 'Try again' })).resolves.toBeDefined();

    await fixture.press(await fixture.getByRole('button', { name: 'Try again' }));
    await settle();

    expect(startRequests).toHaveLength(2);
    expect(startRequests[0]).toMatchObject({ engineIds: ['codex', 'claude'] });
    // The engine that IS running is never started a second time.
    expect(startRequests[1]).toMatchObject({ engineIds: ['claude'] });
    expect(calls.at(-1)).toBe('session.open');
  });

  it('never repeats an ambiguously settled review write and offers only the safe Session open', async () => {
    const calls: string[] = [];
    const { fixture, focusedLabels } = await mountChooser(async (action) => {
      calls.push(action);
      if (action === 'review.engines.list') {
        return {
          sessionId: 'session-review',
          items: [{ engineId: 'codex', label: 'Codex', enabled: true }],
        };
      }
      if (action === TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1) {
        throw new Error('outcome unknown');
      }
      if (action === 'session.open') return null;
      throw new Error(`Unexpected action ${action}`);
    });

    await fixture.press(await fixture.getByRole('checkbox', { name: 'Codex' }));
    await fixture.press(await fixture.getByRole('button', { name: 'Start review' }));
    await settle();
    expect(focusedLabels.at(-1)).toBe('Open session');
    await expect(fixture.queryByRole('button', { name: 'Cancel' })).resolves.toBeUndefined();

    await fixture.press(await fixture.getByRole('button', { name: 'Open session' }));
    await settle();
    expect(calls).toEqual([
      'review.engines.list',
      TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1,
      'session.open',
    ]);
  });

  it('offers one Session-open control after opening fails', async () => {
    const calls: string[] = [];
    let opens = 0;
    const { fixture } = await mountChooser(async (action) => {
      calls.push(action);
      if (action === 'review.engines.list') {
        return {
          sessionId: 'session-review',
          items: [{ engineId: 'codex', label: 'Codex', enabled: true }],
        };
      }
      if (action === TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1) {
        return { v: 1, status: 'started', startedEngineIds: ['codex'], failedEngineIds: [] };
      }
      if (action === 'session.open') {
        opens += 1;
        if (opens === 1) throw new Error('navigation unavailable');
        return null;
      }
      throw new Error(`Unexpected action ${action}`);
    });

    await fixture.press(await fixture.getByRole('checkbox', { name: 'Codex' }));
    await fixture.press(await fixture.getByRole('button', { name: 'Start review' }));
    await settle();

    await expect(fixture.getByRole('button', { name: 'Open session' })).resolves.toBeDefined();
    await expect(fixture.queryByRole('button', { name: 'Cancel' })).resolves.toBeUndefined();

    await fixture.press(await fixture.getByRole('button', { name: 'Open session' }));
    await settle();
    expect(calls).toEqual([
      'review.engines.list',
      TRIAGE_START_PULL_REQUEST_REVIEW_ACTION_LOCAL_ID_V1,
      'session.open',
      'session.open',
    ]);
  });
});
