import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ElectronDesktopFiles } from './desktopFiles';

test('uses native archive dialogs and reveals only an existing absolute output path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-electron-personal-home-files-'));
    const archive = join(root, 'backup.tar');
    writeFileSync(archive, 'archive');
    const calls: Array<readonly [string, unknown]> = [];
    const files = new ElectronDesktopFiles({
        pickFile: async (options) => {
            calls.push(['pick', options]);
            return archive;
        },
        saveFile: async (options) => {
            calls.push(['save', options]);
            return join(root, 'export.tar');
        },
        openPath: async () => '',
        revealPath: (path) => {
            calls.push(['reveal', path]);
        },
    });

    assert.equal(await files.pickPersonalHomeBackupArchive(), archive);
    assert.equal(await files.savePersonalHomeBackupArchive(), join(root, 'export.tar'));
    files.revealSystemTaskOutputPath(archive);
    assert.deepEqual(calls.map(([kind]) => kind), ['pick', 'save', 'reveal']);
    assert.throws(() => files.revealSystemTaskOutputPath('relative.tar'), /must be an absolute path/u);
    assert.throws(() => files.revealSystemTaskOutputPath(join(root, 'missing.tar')), /does not exist/u);

    rmSync(root, { recursive: true, force: true });
});
