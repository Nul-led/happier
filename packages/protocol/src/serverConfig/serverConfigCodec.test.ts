import { describe, expect, it } from 'vitest';

import { readServerConfig, serializeServerConfigValue, validateServerConfigValue } from './serverConfigCodec.js';
import { composeServerConfigRegistry, defineServerConfigRegistry } from './serverConfigEntry.js';

const TEST_CONFIG = defineServerConfigRegistry({
    TEST_FLAG: { type: 'boolean', default: true, sensitivity: 'plain', apply: 'live', editable: 'home', section: 'features', description: 'Flag.' },
    TEST_PORT: {
        type: 'int',
        default: 587,
        bounds: { min: 1, max: 65_535 },
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'email',
        aliases: ['LEGACY_TEST_PORT'],
        description: 'Port.',
    },
    TEST_MODE: {
        type: 'enum',
        bounds: { values: ['automatic', 'disabled'] },
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'reach',
        description: 'Mode.',
    },
    TEST_URLS: {
        type: 'list',
        bounds: { scheme: 'https' },
        sensitivity: 'plain',
        apply: 'live',
        editable: 'home',
        section: 'reach',
        description: 'URLs.',
    },
});

describe('readServerConfig', () => {
    it('falls back to the declared default when unset, blank, unparseable or out of bounds', () => {
        expect(readServerConfig({}, TEST_CONFIG.TEST_PORT)).toBe(587);
        expect(readServerConfig({ TEST_PORT: '  ' }, TEST_CONFIG.TEST_PORT)).toBe(587);
        expect(readServerConfig({ TEST_PORT: 'abc' }, TEST_CONFIG.TEST_PORT)).toBe(587);
        expect(readServerConfig({ TEST_PORT: '70000' }, TEST_CONFIG.TEST_PORT)).toBe(587);
        expect(readServerConfig({ TEST_FLAG: 'nope' }, TEST_CONFIG.TEST_FLAG)).toBe(true);
    });

    it('reads the key before its aliases, and an alias when the key is unset', () => {
        expect(readServerConfig({ TEST_PORT: '25', LEGACY_TEST_PORT: '2525' }, TEST_CONFIG.TEST_PORT)).toBe(25);
        expect(readServerConfig({ LEGACY_TEST_PORT: '2525' }, TEST_CONFIG.TEST_PORT)).toBe(2525);
    });

    it('canonicalizes enum and list values and rejects values outside their bounds', () => {
        expect(readServerConfig({ TEST_MODE: ' Disabled ' }, TEST_CONFIG.TEST_MODE)).toBe('disabled');
        expect(readServerConfig({ TEST_MODE: 'sometimes' }, TEST_CONFIG.TEST_MODE)).toBeUndefined();
        expect(readServerConfig({ TEST_URLS: 'https://a.example, https://b.example\n' }, TEST_CONFIG.TEST_URLS)).toEqual([
            'https://a.example',
            'https://b.example',
        ]);
        expect(readServerConfig({ TEST_URLS: 'https://a.example,not a url' }, TEST_CONFIG.TEST_URLS)).toBeUndefined();
    });

    it('lets the deployment env use a plain-http address that a Home write could not set', () => {
        expect(readServerConfig({ TEST_URLS: 'http://relay.lan:8080' }, TEST_CONFIG.TEST_URLS)).toEqual(['http://relay.lan:8080']);
    });
});

describe('validateServerConfigValue', () => {
    it('refuses wrong types and out-of-bounds values with a typed reason', () => {
        expect(validateServerConfigValue(TEST_CONFIG.TEST_PORT, '25')).toEqual({ ok: false, reason: 'invalid_type' });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_PORT, 2.5)).toEqual({ ok: false, reason: 'invalid_type' });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_PORT, 0)).toEqual({ ok: false, reason: 'out_of_bounds' });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_FLAG, 'true')).toEqual({ ok: false, reason: 'invalid_type' });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_MODE, 'sometimes')).toEqual({ ok: false, reason: 'out_of_bounds' });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_URLS, ['https://a.example,https://b.example'])).toEqual({
            ok: false,
            reason: 'invalid_type',
        });
        expect(validateServerConfigValue(TEST_CONFIG.TEST_URLS, ['http://a.example'])).toEqual({ ok: false, reason: 'out_of_bounds' });
    });

    it('round-trips every accepted value through the env form the overlay writes', () => {
        const samples = [
            [TEST_CONFIG.TEST_FLAG, false],
            [TEST_CONFIG.TEST_PORT, 65_535],
            [TEST_CONFIG.TEST_MODE, 'automatic'],
            [TEST_CONFIG.TEST_URLS, ['https://relay.example/a', 'https://relay.example/b']],
        ] as const;
        for (const [entry, value] of samples) {
            const validated = validateServerConfigValue(entry, value);
            expect(validated.ok).toBe(true);
            if (!validated.ok) continue;
            const env = { [entry.key]: serializeServerConfigValue(entry, validated.value) };
            expect(readServerConfig(env, entry)).toEqual(validated.value);
        }
    });
});

describe('registry declaration rules', () => {
    it('refuses a default on a secret and a key or alias declared twice', () => {
        expect(() =>
            defineServerConfigRegistry({
                SECRET_KEY: { type: 'string', default: 'x', sensitivity: 'secret', apply: 'restart', editable: 'bootstrap', section: 'server', description: 'Secret.', readOnlyReason: 'before_database', reason: 'Read before the database opens.' },
            }),
        ).toThrow(/secret entry cannot declare a default/);
        const other = defineServerConfigRegistry({
            OTHER_PORT: { type: 'int', sensitivity: 'plain', apply: 'restart', editable: 'home', section: 'server', aliases: ['LEGACY_TEST_PORT'], description: 'Other.' },
        });
        expect(() => composeServerConfigRegistry(TEST_CONFIG, other)).toThrow(/LEGACY_TEST_PORT is already declared by TEST_PORT/);
    });
});
