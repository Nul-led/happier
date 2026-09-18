import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

describe('server first-party runtime dependency boundary', () => {
    it('loads under the Bun runtime without evaluating Node-only SQLite owners', () => {
        const bunVersion = spawnSync('bun', ['--version'], { encoding: 'utf8' });
        if (bunVersion.error && 'code' in bunVersion.error && bunVersion.error.code === 'ENOENT') return;
        expect(bunVersion.status, bunVersion.stderr).toBe(0);

        const surfacePath = resolve(currentDir, 'serverRuntime.ts');
        const result = spawnSync(
            'bun',
            ['--eval', `await import(${JSON.stringify(surfacePath)});`],
            { encoding: 'utf8', timeout: 120_000 },
        );

        expect(result.status, result.stderr || result.stdout).toBe(0);
    });
});
