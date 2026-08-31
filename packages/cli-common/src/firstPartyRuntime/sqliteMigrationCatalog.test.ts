import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readSqliteMigrationCatalog } from './sqliteMigrationCatalog.js';

describe('SQLite migration catalog', () => {
    it('reads non-empty migration SQL with SHA-256 checksums in canonical directory order', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-sqlite-catalog-'));
        await mkdir(join(root, 'z-last'), { recursive: true });
        await mkdir(join(root, 'a-first'), { recursive: true });
        await writeFile(join(root, 'z-last', 'migration.sql'), 'SELECT 2;\n');
        await writeFile(join(root, 'a-first', 'migration.sql'), 'SELECT 1;\n');

        const catalog = await readSqliteMigrationCatalog(root);

        expect(catalog.map((entry) => entry.name)).toEqual(['a-first', 'z-last']);
        expect(catalog[0]).toEqual({
            name: 'a-first',
            sql: 'SELECT 1;\n',
            checksum: 'b4e0497804e46e0a0b0b8c31975b062152d551bac49c3c2e80932567b4085dcd',
        });
    });

    it('rejects missing and empty migration SQL', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-sqlite-catalog-invalid-'));
        await mkdir(join(root, 'missing'), { recursive: true });
        await expect(readSqliteMigrationCatalog(root)).rejects.toThrow(/missing migration\.sql/i);
        await writeFile(join(root, 'missing', 'migration.sql'), '  \n');
        await expect(readSqliteMigrationCatalog(root)).rejects.toThrow(/empty migration\.sql/i);
    });
});
