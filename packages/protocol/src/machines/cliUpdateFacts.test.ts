import { describe, expect, it } from 'vitest';

import { CliUpdateFactsSchema, CliUpdateLastResultSchema } from './index.js';

const facts = {
  currentVersion: '0.3.1',
  latestVersion: '0.3.2',
  channel: 'stable',
  installSource: 'managed',
  updateCommand: 'happier self update',
  canUpdateRemotely: true,
  lastUpdate: { targetVersion: '0.3.1', outcome: 'rolledBack', at: 1_700_000_000_000, message: 'restored 0.3.0' },
} as const;

describe('CliUpdateFactsSchema (K5, additive-open/drop read projection)', () => {
  it('accepts a machine\'s published update facts and drops properties a newer writer added', () => {
    const parsed = CliUpdateFactsSchema.parse({ ...facts, futureField: 1, lastUpdate: { ...facts.lastUpdate, extra: true } });
    expect(parsed).toEqual(facts);
  });

  it('keeps known fields strict: an unknown outcome or install source does not parse', () => {
    expect(CliUpdateLastResultSchema.safeParse({ ...facts.lastUpdate, outcome: 'maybe' }).success).toBe(false);
    expect(CliUpdateFactsSchema.safeParse({ ...facts, installSource: 'snap' }).success).toBe(false);
    expect(CliUpdateFactsSchema.safeParse({ ...facts, currentVersion: '' }).success).toBe(false);
  });

  it('lets only a failed attempt lack a target version (the release could not be resolved)', () => {
    expect(CliUpdateLastResultSchema.safeParse({ targetVersion: null, outcome: 'failed', at: 1, message: 'offline' }).success).toBe(true);
    expect(CliUpdateLastResultSchema.safeParse({ targetVersion: null, outcome: 'rolledBack', at: 1, message: null }).success).toBe(false);
  });
});
