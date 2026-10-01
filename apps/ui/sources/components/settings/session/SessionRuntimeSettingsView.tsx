import * as React from 'react';

import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { ItemList } from '@/components/ui/lists/ItemList';
import { SegmentedChoiceItem } from '@/components/ui/lists/SegmentedChoiceItem';
import { t } from '@/text';
import { useSetting } from '@/sync/domains/state/storage';
import { resolveTerminalHost } from '@/sync/domains/settings/terminalSettings';
import { useApplySettings } from '@/sync/store/settingsWriters';
import { SettingsPageHeader } from '@/components/settings/shell/SettingsPageHeader';
import { SettingAnchor } from '@/components/settings/shell/SettingRow';
import { SESSION_RUNTIME_SETTINGS } from '@/components/settings/session/sessionRuntimeSettings';

export const SessionRuntimeSettingsView = React.memo(function SessionRuntimeSettingsView() {
    const useTmux = useSetting('sessionUseTmux');
    const terminalHost = useSetting('sessionTerminalHost');
    const applySettings = useApplySettings();
    const selectedTerminalHost = resolveTerminalHost({ settings: {
        sessionUseTmux: useTmux, sessionTerminalHost: terminalHost,
        sessionTmuxByMachineId: {}, sessionTerminalHostByMachineId: {},
    }, machineId: null });

    return (
        <ItemList style={{ paddingTop: 0 }} presentation="page">
            <SettingsPageHeader description={t('settingsSessionPages.runtime.pageDescription')} />
            <ItemGroup title={t('settingsSessionPages.runtime.terminalSection')}>
                <SettingAnchor setting={SESSION_RUNTIME_SETTINGS.settings.host}>
                    <SegmentedChoiceItem<'none' | 'tmux' | 'zellij' | 'herdr'>
                        testID="settings-session-terminal-host-item"
                        testIDPrefix="settings-session-terminal-host"
                        title={t(SESSION_RUNTIME_SETTINGS.settings.host.titleKey)}
                        options={[
                            { id: 'none', label: t('settingsSessionPages.runtime.terminalHostNone') },
                            { id: 'tmux', label: 'tmux' },
                            { id: 'zellij', label: 'Zellij' },
                            { id: 'herdr', label: 'Herdr' },
                        ]}
                        value={selectedTerminalHost}
                        onChange={(next) => {
                            applySettings({ sessionTerminalHost: next, sessionUseTmux: next === 'tmux' });
                        }}
                    />
                </SettingAnchor>
            </ItemGroup>
        </ItemList>
    );
});

export default SessionRuntimeSettingsView;
