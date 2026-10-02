import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const uiRoot = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(path.join(uiRoot, 'package.json'));

test('generated selected-icon registries resolve only their published leaves in Metro', async () => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'happier-icon-graph-'));
    let server;
    try {
        writeFileSync(path.join(fixture, 'huge.json'), JSON.stringify({warning: 'Alert01Icon'}));
        writeFileSync(path.join(fixture, 'phosphor.json'), JSON.stringify({warning: 'warning'}));
        for (const [generator, mapping, output] of [
            ['genHugeRegistry.mjs', 'huge.json', 'iconRegistryHuge.generated.ts'],
            ['genRegistry.mjs', 'phosphor.json', 'iconRegistry.generated.ts'],
        ]) {
            execFileSync(process.execPath, [path.join(uiRoot, 'scripts/icons', generator), path.join(fixture, mapping), path.join(fixture, output)]);
        }
        writeFileSync(path.join(fixture, 'index.ts'), "export {HUGE_ICON_REGISTRY} from './iconRegistryHuge.generated'; export {ICON_REGISTRY} from './iconRegistry.generated';");
        const config = require(path.join(uiRoot, 'metro.config.js'));
        config.watchFolders = [...config.watchFolders, fixture];
        config.resolver.nodeModulesPaths = [path.join(uiRoot, 'node_modules'), path.resolve(uiRoot, '../../node_modules')];
        config.maxWorkers = 2;
        config.cacheStores = [new (require('metro-cache').FileStore)({root: path.join(fixture, 'transforms')})];
        config.fileMapCacheDirectory = path.join(fixture, 'filemap');
        mkdirSync(config.fileMapCacheDirectory, {recursive: true});
        config.reporter = {update() {}};
        const Server = require('metro/private/Server').default;
        server = new Server(config, {watch: false});
        const failures = [];
        for (const platform of ['web', 'android']) {
            await server.build({...Server.DEFAULT_BUNDLE_OPTIONS, entryFile: path.join(fixture, 'index.ts'), platform, dev: true, minify: false, lazy: false});
            const graph = [...server.getBundler().getDeltaBundler()._deltaCalculators.keys()].at(-1);
            const paths = [...graph.dependencies.keys()].map(p => p.replaceAll('\\', '/'));
            const huge = paths.filter(p => p.includes('/@hugeicons/core-free-icons/'));
            const phosphor = paths.filter(p => p.includes('/phosphor-react-native/'));
            console.log(JSON.stringify({platform, hugeModules: huge.length, phosphorModules: phosphor.length, packageBarrels: [...huge, ...phosphor].filter(p => /\/(?:dist\/esm|lib\/module|lib\/commonjs|src)\/index\.[jt]sx?$/.test(p))}));
            try {
                assert.deepEqual(huge.map(p => p.split('/core-free-icons/')[1]), ['dist/esm/Alert01Icon.js']);
                assert.equal(phosphor.some(p => /\/(?:lib\/module|lib\/commonjs|src)\/index\.[jt]sx?$/.test(p)), false, 'Phosphor barrel must be absent');
                assert.deepEqual(phosphor.filter(p => p.includes('/src/icons/')).map(p => path.basename(p)), ['Warning.tsx']);
                assert.deepEqual(phosphor.filter(p => p.includes('/src/defs/')).map(p => path.basename(p)), ['Warning.tsx']);
            } catch (error) { failures.push(error); }
        }
        assert.equal(failures.length, 0, failures.map(e => e.message).join('\n'));
    } finally {
        if (server) await server.end();
        rmSync(fixture, {recursive: true, force: true});
    }
});
