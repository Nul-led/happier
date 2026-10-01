import { describe, expect, it } from 'vitest';
import * as inventory from './index.js';

describe('machine local-service summary', () => {
  it('reads absent or malformed daemon projections as unknown, not an authoritative zero', () => {
    expect(inventory.readLocalServiceMachineSummaryV1).toBeTypeOf('function');
    const ready = { v: 1, state: 'ready', runningCount: 0 };
    expect(inventory.readLocalServiceMachineSummaryV1({ localServices: ready })).toBe(ready);
    for (const daemonState of [undefined, {}, { localServices: { v: 1, state: 'ready' } }, { localServices: { v: 1, state: 'error', runningCount: 0 } }, { localServices: { v: 1, state: 'ready', runningCount: -1 } }]) {
      expect(inventory.readLocalServiceMachineSummaryV1(daemonState)).toEqual({ v: 1, state: 'unknown' });
    }
  });

});
