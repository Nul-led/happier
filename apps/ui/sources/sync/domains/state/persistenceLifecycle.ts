import { Platform } from 'react-native';
import { getPersistenceStorage } from './persistenceStorage';

export function clearPersistence(): void | Promise<void> {
    const mmkv = getPersistenceStorage();
    if (Platform.OS === 'web') {
        return (async () => {
            const { discardSessionDraftPersistenceWrites } = await import('../../ops/sessionDrafts/sessionDraftPersistenceStorage');
            const { clearBrowserRecords } = await import('./browserRecordStorage');
            await discardSessionDraftPersistenceWrites();
            await clearBrowserRecords();
            mmkv.clearAll();
        })();
    }
    mmkv.clearAll();
}
