// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import { createPluginUiTestkit, createSurfaceContextFixture } from '@happier-dev/plugin-sdk/testing';
import type { PluginUiTestkit } from '@happier-dev/plugin-sdk/testing';
import type { RenderContext, SessionStateV1 } from '@happier-dev/plugin-sdk/ui';
import { defineUiSurface, useSessionState } from '@happier-dev/plugin-ui';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { TriageAgentStep, TriagePermissionCard } from './storyRail.js';

/**
 * The story rail's live agent half (r0.42): the permission card above the rail
 * and ③ the agent step, both read from the host's canonical Session state and
 * answered through the host's one permission owner.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION: SessionStateV1 = {
  sessionId: 'session-a',
  lifecycle: 'active',
  runtime: 'waiting',
  operational: 'permission_required',
  workspace: { worktreeName: 'fix/2476-checks' },
  pendingPermissions: [{
    requestId: 'request-1',
    toolName: 'Bash',
    summary: 'Run the end-to-end suite',
    command: 'pnpm test:e2e --project=webkit',
    answers: ['allowOnce', 'allowForSession', 'deny'],
  }],
} as SessionStateV1;

const answers: unknown[] = [];

const renderRail = defineUiSurface(function Rail(_context: RenderContext): React.ReactElement {
  const live = useSessionState('session-a');
  return (
    <>
      {live.state?.pendingPermissions.map((request) => (
        <TriagePermissionCard key={request.requestId} sessionId="session-a" sessionTitle="Codex" request={request} />
      ))}
      <TriageAgentStep
        sessions={[{ sessionId: 'session-a', displayTitle: 'Codex' }]}
        hasMore={false}
        live={live}
        reviewEntry={{ kind: 'pullRequest', url: 'https://example.test/pull/1' }}
      />
    </>
  );
});

const mounted: PluginUiTestkit[] = [];
afterEach(async () => {
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

async function mountRail(): Promise<PluginUiTestkit> {
  answers.length = 0;
  let fixture!: PluginUiTestkit;
  await act(async () => {
    fixture = await createPluginUiTestkit({
      identity: { instanceId: 'fixture-instance-story-rail', mountNonce: 'fixture-mount-story-rail' },
      authorPlugin: { id: 'happier.triage', version: '0.0.0' },
      surface: renderRail,
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
      handlers: {
        readSession: () => SESSION,
        watchSession: () => undefined,
        respondToSessionPermission: (input) => {
          answers.push(input.request);
          return { status: 'answered' };
        },
        executeAction: async () => ({ comments: [] }),
      },
    });
  });
  mounted.push(fixture);
  return fixture;
}

describe('the story rail\'s live agent', () => {
  it('shows a waiting permission above the rail and answers it through the host owner', async () => {
    const rail = await mountRail();

    const allowOnce = await rail.findByRole('button', { name: 'Allow once' });
    await expect(rail.getByText('Codex wants to run Bash')).resolves.toBeDefined();
    await expect(rail.getByText('pnpm test:e2e --project=webkit')).resolves.toBeDefined();
    await act(async () => {
      await rail.press(allowOnce);
    });

    expect(answers).toEqual([
      expect.objectContaining({ sessionId: 'session-a', requestId: 'request-1', answer: 'allowOnce' }),
    ]);
  });

  it('states the agent\'s live status and where it works in ③', async () => {
    const rail = await mountRail();

    await rail.findByRole('button', { name: 'Allow once' });
    await expect(rail.getByText('Needs your permission')).resolves.toBeDefined();
    await expect(rail.getByText('fix/2476-checks')).resolves.toBeDefined();
    await expect(rail.getByText('Agent work')).resolves.toBeDefined();
  });
});
