import { describe, expect, it } from 'vitest';

/**
 * A consumer-side load of the protocol root.
 *
 * The CLI, UI and server all import `@happier-dev/protocol` by package
 * specifier, which resolves differently from a relative path inside the package
 * and therefore exercises a different module-initialization order. That order
 * has broken before: the barrel re-exports the Action id registry while the
 * feature/capability graph imports it back, and when the two interleave the
 * package fails to load with an `undefined` TypeError far from the real cause.
 *
 * Narrowing an individual import to a subpath removes a symptom without proving
 * the barrel loads, so this check deliberately enters the way production code
 * does and asserts the symbols on both sides of that cycle risk are live.
 */
describe('protocol root import from a consumer package', () => {
  it('initializes the Action registry and the capability graph that imports it back', async () => {
    const protocol = await import('@happier-dev/protocol');

    expect(protocol.ActionIdSchema.safeParse('home.governance.get').success).toBe(true);
    expect(protocol.RuntimeActionIdV1Schema.safeParse('browser.navigate').success).toBe(true);
    expect(protocol.getActionSpec('teams.archive').serverTransport)
      .toEqual({ method: 'POST', path: '/v1/teams/archive' });
  }, 60_000);
});
