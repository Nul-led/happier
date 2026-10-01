import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { buildUniversalPluginUiArtifacts } from './buildUniversalUiArtifacts.js';

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function hostedFixture(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'happier-ui-static-'));
    roots.push(root);
    await mkdir(join(root, '.happier-plugin/ui/hosted-web/panel/assets'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }), 'utf8');
    await writeFile(join(root, '.happier-plugin/plugin.json'), JSON.stringify({
        contributes: {
            ui: {
                renderers: [{
                    id: 'panel-renderer',
                    kind: 'hostedWeb',
                    source: { kind: 'artifact', artifact: 'panel' },
                }],
            },
        },
    }), 'utf8');
    await writeFile(join(root, '.happier-plugin/ui/hosted-web/panel/index.html'), '<script src="./assets/app.js"></script>', 'utf8');
    await writeFile(join(root, '.happier-plugin/ui/hosted-web/panel/assets/app.js'), 'globalThis.loaded = true;', 'utf8');
    return root;
}

describe('buildUniversalPluginUiArtifacts hosted static staging', () => {
    it('builds the exact Collection migration artifact declared by the Account Collection owner', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-ui-collection-migration-'));
        roots.push(root);
        await mkdir(join(root, '.happier-plugin'), { recursive: true });
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'package.json'), JSON.stringify({
            name: 'fixture',
            exports: {
                './happier-plugin-ui/collection-migrations': './src/collectionMigrations.ts',
            },
        }), 'utf8');
        await writeFile(join(root, '.happier-plugin/plugin.json'), JSON.stringify({
            contributes: {
                accountCollections: [{
                    id: 'tasks',
                    migrations: [{ id: 'tasks-v1-to-v2', fromSchemaVersion: 1, toSchemaVersion: 2 }],
                    migrationArtifact: {
                        artifactId: 'collection-migrations',
                        exportName: 'collectionMigrations',
                    },
                }],
                ui: {
                    renderers: [{ id: 'panel', kind: 'reactNative', artifact: 'panel' }],
                },
            },
        }), 'utf8');
        await writeFile(
            join(root, 'src/collectionMigrations.ts'),
            'export function collectionMigrations() { return { manifest: {}, collectionMigrations: {} }; }',
            'utf8',
        );
        await writeFile(
            join(root, 'src/panel.ts'),
            'export function renderSurface() { return null; }',
            'utf8',
        );
        const packageJsonPath = join(root, 'package.json');
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { exports: Record<string, string> };
        packageJson.exports['./happier-plugin-ui/panel'] = './src/panel.ts';
        await writeFile(packageJsonPath, JSON.stringify(packageJson), 'utf8');

        const result = await buildUniversalPluginUiArtifacts(root);

        expect(result.manifest.entries).toEqual(expect.arrayContaining([
            expect.objectContaining({
                artifactId: 'collection-migrations',
                executable: { exports: ['collectionMigrations'] },
            }),
            expect.objectContaining({
                artifactId: 'panel',
                executable: { exports: ['renderSurface'] },
            }),
        ]));
    });

    it('does not infer Collection migration authority from a renderer export', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-ui-renderer-only-migration-'));
        roots.push(root);
        await mkdir(join(root, '.happier-plugin'), { recursive: true });
        await mkdir(join(root, 'src'), { recursive: true });
        await writeFile(join(root, 'package.json'), JSON.stringify({
            name: 'fixture',
            exports: { './happier-plugin-ui/panel': './src/panel.ts' },
        }), 'utf8');
        await writeFile(join(root, '.happier-plugin/plugin.json'), JSON.stringify({
            contributes: {
                accountCollections: [{
                    id: 'tasks',
                    migrations: [{ id: 'tasks-v1-to-v2', fromSchemaVersion: 1, toSchemaVersion: 2 }],
                }],
                ui: { renderers: [{ id: 'panel', kind: 'reactNative', artifact: 'panel' }] },
            },
        }), 'utf8');
        await writeFile(
            join(root, 'src/panel.ts'),
            'export function renderSurface() { return null; } export function collectionMigrations() { return {}; }',
            'utf8',
        );

        await expect(buildUniversalPluginUiArtifacts(root)).rejects.toMatchObject({
            code: 'collection_migration_artifact_missing',
        });
    });

    it('publishes an empty exact inventory for a plugin with no UI artifacts', async () => {
        const root = await mkdtemp(join(tmpdir(), 'happier-ui-empty-'));
        roots.push(root);
        await mkdir(join(root, '.happier-plugin'), { recursive: true });
        await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture' }), 'utf8');
        await writeFile(join(root, '.happier-plugin/plugin.json'), JSON.stringify({
            contributes: { actions: [] },
        }), 'utf8');
        await mkdir(join(root, 'dist/happier-plugin-ui/react-native/stale'), { recursive: true });
        await writeFile(
            join(root, 'dist/happier-plugin-ui/react-native/stale/entry.cjs.bundle'),
            'stale',
            'utf8',
        );

        const result = await buildUniversalPluginUiArtifacts(root);

        expect(result.manifest.entries).toEqual([]);
        await expect(readFile(join(result.artifactsRoot, 'ui-artifacts.json'), 'utf8'))
            .resolves.toContain('"entries": []');
        await expect(readFile(
            join(result.artifactsRoot, 'react-native/stale/entry.cjs.bundle'),
            'utf8',
        )).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('stages and digests an arbitrary nested static directory without compiling it', async () => {
        const root = await hostedFixture();

        const result = await buildUniversalPluginUiArtifacts(root);

        expect(result.manifest.entries).toEqual([
            expect.objectContaining({
                artifactId: 'panel',
                tier: 'hostedWeb',
                entry: 'hosted-web/panel/index.html',
                builtWith: { staging: 'staticDirectory' },
                files: [
                    expect.objectContaining({ relativePath: 'hosted-web/panel/assets/app.js' }),
                    expect.objectContaining({ relativePath: 'hosted-web/panel/index.html' }),
                ],
            }),
        ]);
        await expect(readFile(join(result.artifactsRoot, 'hosted-web/panel/assets/app.js'), 'utf8'))
            .resolves.toBe('globalThis.loaded = true;');
    });

    it('compiles the conventional hosted source entry without author-owned build config', async () => {
        const root = await hostedFixture();
        await writeFile(
            join(root, '.happier-plugin/ui/hosted-web/panel/entry.ts'),
            'const status: string = "ready"; globalThis.document?.documentElement.setAttribute("data-status", status);',
            'utf8',
        );

        const result = await buildUniversalPluginUiArtifacts(root);
        const entry = result.manifest.entries[0];

        expect(entry?.files.map((file) => file.relativePath)).toEqual([
            'hosted-web/panel/assets/app.js',
            'hosted-web/panel/index.html',
        ]);
        const compiled = await readFile(join(result.artifactsRoot, 'hosted-web/panel/assets/app.js'), 'utf8');
        expect(compiled).toContain('data-status');
        expect(compiled).not.toContain('const status: string');
        await expect(readFile(join(result.artifactsRoot, 'hosted-web/panel/entry.ts'), 'utf8')).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('rejects symlinks anywhere in a hosted static artifact', async () => {
        const root = await hostedFixture();
        await symlink(
            join(root, '.happier-plugin/ui/hosted-web/panel/assets/app.js'),
            join(root, '.happier-plugin/ui/hosted-web/panel/linked.js'),
        );

        await expect(buildUniversalPluginUiArtifacts(root)).rejects.toMatchObject({
            code: 'hosted_static_symlink_unsupported',
        });
    });
});
