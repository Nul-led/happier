// @vitest-environment jsdom
import * as React from 'react';
import { act } from 'react';
import type { JsonValue } from '@happier-dev/plugin-sdk';
import { createPluginUiTestkit, createSurfaceContextFixture } from '@happier-dev/plugin-sdk/testing';
import type { PluginUiTestkit } from '@happier-dev/plugin-sdk/testing';
import { createPluginUiRnwSemanticSurfaceAdapter } from '@happier-dev/plugin-ui/testing';
import { createTriageSourceV1Fixture } from '@happier-dev/triage-protocol/testing/v1';
import { TriagePostMutationCompletionProvider } from '@happier-dev/triage-sources/ui';
import { afterEach, describe, expect, it } from 'vitest';

import { AZURE_DEVOPS_PLUGIN_ID } from '../../azureDevopsContracts.js';
import { AZURE_DEVOPS_TRIAGE_DETAIL_ACTION_IDS } from '../../triage/detailActions.js';

import { renderSurface } from '../renderSurface.js';

/**
 * What the Files walk owes a reader whose page did not arrive.
 *
 * The reducer keeps the rows already read and keeps the **Show more files**
 * control mounted and enabled beside the failure, so the panel is visibly
 * offering another attempt. Whether that attempt reaches Azure is decided by the
 * walk's own non-advancing guard, and the guard has to tell two positions apart:
 * one this walk consumed, which must never be read twice, and one that failed,
 * which was never read at all.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE = createTriageSourceV1Fixture();

const ITERATIONS_RESULT = {
  kind: 'iterations',
  rows: [{ id: 2, createdAtMs: 200, reason: 'push' }],
  currentIterationId: 2,
  omittedRowCount: 0,
  projectionTruncated: false,
} as unknown as JsonValue;

function changesPage(
  path: string,
  next: Readonly<{ nextSkip: number; nextTop: number }> | null,
): JsonValue {
  return {
    kind: 'iterationChanges',
    iterationId: 2,
    rows: [{ path, changeType: 'edit', isFolder: false }],
    omittedRowCount: 0,
    projectionTruncated: false,
    ...(next === null ? {} : next),
  } as unknown as JsonValue;
}

const PAGE_REFUSED = {
  kind: 'unavailable',
  failure: { class: 'transient', code: 'azure-devops/page-refused' },
} as unknown as JsonValue;

const changeInputs: unknown[] = [];
const mounted: PluginUiTestkit[] = [];
/** Successive answers for the iteration-changes walk, by request order. */
let changesAnswers: readonly JsonValue[] = [];

async function mountDetail(): Promise<PluginUiTestkit> {
  let fixture!: PluginUiTestkit;
  await act(async () => {
    fixture = await createPluginUiTestkit({
      identity: { instanceId: 'fixture-instance-161', mountNonce: 'fixture-mount-161' },
      authorPlugin: { id: AZURE_DEVOPS_PLUGIN_ID, version: '0.0.0' },
      surface: (context) => (
        <TriagePostMutationCompletionProvider onComplete={async () => {}}>
          {renderSurface(context)}
        </TriagePostMutationCompletionProvider>
      ),
      surfaceContext: createSurfaceContextFixture(),
      adapter: createPluginUiRnwSemanticSurfaceAdapter(),
      launchInput: FIXTURE.detailInput as unknown as JsonValue,
      handlers: {
        executeAction: async ({ action, input }) => {
          const localId = (action as Readonly<{ localId?: string }>).localId ?? '';
          if (localId === AZURE_DEVOPS_TRIAGE_DETAIL_ACTION_IDS.readIterations) {
            return ITERATIONS_RESULT;
          }
          if (localId === AZURE_DEVOPS_TRIAGE_DETAIL_ACTION_IDS.listIterationChanges) {
            const index = changeInputs.length;
            changeInputs.push(input);
            return changesAnswers[index] ?? changesPage('/src/tail.ts', null);
          }
          return { kind: 'unavailable', failure: { class: 'transient', code: 'unused' } } as JsonValue;
        },
      },
    });
  });
  mounted.push(fixture);
  return fixture;
}

async function openFiles(detail: PluginUiTestkit): Promise<void> {
  await act(async () => {
    await detail.press(await detail.getByRole('tab', { name: 'Files' }));
  });
}

async function pressShowMore(detail: PluginUiTestkit): Promise<void> {
  await act(async () => {
    await detail.press(await detail.getByRole('button', { name: 'Show more files' }));
  });
}

afterEach(async () => {
  changeInputs.splice(0);
  changesAnswers = [];
  for (const fixture of mounted.splice(0)) await fixture.dispose();
});

describe('the mounted Azure DevOps Files walk after a refused page', () => {
  it('asks Azure again for the position it refused', async () => {
    changesAnswers = [
      changesPage('/src/first.ts', { nextSkip: 30, nextTop: 30 }),
      PAGE_REFUSED,
      changesPage('/src/second.ts', null),
    ];
    const detail = await mountDetail();
    await openFiles(detail);
    await expect(detail.getByText('/src/first.ts')).resolves.toBeDefined();

    await pressShowMore(detail);
    // Kept, not blanked: the failure sits beside the file already read.
    await expect(detail.getByText('/src/first.ts')).resolves.toBeDefined();
    expect(changeInputs).toHaveLength(2);

    await pressShowMore(detail);

    // The refused position was never read, so the reader's second press must
    // reach it rather than being swallowed by the non-advancing guard.
    expect(changeInputs).toHaveLength(3);
    expect(changeInputs[2]).toMatchObject({ iterationId: 2, skip: 30, top: 30 });
    await expect(detail.getByText('/src/second.ts')).resolves.toBeDefined();
  });

  it('still stops a position Azure served once and then advertised again', async () => {
    changesAnswers = [
      changesPage('/src/first.ts', { nextSkip: 30, nextTop: 30 }),
      changesPage('/src/second.ts', { nextSkip: 30, nextTop: 30 }),
    ];
    const detail = await mountDetail();
    await openFiles(detail);
    await pressShowMore(detail);

    await expect(detail.getByText('/src/second.ts')).resolves.toBeDefined();
    expect(changeInputs).toHaveLength(2);
    // That position DID answer. Re-following it is the loop the walk refuses,
    // and releasing failed positions must not release a consumed one: the walk
    // ends here instead of offering the control again.
    await expect(detail.queryByRole('button', { name: 'Show more files' }))
      .resolves.toBeUndefined();
  });
});
