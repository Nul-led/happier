import { describe, expect, it } from 'vitest';

import { resolveSystemTaskRunnerMode } from './systemTaskRunnerMode';

describe('resolveSystemTaskRunnerMode', () => {
    it('selects native system tasks automatically on iOS and Android when no explicit mode is set', () => {
        expect(resolveSystemTaskRunnerMode({
            explicitMode: '',
            desktopHostKind: null,
            nodeEnv: 'production',
            platformOS: 'ios',
        })).toBe('native');
        expect(resolveSystemTaskRunnerMode({
            explicitMode: '',
            desktopHostKind: null,
            nodeEnv: 'production',
            platformOS: 'android',
        })).toBe('native');
    });

    it('keeps web production unavailable unless desktop or explicit mode is present', () => {
        expect(resolveSystemTaskRunnerMode({
            explicitMode: '',
            desktopHostKind: null,
            nodeEnv: 'production',
            platformOS: 'web',
        })).toBe('unavailable');
    });

    it('uses the shared desktop task bridge for both Tauri and Electron', () => {
        expect(resolveSystemTaskRunnerMode({
            explicitMode: '',
            desktopHostKind: 'tauri',
            nodeEnv: 'production',
            platformOS: 'web',
        })).toBe('tauri');
        expect(resolveSystemTaskRunnerMode({
            explicitMode: '',
            desktopHostKind: 'electron',
            nodeEnv: 'production',
            platformOS: 'web',
        })).toBe('tauri');
    });
});
