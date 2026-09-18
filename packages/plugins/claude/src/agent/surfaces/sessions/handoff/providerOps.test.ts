import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { claudeHandoffSurface } from './providerOps.js';

const roots: string[] = [];

// The surface reads `process.env` directly, so the invocation context only has to
// carry the cancellation facts the host supplies at operation time.
function invocation() {
    return {
        signal: new AbortController().signal,
        deadlineAtMs: Date.now() + 30_000,
        maxSerializedBytes: 1024 * 1024,
    };
}

describe('claudeHandoffSurface', () => {
    afterEach(async () => {
        await Promise.all(roots.splice(0).map(async (root) => {
            await rm(root, { recursive: true, force: true });
        }));
    });

    it('reports handoff unavailable for a blank vendor session id', () => {
        expect(claudeHandoffSurface.evaluateAvailability?.(
            { operation: 'exportBundle', sessionId: '   \n ' },
            invocation(),
        )).toEqual({ available: false, reasonCode: 'missing_metadata' });
    });

    it('exports the transcript that belongs to the vendor session id, byte for byte', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-claude-handoff-exact-id-'));
        roots.push(root);
        const configDir = join(root, '.claude');
        const projectId = '-work-demo';
        await mkdir(join(configDir, 'projects', projectId), { recursive: true });
        await writeFile(
            join(configDir, 'projects', projectId, 'padded-session.jsonl'),
            '{"type":"user"}\n',
            'utf8',
        );
        // The linked source carries the config dir, so this stays off the
        // process-global environment that sibling suites share.
        const metadata = {
            path: '/work/demo',
            externalSessionSource: { kind: 'claudeConfig', configDir, projectId },
        };

        // `padded-session` is a different session from `  padded-session  `; the
        // padded request must not export the former's transcript under the latter's id.
        const padded = await claudeHandoffSurface.exportBundle(
            { sessionId: '  padded-session  ', metadata, directory: root },
            invocation(),
        );
        expect(padded.ok).toBe(false);

        const exact = await claudeHandoffSurface.exportBundle(
            { sessionId: 'padded-session', metadata, directory: root },
            invocation(),
        );
        expect(exact.ok).toBe(true);
        expect(exact.ok ? exact.value.bundle.remoteSessionId : null).toBe('padded-session');
    });
});
