// @vitest-environment jsdom
import * as React from 'react';
import {
  createPluginUiTestkit,
  createSurfaceContextFixture,
  type PluginUiTestkit,
} from '@happier-dev/plugin-sdk/testing';
import { defineUiSurface } from '@happier-dev/plugin-ui';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { testkitEntryRef } from '../../corpus/testkit/observations.test-support.js';
import type { TriageActionV1 } from '../../settings/actions.js';
import {
  readTriagePrimaryActionIdV1,
  TriageEntryActionControls,
  type TriageEntryActionRequestV1,
} from './entryActionControls.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: PluginUiTestkit[] = [];

afterEach(async () => {
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

function formalAction(actionId: string, label: string): TriageActionV1 {
  return Object.freeze({
    actionId,
    label,
    enabled: true,
    appliesTo: ['pullRequest'],
    profileId: null,
    workspaceMode: 'pull_request',
    target: {
      kind: 'reviewStart',
      promptInvocationId: null,
      seededFallbackInstruction: 'Review this change.',
    },
  });
}

describe('the mounted configured entry action controls', () => {
  it('dispatches the exact formal review action that was pressed', async () => {
    const requests: TriageEntryActionRequestV1[] = [];
    const actions = [
      formalAction('formal-review-one', 'Security review'),
      formalAction('formal-review-two', 'Architecture review'),
    ];
    const surface = defineUiSurface(() => (
      <TriageEntryActionControls
        target={{
          kind: 'entry',
          sectionId: 'open',
          entryRef: testkitEntryRef({ entryId: '17', kindId: 'pull-request' }),
          sourceInstanceId: '11111111-1111-4111-8111-111111111111',
        }}
        actions={actions}
        workflowSubject="pullRequest"
        preparesReviewWorkspace
        onAction={(request) => { requests.push(request); }}
      />
    ));
    const fixture = await createPluginUiTestkit({
      identity: { instanceId: 'fixture-instance-192', mountNonce: 'fixture-mount-192' },
      authorPlugin: { id: 'happier.triage', version: '0.0.0' },
      surface,
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
    });
    mounted.push(fixture);

    await fixture.press(await fixture.getByRole('button', { name: 'Security review' }));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.action.actionId).toBe('formal-review-one');

    await fixture.press(await fixture.getByRole('button', { name: 'Architecture review' }));
    expect(requests).toHaveLength(2);
    expect(requests[1]?.action.actionId).toBe('formal-review-two');
  });

  it('says why a press started nothing instead of doing nothing', async () => {
    const surface = defineUiSurface(() => (
      <TriageEntryActionControls
        target={{
          kind: 'entry',
          sectionId: 'open',
          entryRef: testkitEntryRef({ entryId: '17', kindId: 'pull-request' }),
          sourceInstanceId: '11111111-1111-4111-8111-111111111111',
        }}
        actions={[formalAction('formal-review-one', 'Security review')]}
        workflowSubject="pullRequest"
        preparesReviewWorkspace
        // The catalog changed between render and press: the action is gone.
        onAction={async () => ({ kind: 'missing' as const })}
      />
    ));
    const fixture = await createPluginUiTestkit({
      identity: { instanceId: 'fixture-instance-refused', mountNonce: 'fixture-mount-refused' },
      authorPlugin: { id: 'happier.triage', version: '0.0.0' },
      surface,
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
    });
    mounted.push(fixture);

    await fixture.press(await fixture.getByRole('button', { name: 'Security review' }));
    await expect(fixture.getByText('That action is no longer available for this entry.'))
      .resolves.toBeDefined();
  });
});

describe('the one primary entry action', () => {
  it('is the first action a reader can press, in catalog order', () => {
    const security = formalAction('formal-review-one', 'Security review');
    const architecture = formalAction('formal-review-two', 'Architecture review');
    const ask = Object.freeze({ ...security, actionId: 'ask', label: 'Ask', workspaceMode: 'reference_only' as const });

    expect(readTriagePrimaryActionIdV1([security, architecture], true)).toBe('formal-review-one');
    // A blocked action is never the primary one; the next pressable action is.
    expect(readTriagePrimaryActionIdV1([security, ask], false)).toBe('ask');
    expect(readTriagePrimaryActionIdV1([security, architecture], false)).toBeNull();
    expect(readTriagePrimaryActionIdV1([], true)).toBeNull();
  });
});

