import { describe, expect, it } from 'vitest';

import type { DesktopUpdaterSnapshot } from '@/desktop/updates/desktopUpdater';

import { buildAppUpdateItem, type AppUpdateFacts } from './buildAppUpdateItem';
import { buildUpdatesSummary } from './buildUpdatesSummary';

const DESKTOP_IDLE: DesktopUpdaterSnapshot = {
    phase: 'idle',
    version: null,
    currentVersion: null,
    downloadPercent: null,
    failure: null,
    skipped: false,
    refreshing: false,
    checkedAt: null,
};

const OTA_IDLE: AppUpdateFacts['ota'] = {
    supported: false,
    isChecking: false,
    isDownloading: false,
    isRestarting: false,
    downloadProgress: null,
    isUpdateAvailable: false,
    isUpdatePending: false,
    checkFailed: false,
    downloadFailed: false,
    checkedAt: null,
};

function facts(overrides: Partial<AppUpdateFacts> = {}): AppUpdateFacts {
    return {
        platformOs: 'web',
        desktopHost: false,
        title: 'Happier',
        native: { updateUrl: null },
        webUiUpdateAvailable: false,
        desktop: DESKTOP_IDLE,
        ota: OTA_IDLE,
        ...overrides,
    };
}

describe('buildAppUpdateItem (the "This app" row)', () => {
    it('walks the desktop lifecycle: available → downloading with a real percent → ready to restart', () => {
        const available = buildAppUpdateItem(facts({ platformOs: 'macos', desktop: { ...DESKTOP_IDLE, phase: 'available', version: '0.2.11', currentVersion: '0.2.10' } }));
        expect(available).toMatchObject({ channel: 'desktop', item: { state: 'available', latestVersion: '0.2.11', currentVersion: '0.2.10', action: { kind: 'run', verb: 'update' } } });

        const downloading = buildAppUpdateItem(facts({ desktop: { ...DESKTOP_IDLE, phase: 'downloading', version: '0.2.11', downloadPercent: 42 } }));
        expect(downloading.item).toMatchObject({ state: 'running', step: 'downloading', progressPercent: 42, action: { kind: 'none' } });

        const ready = buildAppUpdateItem(facts({ desktop: { ...DESKTOP_IDLE, phase: 'ready', version: '0.2.11' } }));
        expect(ready.item).toMatchObject({ state: 'ready', action: { kind: 'run', verb: 'restart' } });
    });

    it('a failed first check is "could not check" with Retry, never "up to date"', () => {
        const model = buildAppUpdateItem(facts({ desktop: { ...DESKTOP_IDLE, phase: 'failed', failure: 'check' } }));
        expect(model.item).toMatchObject({ state: 'unknown', failure: { kind: 'appCheck' }, action: { kind: 'run', verb: 'retry' } });

        const download = buildAppUpdateItem(facts({ desktop: { ...DESKTOP_IDLE, phase: 'failed', failure: 'download', version: '0.2.11' } }));
        expect(download.item).toMatchObject({ state: 'failed', failure: { kind: 'appDownload' }, action: { kind: 'run', verb: 'retry' } });
    });

    it('keeps a skipped desktop version visible to the row but marked skipped', () => {
        const model = buildAppUpdateItem(facts({ desktop: { ...DESKTOP_IDLE, phase: 'available', version: '0.2.11', skipped: true } }));
        expect(model.item).toMatchObject({ state: 'available', skipped: true });
    });

    it('a store update outranks everything; web offers Reload; OTA rests at restart', () => {
        expect(buildAppUpdateItem(facts({
            platformOs: 'ios',
            native: { updateUrl: 'https://apps.apple.com/x' },
            desktop: { ...DESKTOP_IDLE, phase: 'available', version: '9' },
        })).item).toMatchObject({ state: 'available', action: { kind: 'run', verb: 'store' } });

        expect(buildAppUpdateItem(facts({ webUiUpdateAvailable: true })).item).toMatchObject({ state: 'available', action: { kind: 'run', verb: 'reload' } });

        expect(buildAppUpdateItem(facts({ platformOs: 'android', ota: { ...OTA_IDLE, supported: true, isDownloading: true, downloadProgress: 0.5 } })).item)
            .toMatchObject({ state: 'running', progressPercent: 50 });
        expect(buildAppUpdateItem(facts({ platformOs: 'android', ota: { ...OTA_IDLE, supported: true, isUpdatePending: true } })).item)
            .toMatchObject({ state: 'ready', action: { kind: 'run', verb: 'restart' } });
    });

    it('projects OTA check and download failures with the operation the person can retry', () => {
        const checkFailure = buildAppUpdateItem(facts({ ota: { ...OTA_IDLE, supported: true, checkFailed: true, checkedAt: 1 } }));
        expect(checkFailure).toMatchObject({ channel: 'ota', item: { state: 'unknown', failure: { kind: 'appCheck' }, action: { kind: 'run', verb: 'retry' } } });

        const downloadFailure = buildAppUpdateItem(facts({ ota: { ...OTA_IDLE, supported: true, isUpdateAvailable: true, downloadFailed: true } }));
        expect(downloadFailure).toMatchObject({ channel: 'ota', item: { state: 'failed', failure: { kind: 'appDownload' }, action: { kind: 'run', verb: 'retry' } } });
    });

    it('requires an OTA check result before claiming up to date, and projects the active operation', () => {
        const ota = { ...OTA_IDLE, supported: true };
        expect(buildAppUpdateItem(facts({ ota })).item.state).toBe('unchecked');
        expect(buildAppUpdateItem(facts({ ota: { ...ota, isChecking: true, checkFailed: true } })).item)
            .toMatchObject({ state: 'checking', failure: null, action: { kind: 'none' } });
        expect(buildAppUpdateItem(facts({ ota: { ...ota, checkedAt: 1 } })).item.state).toBe('upToDate');
        expect(buildAppUpdateItem(facts({ ota: { ...ota, checkedAt: 1, downloadFailed: true } })).item.state).toBe('upToDate');
        expect(buildAppUpdateItem(facts({ ota: { ...ota, isUpdateAvailable: true } })).item)
            .toMatchObject({ state: 'available', action: { kind: 'run', verb: 'update' } });
        expect(buildAppUpdateItem(facts({ ota: { ...ota, isUpdatePending: true, downloadFailed: true } })).item)
            .toMatchObject({ state: 'ready', failure: null, action: { kind: 'run', verb: 'restart' } });
        expect(buildAppUpdateItem(facts({ ota: { ...ota, isRestarting: true, isUpdatePending: true } })).item)
            .toMatchObject({ state: 'running', step: 'restarting', action: { kind: 'none' } });
    });

    it('an idle desktop check is not proof the app is current', () => {
        const unchecked = buildAppUpdateItem({ ...facts(), desktopHost: true });
        expect(unchecked).toMatchObject({ channel: 'desktop', item: { state: 'unchecked' } });
        expect(buildUpdatesSummary([unchecked.item]).status).toBe('unchecked');
        const checked = buildAppUpdateItem({ ...facts(), desktopHost: true, desktop: { ...DESKTOP_IDLE, phase: 'upToDate', checkedAt: 1 } });
        expect(buildUpdatesSummary([checked.item]).status).toBe('upToDate');
    });

    it('with nothing to do the app is up to date (release notes are not an input)', () => {
        expect(buildAppUpdateItem(facts()).item).toMatchObject({ state: 'upToDate', action: { kind: 'none' } });
    });
});
