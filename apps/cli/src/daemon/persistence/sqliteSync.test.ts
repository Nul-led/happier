import { describe, expect, it } from 'vitest';

import {
  openSqliteDatabaseSync,
  resolveSqliteSupportedValueBatchSize,
} from './sqliteSync';

describe('sqliteSync', () => {
  it('derives value batches from the supported bind boundary and the actual query shape', () => {
    expect(resolveSqliteSupportedValueBatchSize({
      // A max-length unspaced-script query can approach two terms per input
      // character; it must still leave room for an eligibility batch.
      fixedParameterCount: 2_049,
      parametersPerValue: 1,
    })).toBe(30_717);
    expect(() => resolveSqliteSupportedValueBatchSize({
      fixedParameterCount: 32_766,
      parametersPerValue: 1,
    })).toThrow('query shape exceeds');
  });

  it('opens a daemon-owned SQLite database through the neutral persistence owner', () => {
    const db = openSqliteDatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE records (value TEXT NOT NULL)');
      db.prepare('INSERT INTO records (value) VALUES (?)').run('persisted');

      expect(db.prepare('SELECT value FROM records').get()).toEqual({ value: 'persisted' });
    } finally {
      db.close();
    }
  });
});
