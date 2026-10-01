import { act } from 'react-test-renderer';
import { beforeEach, expect, it } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';
import { getPersistenceStorage } from '@/sync/domains/state/persistenceStorage';
import { storage } from '@/sync/domains/state/storageStore';
import { settingsDefaults, type Settings } from '@/sync/domains/settings/settings';
import { useSettingsSelector } from './hooks';

beforeEach(async () => {
    getPersistenceStorage().clearAll();
    await storage.getState().activateSettingsScope({ serverId: 'selector-home', accountId: 'selector-account' });
    storage.getState().applySettings(settingsDefaults, 1);
});

it('does not recompute settings projections for other store domains', async () => {
    let computations = 0;
    const selectDensity = (settings: Settings) => {
        computations++;
        return { density: settings.sessionListDensity };
    };
    const hook = await renderHook(() => useSettingsSelector(selectDensity));
    const baseline = computations;
    await act(async () => {
        storage.setState({ machines: { ...storage.getState().machines } });
    });
    expect(computations).toBe(baseline);
    await act(async () => {
        storage.getState().applySettingsLocal({ sessionListDensity: 'narrow' });
    });
    expect(hook.result.current.density).toBe('narrow');
    expect(computations).toBe(baseline + 1);
});
