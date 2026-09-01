import assert from 'node:assert/strict';
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { resolveHsetupPath } from './hsetupPath';

test('materializes a non-executable bundled hsetup into the host cache', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'happier-electron-hsetup-path-'));
    const source = join(root, 'hsetup-source');
    const cacheDir = join(root, 'cache');
    writeFileSync(source, '#!/bin/sh\nexit 0\n');
    chmodSync(source, 0o600);

    const resolved = resolveHsetupPath({ explicitPath: source, cacheDir, platform: process.platform });

    assert.notEqual(resolved, source);
    accessSync(resolved, constants.X_OK);
    assert.equal(resolveHsetupPath({ explicitPath: source, cacheDir, platform: process.platform }), resolved);
    rmSync(root, { recursive: true, force: true });
});

test('an explicit missing hsetup path fails closed instead of falling back', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-electron-hsetup-missing-'));
    assert.throws(
        () => resolveHsetupPath({ explicitPath: join(root, 'missing'), cacheDir: join(root, 'cache') }),
        /Configured hsetup executor does not exist/u,
    );
    rmSync(root, { recursive: true, force: true });
});

test('automatic discovery refuses a bundled executable for another operating system', () => {
    const root = mkdtempSync(join(tmpdir(), 'happier-electron-hsetup-foreign-'));
    const binaries = join(root, 'binaries');
    const cacheDir = join(root, 'cache');
    mkdirSync(binaries, { recursive: true });
    const candidate = join(binaries, 'hsetup');
    const foreignHeader = process.platform === 'darwin'
        ? Buffer.from([0x7f, 0x45, 0x4c, 0x46])
        : Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
    writeFileSync(candidate, foreignHeader);

    assert.throws(
        () => resolveHsetupPath({ resourcesPath: root, appPath: root, cacheDir }),
        /Unable to resolve bundled hsetup executor/u,
    );
    rmSync(root, { recursive: true, force: true });
});
