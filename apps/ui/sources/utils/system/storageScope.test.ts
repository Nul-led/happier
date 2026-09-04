import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
    EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR,
    normalizeStorageScope,
    readStorageScopeFromEnv,
    scopedStorageId,
} from './storageScope';

const require = createRequire(import.meta.url);
const APP_ROOT = resolve(import.meta.dirname, '../../..');

function executeMetroTransform(source: string): typeof import('./storageScope') {
    const babel = require('@babel/core') as typeof import('@babel/core');
    const filename = resolve(import.meta.dirname, 'storageScope.ts');
    const transformed = babel.transformSync(source, {
        filename,
        root: APP_ROOT,
        babelrc: false,
        configFile: resolve(APP_ROOT, 'babel.config.js'),
        caller: { name: 'metro', platform: 'web', isDev: true, supportsStaticESM: false } as never,
    })?.code;
    if (!transformed) throw new Error('Metro transform produced no storage-scope module');

    const module = { exports: {} as typeof import('./storageScope') };
    const metroRequire = (specifier: string): unknown => {
        if (specifier === 'expo/virtual/env') {
            return { env: { EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: 'metro-static-scope' } };
        }
        throw new Error(`Unexpected transformed dependency: ${specifier}`);
    };
    Function('exports', 'module', 'require', transformed)(module.exports, module, metroRequire);
    return module.exports;
}

describe('storageScope', () => {
    describe('normalizeStorageScope', () => {
        it('returns null for non-strings and empty strings', () => {
            expect(normalizeStorageScope(undefined)).toBeNull();
            expect(normalizeStorageScope(null)).toBeNull();
            expect(normalizeStorageScope(123)).toBeNull();
            expect(normalizeStorageScope('')).toBeNull();
            expect(normalizeStorageScope('   ')).toBeNull();
        });

        it('sanitizes unsafe characters and clamps length', () => {
            expect(normalizeStorageScope(' pr272-107 ')).toBe('pr272-107');
            expect(normalizeStorageScope('a/b:c')).toBe('a_b_c');
            expect(normalizeStorageScope('a__b')).toBe('a_b');
            expect(normalizeStorageScope('東京::stack///id')).toBe('_stack_id');

            const long = 'x'.repeat(100);
            expect(normalizeStorageScope(long)?.length).toBe(64);
        });
    });

    describe('readStorageScopeFromEnv', () => {
        it('reads from EXPO_PUBLIC_HAPPY_STORAGE_SCOPE', () => {
            expect(readStorageScopeFromEnv({ [EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR]: 'stack-1' })).toBe('stack-1');
            expect(readStorageScopeFromEnv({ [EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR]: '   ' })).toBeNull();
        });

        it('reads the default scope from Metro\'s statically substituted public environment', () => {
            const source = readFileSync(resolve(import.meta.dirname, 'storageScope.ts'), 'utf8');
            const bundled = executeMetroTransform(source);

            expect(bundled.readStorageScopeFromEnv()).toBe('metro-static-scope');
            expect(bundled.readStorageScopeFromEnv({
                [EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR]: 'injected-scope',
            })).toBe('injected-scope');

            // A dynamic lookup is not rewritten to Expo's virtual environment. This
            // control is the predecessor behavior that silently selected unscoped
            // persistence in browser bundles despite the configured public scope.
            const dynamicLookupControl = executeMetroTransform(`
                export const EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR = 'EXPO_PUBLIC_HAPPY_STORAGE_SCOPE';
                export function normalizeStorageScope(value) {
                    return typeof value === 'string' && value.trim() ? value.trim() : null;
                }
                export function readStorageScopeFromEnv(env = process.env) {
                    return normalizeStorageScope(env[EXPO_PUBLIC_STORAGE_SCOPE_ENV_VAR]);
                }
                export function scopedStorageId(baseId, scope) {
                    return scope ? \`${'${baseId}'}__${'${scope}'}\` : baseId;
                }
            `);
            expect(dynamicLookupControl.readStorageScopeFromEnv()).not.toBe('metro-static-scope');
        });
    });

    describe('scopedStorageId', () => {
        it('returns baseId when scope is null', () => {
            expect(scopedStorageId('auth_credentials', null)).toBe('auth_credentials');
        });

        it('namespaces when scope is present', () => {
            expect(scopedStorageId('auth_credentials', 'stack-1')).toBe('auth_credentials__stack-1');
        });
    });
});
