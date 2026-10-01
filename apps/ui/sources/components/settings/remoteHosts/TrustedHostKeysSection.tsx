import * as React from 'react';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Modal } from '@/modal';
import { t } from '@/text';
import type { RemoteHostTrustedHostKeyRecord } from '@/sync/domains/remoteHosts/hostKeys/model';
import { getRemoteHostTrustedHostKeyStore } from '@/sync/domains/remoteHosts/hostKeys/trustedHostKeyStore';
import { SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';

import { REMOTE_HOSTS_ACCESS_SETTINGS } from './remoteHostsSettings';

function formatTrustedHostKeyTitle(record: RemoteHostTrustedHostKeyRecord): string {
    return `${record.hostLower}:${record.port}`;
}

function formatTrustedHostKeySubtitle(record: RemoteHostTrustedHostKeyRecord): string {
    return `${record.algorithm}\n${record.fingerprintSha256}`;
}

export const TrustedHostKeysSection = React.memo(function TrustedHostKeysSection() {
    const store = React.useMemo(() => getRemoteHostTrustedHostKeyStore(), []);
    const [records, setRecords] = React.useState<readonly RemoteHostTrustedHostKeyRecord[]>(() => store.readAll());
    const refresh = React.useCallback(() => {
        setRecords(store.readAll());
    }, [store]);

    // With no keys the section stays, empty, so a search for "Clear trusted host keys" lands on it.
    if (records.length === 0) {
        return (
            <SettingSection section={REMOTE_HOSTS_ACCESS_SETTINGS.sectionRefs.trustedHostKeys}>
                <ItemGroup
                    title={t('settings.remoteHostsTrustedHostKeysTitle')}
                    description={t('settingsRemoteHostsPage.trustedHostKeysDescription')}
                >
                    <Item
                        testID="settings.remoteHosts.trustedHostKeys.empty"
                        title={t('settingsRemoteHostsPage.trustedHostKeysEmpty')}
                        titleLines={0}
                        mode="info"
                        showChevron={false}
                    />
                </ItemGroup>
            </SettingSection>
        );
    }

    return (
        <ItemGroup
            title={t('settings.remoteHostsTrustedHostKeysTitle')}
            description={t('settingsRemoteHostsPage.trustedHostKeysDescription')}
        >
            {records.map((record) => (
                <Item
                    key={`${record.hostLower}:${record.port}:${record.algorithm}`}
                    title={formatTrustedHostKeyTitle(record)}
                    subtitle={formatTrustedHostKeySubtitle(record)}
                    subtitleLines={0}
                    showChevron={false}
                    onPress={() => {
                        void (async () => {
                            const confirmed = await Modal.confirm(
                                t('settings.remoteHostsTrustedHostKeyRemoveTitle'),
                                formatTrustedHostKeyTitle(record),
                                {
                                    destructive: true,
                                    confirmText: t('common.remove'),
                                    cancelText: t('common.cancel'),
                                },
                            );
                            if (!confirmed) return;
                            store.delete({
                                host: record.hostLower,
                                port: record.port,
                                algorithm: record.algorithm,
                            });
                            refresh();
                        })();
                    }}
                />
            ))}
            <SettingRow
                testID="settings.remoteHosts.trustedHostKeys.clear"
                setting={REMOTE_HOSTS_ACCESS_SETTINGS.settings.clearTrustedHostKeys}
                destructive
                showChevron={false}
                onPress={() => {
                    void (async () => {
                        const confirmed = await Modal.confirm(
                            t('settings.remoteHostsTrustedHostKeysClearTitle'),
                            undefined,
                            {
                                destructive: true,
                                confirmText: t('common.remove'),
                                cancelText: t('common.cancel'),
                            },
                        );
                        if (!confirmed) return;
                        store.clear();
                        refresh();
                    })();
                }}
            />
        </ItemGroup>
    );
});
