import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonValue, PluginCancellationOptions } from '@happier-dev/plugin-sdk';
import { usePluginHostApi } from '@happier-dev/plugin-ui';
import type {
  TriageEntryPresentationStateV1,
  TriageEntryRefV1,
  TriageSourceWorkflowSubjectV1,
} from '@happier-dev/triage-protocol/v1';

import { readTriageFixPullRequests, setTriageFixPullRequest } from '../../actions/fixPullRequests.js';
import {
  TRIAGE_READ_FIX_PULL_REQUESTS_ACTION_LOCAL_ID_V1,
  TRIAGE_SET_FIX_PULL_REQUEST_ACTION_LOCAL_ID_V1,
  TriageReadFixPullRequestsResultV1Schema,
  TriageSetFixPullRequestResultV1Schema,
  type TriageReadFixPullRequestsResultV1,
  type TriageSetFixPullRequestInputV1,
  type TriageSetFixPullRequestResultV1,
} from '../../actions/fixPullRequestsProtocol.js';
import type { CorpusCollectionsV1 } from '../../corpus/collections/bindCorpusCollections.js';
import {
  resolveFixPullRequests,
  type TriageFixPullRequestV1,
} from '../../corpus/marks/fixPullRequests.js';
import { useTriageDurableAccount } from '../durable/accountDurableState.js';
import { sameTriageEntryRefV1 } from '../state/surface.js';

/**
 * The selected issue or error group's fix pull requests (`design/FIX-LINK.md`).
 *
 * It holds the authoritative answer and nothing else, like the pins hook: no
 * optimistic flip and no queue. A link or unlink shows once the write settled
 * and the read changed. There is no change feed — the corpus deliberately has
 * none — so the answer refreshes on selection, after this mount's own writes,
 * and on `retry`.
 *
 * The storage read is transport-neutral; which co-linked entry is a pull
 * request and whether it is open, merged or closed come from the caller's
 * admitted descriptors and device projection, through the one pure resolver.
 */

type Display = Readonly<{ title: string; scopeLabel: string }>;

export type TriageFixPullRequestsInputV1 = Readonly<{
  entryRef: TriageEntryRefV1;
  /** The issue's own display pair: a first fix-PR choice creates its mark row. */
  display: Display;
  workflowSubjectOf(entryRef: TriageEntryRefV1): TriageSourceWorkflowSubjectV1 | null;
  presentationOf(entryRef: TriageEntryRefV1): TriageEntryPresentationStateV1 | null;
}>;

export type TriageFixPullRequestsStateV1 =
  | Readonly<{ kind: 'reading' }>
  | Readonly<{ kind: 'unreachable'; retry(): void }>
  | Readonly<{
    kind: 'ready';
    candidates: readonly TriageFixPullRequestV1[];
    primary: TriageFixPullRequestV1 | null;
    incomplete: boolean;
    busy: boolean;
    /** The last write was refused as a conflict or a full list; `null` otherwise. */
    refusal: 'conflict' | 'full' | 'failed' | null;
    link(pullRequest: Readonly<{ entryRef: TriageEntryRefV1; display: Display }>): void;
    unlink(entryRef: TriageEntryRefV1): void;
  }>;

type FixHostV1 = Readonly<{
  executeAction(action: string, input: JsonValue, options?: PluginCancellationOptions): Promise<unknown>;
}>;

export type TriageFixPullRequestsTransportV1 = Readonly<{
  read(entryRef: TriageEntryRefV1, options?: PluginCancellationOptions): Promise<TriageReadFixPullRequestsResultV1>;
  write(input: TriageSetFixPullRequestInputV1, options?: PluginCancellationOptions): Promise<TriageSetFixPullRequestResultV1>;
}>;

export function createDirectTriageFixPullRequestsTransport(
  collections: Pick<CorpusCollectionsV1, 'userMarks' | 'sessionLinks'>,
  nowMs: () => number = () => Date.now(),
): TriageFixPullRequestsTransportV1 {
  const deps = (options?: PluginCancellationOptions) => ({
    collections,
    nowMs,
    ...(options?.signal ? { signal: options.signal } : {}),
  });
  return Object.freeze({
    read: async (entryRef, options) => await readTriageFixPullRequests({ v: 1, entryRef }, deps(options)),
    write: async (input, options) => await setTriageFixPullRequest(input, deps(options)),
  });
}

