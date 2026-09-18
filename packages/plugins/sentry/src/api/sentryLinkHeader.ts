/**
 * Sentry's cursor pagination is carried entirely by an RFC-style `Link` header.
 * `[DOC]` https://docs.sentry.io/api/pagination/ — cursors are returned for both
 * directions even when a page is empty, and the walk terminates when the
 * `rel="next"` relation carries `results="false"`.
 *
 * The absence of the header is reported as its own state: for the request shapes
 * this source builds, first-party Sentry always writes `Link`, so a missing one
 * means an intermediary rewrote the response — never that the walk finished.
 */

import { readTriageResponseHeaderV1 } from '@happier-dev/triage-protocol/v1';

/**
 * What the relation's `results` parameter states, kept as three values.
 *
 * `unknown` is the one that matters: a relation that states no indicator, or
 * one this source does not recognize, is metadata it cannot characterize — and
 * folding it into `false` is what made broken provider pagination look exactly
 * like a collection the provider itself declared exhausted.
 */
export type SentryLinkResultsV1 = 'true' | 'false' | 'unknown';

export type SentryLinkRelationV1 = Readonly<{
  url: string;
  /** The `cursor` link parameter, or the `cursor` query value of the URL. */
  cursor: string | null;
  /** `results="true"` — the provider says the pointed-at page has rows. */
  results: SentryLinkResultsV1;
}>;

export type SentryLinkHeaderV1 =
  | Readonly<{ present: false }>
  | Readonly<{
    present: true;
    next: SentryLinkRelationV1 | null;
    previous: SentryLinkRelationV1 | null;
  }>;

const LINK_ENTRY_PATTERN = /<([^>]*)>([^,<]*)/gu;
const LINK_PARAMETER_PATTERN = /;\s*([A-Za-z0-9_-]+)\s*=\s*("[^"]*"|[^;,\s]*)/gu;

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') && value.length >= 2
    ? value.slice(1, -1)
    : value;
}

function readCursorFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get('cursor');
  } catch {
    return null;
  }
}

function parseRelation(url: string, parameterText: string): {
  rel: string | null;
  relation: SentryLinkRelationV1;
} {
  let rel: string | null = null;
  let cursor: string | null = null;
  let results: string | null = null;

  LINK_PARAMETER_PATTERN.lastIndex = 0;
  for (
    let match = LINK_PARAMETER_PATTERN.exec(parameterText);
    match !== null;
    match = LINK_PARAMETER_PATTERN.exec(parameterText)
  ) {
    const key = match[1]?.toLowerCase() ?? '';
    const value = unquote(match[2] ?? '');
    if (key === 'rel') rel = value.toLowerCase();
    else if (key === 'cursor') cursor = value;
    else if (key === 'results') results = value.toLowerCase();
  }

  return {
    rel,
    relation: {
      url,
      cursor: cursor ?? readCursorFromUrl(url),
      results: results === 'true' || results === 'false' ? results : 'unknown',
    },
  };
}

export function parseSentryLinkHeader(
  headers: Readonly<Record<string, string>>,
): SentryLinkHeaderV1 {
  const raw = readTriageResponseHeaderV1(headers, 'link');
  if (raw === null) return Object.freeze({ present: false as const });

  let next: SentryLinkRelationV1 | null = null;
  let previous: SentryLinkRelationV1 | null = null;

  LINK_ENTRY_PATTERN.lastIndex = 0;
  for (
    let match = LINK_ENTRY_PATTERN.exec(raw);
    match !== null;
    match = LINK_ENTRY_PATTERN.exec(raw)
  ) {
    const { rel, relation } = parseRelation(match[1] ?? '', match[2] ?? '');
    if (rel === 'next' && next === null) next = Object.freeze(relation);
    else if (rel === 'previous' && previous === null) previous = Object.freeze(relation);
  }

  return Object.freeze({ present: true as const, next, previous });
}

/**
 * Where one paged Sentry walk stands after the response that carried this
 * header, and the single owner of that decision for every plane that walks
 * (`SENTRY.md` §3.3, §7.3a, §7.4).
 *
 * The four answers are four because they are different facts about the rows
 * just read:
 *
 * - `headerAbsent` — for the request shapes this source builds, first-party
 *   Sentry always writes `Link` (`[SOURCE]` `api/base.py` `add_cursor_headers`),
 *   so its absence means an intermediary rewrote the response;
 * - `unusable` — the header is there and its pagination metadata cannot be
 *   characterized: no readable relation, no `next` direction on a response
 *   `[DOC]` states carries both, an unstated or unrecognized `results`
 *   indicator, or results with no cursor to reach them;
 * - `exhausted` — the provider itself said `results="false"`, which is the ONE
 *   documented statement that the collection ended; and
 * - `next` — an ordinary continuation.
 *
 * Only `exhausted` may end a walk cleanly. The middle two end it short, and
 * every consumer keeps the rows it already read and says the walk stopped: a
 * truncated list presented as a complete one is the defect this separation
 * exists to prevent.
 */
export type SentryNextPageRelationV1 =
  | Readonly<{ kind: 'headerAbsent' }>
  | Readonly<{ kind: 'unusable' }>
  | Readonly<{ kind: 'exhausted' }>
  | Readonly<{ kind: 'next'; cursor: string; url: string }>;

const HEADER_ABSENT: SentryNextPageRelationV1 = Object.freeze({ kind: 'headerAbsent' as const });
const UNUSABLE: SentryNextPageRelationV1 = Object.freeze({ kind: 'unusable' as const });
const EXHAUSTED: SentryNextPageRelationV1 = Object.freeze({ kind: 'exhausted' as const });

export function readSentryNextPageRelation(
  headers: Readonly<Record<string, string>>,
): SentryNextPageRelationV1 {
  const link = parseSentryLinkHeader(headers);
  if (!link.present) return HEADER_ABSENT;
  const { next } = link;
  // `[DOC]` https://docs.sentry.io/api/pagination/ — a supported cursor response
  // carries both directions even when the page is empty. A response with no
  // `next` relation is therefore metadata this source cannot read, not the
  // provider stating the walk is over.
  if (next === null || next.results === 'unknown') return UNUSABLE;
  if (next.results === 'false') return EXHAUSTED;
  if (next.cursor === null || next.cursor === '') return UNUSABLE;
  return Object.freeze({ kind: 'next' as const, cursor: next.cursor, url: next.url });
}
