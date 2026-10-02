import { describe, expect, it } from 'vitest';

import * as fs from './index.public.js';

describe('native SQLite filesystem seam', () => {
    it('opens independent databases and preserves bound values through the runtime-selected provider', () => {
        expect(fs.openSqliteDatabaseSync).toBeTypeOf('function');
        const first = fs.openSqliteDatabaseSync(':memory:');
        const second = fs.openSqliteDatabaseSync(':memory:');
        try {
            for (const db of [first, second]) db.exec('CREATE TABLE records (value TEXT NOT NULL)');
            first.prepare('INSERT INTO records (value) VALUES (?)').run('a\0b');
            expect(first.prepare('SELECT value FROM records').get()).toEqual({ value: 'a\0b' });
            expect(second.prepare('SELECT value FROM records').all()).toEqual([]);
        } finally {
            first.close();
            second.close();
        }
    });
});
