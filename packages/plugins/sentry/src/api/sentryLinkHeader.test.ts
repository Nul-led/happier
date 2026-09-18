import { describe, expect, it } from 'vitest';

import issuesListPage1 from '../fixtures/issuesListPage1.json' with { type: 'json' };
import issuesListPage2 from '../fixtures/issuesListPage2.json' with { type: 'json' };
import issuesListNoLinkHeader from '../fixtures/issuesListNoLinkHeader.json' with { type: 'json' };

import { parseSentryLinkHeader, readSentryNextPageRelation } from './sentryLinkHeader.js';

describe('parseSentryLinkHeader', () => {
  it('reads the recorded rel="next" cursor and results flag from a real page response', () => {
    const parsed = parseSentryLinkHeader(issuesListPage1.headers);

    expect(parsed.present).toBe(true);
    if (!parsed.present) return;
    expect(parsed.next).toEqual({
      url: 'https://us.sentry.io/api/0/organizations/7701/issues/?&cursor=1754000000000%3A0%3A0',
      cursor: '1754000000000:0:0',
      results: 'true',
    });
    expect(parsed.previous?.results).toBe('false');
  });

  it('reports the terminal page as rel="next" with results="false" rather than an absent next', () => {
    const parsed = parseSentryLinkHeader(issuesListPage2.headers);

    expect(parsed.present).toBe(true);
    if (!parsed.present) return;
    expect(parsed.next?.results).toBe('false');
    expect(parsed.next?.cursor).toBe('1753000000000:0:0');
  });

  /**
   * A relation that states no `results` indicator is not the provider stating
   * "false". Reading it as `false` is how broken pagination metadata became
   * indistinguishable from an explicitly exhausted walk.
   */
  it('keeps a missing or unrecognized results indicator apart from an explicit false', () => {
    const missing = parseSentryLinkHeader({ link: '<https://us.sentry.io/x?cursor=a>; rel="next"' });
    expect(missing.present).toBe(true);
    if (!missing.present) return;
    expect(missing.next?.results).toBe('unknown');

    const unrecognized = parseSentryLinkHeader({
      link: '<https://us.sentry.io/x?cursor=a>; rel="next"; results="maybe"',
    });
    expect(unrecognized.present).toBe(true);
    if (!unrecognized.present) return;
    expect(unrecognized.next?.results).toBe('unknown');
  });

  it('distinguishes an absent Link header from a present header with no next relation', () => {
    expect(parseSentryLinkHeader(issuesListNoLinkHeader.headers)).toEqual({ present: false });
    expect(parseSentryLinkHeader({ Link: '<https://us.sentry.io/x>; rel="previous"; results="false"' }))
      .toEqual({
        present: true,
        next: null,
        previous: { url: 'https://us.sentry.io/x', cursor: null, results: 'false' },
      });
  });

  it('matches the header name case-insensitively', () => {
    const parsed = parseSentryLinkHeader({
      LINK: '<https://us.sentry.io/api/0/organizations/7701/issues/?&cursor=abc%3A0%3A0>; rel="next"; results="true"',
    });

    expect(parsed.present).toBe(true);
    if (!parsed.present) return;
    expect(parsed.next?.cursor).toBe('abc:0:0');
  });

  it('recovers the cursor from the URL query when the link parameter is absent', () => {
    const parsed = parseSentryLinkHeader({
      link: '<https://us.sentry.io/api/0/organizations/7701/issues/?limit=100&cursor=1700000000000%3A25%3A0>; rel="next"; results="true"',
    });

    expect(parsed.present).toBe(true);
    if (!parsed.present) return;
    expect(parsed.next?.cursor).toBe('1700000000000:25:0');
  });

  it('reads a present-but-empty Link header as absent, never as a finished collection', () => {
    // A `Link:` with no value states nothing. Reading it as present makes `next === null`,
    // which the scan and detail walks both read as "the provider says the collection ended".
    expect(parseSentryLinkHeader({ Link: '' })).toEqual({ present: false });
    expect(parseSentryLinkHeader({ link: '   ' })).toEqual({ present: false });
  });

  it('treats a syntactically unusable Link value as present with no usable relation', () => {
    expect(parseSentryLinkHeader({ link: 'not-a-link-header' })).toEqual({
      present: true,
      next: null,
      previous: null,
    });
  });
});

/**
 * The one decision every paged Sentry walk makes about its own next page.
 *
 * Four answers, and the reason they are four: an absent header, unreadable
 * pagination metadata, an explicitly exhausted collection and an ordinary
 * continuation are different facts about whether the rows just read are all of
 * them. Collapsing the middle two — which is what reading a missing `results`
 * indicator as `results="false"` does — lets broken or rewritten provider
 * pagination be reported as a clean finished walk.
 */
describe('readSentryNextPageRelation', () => {
  it('reads an ordinary continuation from a real page response', () => {
    expect(readSentryNextPageRelation(issuesListPage1.headers)).toEqual({
      kind: 'next',
      cursor: '1754000000000:0:0',
      url: 'https://us.sentry.io/api/0/organizations/7701/issues/?&cursor=1754000000000%3A0%3A0',
    });
  });

  it('reports exhaustion only when the provider itself said results="false"', () => {
    expect(readSentryNextPageRelation(issuesListPage2.headers)).toEqual({ kind: 'exhausted' });
  });

  it('reports an absent header as its own answer, never as a finished walk', () => {
    expect(readSentryNextPageRelation(issuesListNoLinkHeader.headers))
      .toEqual({ kind: 'headerAbsent' });
  });

  it('refuses to read unusable pagination metadata as an exhausted collection', () => {
    for (const link of [
      // A value carrying no readable relation at all.
      'not a link',
      // Sentry states BOTH directions on a cursor-paginated response, so a
      // header with only `previous` is metadata this source cannot characterize.
      '<https://us.sentry.io/x?cursor=a>; rel="previous"; results="false"',
      // A next relation that states no results indicator.
      '<https://us.sentry.io/x?cursor=a>; rel="next"',
      // A next relation whose indicator is neither true nor false.
      '<https://us.sentry.io/x?cursor=a>; rel="next"; results="maybe"',
      // The provider says there are results and offers no cursor to reach them.
      '<https://us.sentry.io/x>; rel="next"; results="true"',
    ]) {
      expect(readSentryNextPageRelation({ link }), link).toEqual({ kind: 'unusable' });
    }
  });
});