export function createActionTriageFixPullRequestsTransport(host: FixHostV1): TriageFixPullRequestsTransportV1 {
  return Object.freeze({
    async read(entryRef, options) {
      return TriageReadFixPullRequestsResultV1Schema.parse(await host.executeAction(
        TRIAGE_READ_FIX_PULL_REQUESTS_ACTION_LOCAL_ID_V1,
        { v: 1, entryRef } as unknown as JsonValue,
        options,
      ));
    },
    async write(input, options) {
      return TriageSetFixPullRequestResultV1Schema.parse(await host.executeAction(
        TRIAGE_SET_FIX_PULL_REQUEST_ACTION_LOCAL_ID_V1,
        input as unknown as JsonValue,
        options,
      ));
    },
  });
}

type Settled =
  | Readonly<{ kind: 'reading' }>
  | Readonly<{ kind: 'unreachable' }>
  | Readonly<{ kind: 'read'; entryRef: TriageEntryRefV1; sources: TriageReadFixPullRequestsResultV1 }>;

export function useTriageFixPullRequests(
  input: TriageFixPullRequestsInputV1 | null,
): TriageFixPullRequestsStateV1 | null {
  const hostApi = usePluginHostApi();
  const durable = useTriageDurableAccount();
  const transport = useMemo<TriageFixPullRequestsTransportV1>(
    () => durable.collections === null
      ? createActionTriageFixPullRequestsTransport(hostApi)
      : createDirectTriageFixPullRequestsTransport(durable.collections),
    [durable.collections, hostApi],
  );
  const [settled, setSettled] = useState<Settled>({ kind: 'reading' });
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<'conflict' | 'full' | 'failed' | null>(null);
  const [readGeneration, setReadGeneration] = useState(0);
  const generation = useRef(0);

  // Reads key on the reference's value, so a caller that rebuilds an equal
  // reference each render does not re-read.
  const entryKey = input === null ? null : JSON.stringify([
    input.entryRef.source.pluginId,
    input.entryRef.source.localId,
    input.entryRef.kindId,
    input.entryRef.collisionScope,
    input.entryRef.entryId,
  ]);
  const entryRefRef = useRef<TriageEntryRefV1 | undefined>(undefined);
  entryRefRef.current = input?.entryRef;
  const entryRef = input?.entryRef;
  const display = input?.display;
  const workflowSubjectOf = input?.workflowSubjectOf;
  const presentationOf = input?.presentationOf;

  useEffect(() => {
    const entryRef = entryRefRef.current;
    if (entryKey === null || entryRef === undefined) return undefined;
    generation.current += 1;
    const current = generation.current;
    const controller = new AbortController();
    setSettled((previous) => (
      previous.kind === 'read' && sameTriageEntryRefV1(previous.entryRef, entryRef) ? previous : { kind: 'reading' }
    ));
    void (async () => {
      let next: Settled;
      try {
        next = { kind: 'read', entryRef, sources: await transport.read(entryRef, { signal: controller.signal }) };
      } catch {
        next = { kind: 'unreachable' };
      }
      if (controller.signal.aborted || current !== generation.current) return;
      setSettled(next);
    })();
    return () => controller.abort();
  }, [entryKey, readGeneration, transport]);

  const write = useCallback((intent: TriageSetFixPullRequestInputV1): void => {
    setBusy(true);
    setRefusal(null);
    void (async () => {
      try {
        const result = await transport.write(intent);
        if (result.status === 'conflict' || result.status === 'full') setRefusal(result.status);
      } catch {
        setRefusal('failed');
      } finally {
        setBusy(false);
        setReadGeneration((value) => value + 1);
      }
    })();
  }, [transport]);

  const retry = useCallback(() => setReadGeneration((value) => value + 1), []);

  return useMemo(() => {
    if (entryRef === undefined || display === undefined
      || workflowSubjectOf === undefined || presentationOf === undefined) return null;
    if (settled.kind === 'unreachable') return { kind: 'unreachable', retry };
    if (settled.kind !== 'read' || !sameTriageEntryRefV1(settled.entryRef, entryRef)) return { kind: 'reading' };
    const resolved = resolveFixPullRequests(settled.sources, { workflowSubjectOf, presentationOf });
    return {
      kind: 'ready',
      candidates: resolved.candidates,
      primary: resolved.primary,
      incomplete: resolved.incomplete,
      busy,
      refusal,
      link: (pullRequest) => write({
        v: 1,
        linked: true,
        entryRef,
        displayAtMark: display,
        fixPullRequest: pullRequest.entryRef,
        displayAtLink: pullRequest.display,
      }),
      unlink: (fixPullRequest) => write({ v: 1, linked: false, entryRef, displayAtMark: display, fixPullRequest }),
    };
  }, [busy, display, entryRef, presentationOf, refusal, retry, settled, workflowSubjectOf, write]);
}
