import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { Text } from '@/components/ui/text/Text';
import { Icon } from '@/components/ui/icons/Icon';
import { t } from '@/text';

export type PluginUiDiagnostic = Readonly<{
    code: string;
    message: string;
}>;

export function PluginDiagnosticsSection(props: Readonly<{
    title: string;
    diagnostics: readonly PluginUiDiagnostic[];
    testIDPrefix: string;
}>) {
    const { theme } = useUnistyles();
    if (props.diagnostics.length === 0) return null;

    return (
        <ItemGroup title={props.title}>
            {props.diagnostics.map((diagnostic, index) => (
                <Item
                    key={`${diagnostic.code}:${diagnostic.message}:${index}`}
                    testID={`${props.testIDPrefix}.${diagnostic.code}.${index}`}
                    title={t('settingsPlugins.diagnosticsIssueTitle')}
                    subtitle={(
                        <Text
                            testID={`${props.testIDPrefix}.${diagnostic.code}.${index}.message`}
                            selectable
                        >
                            {diagnostic.message}
                            {'\n'}
                            {t('settingsPlugins.diagnosticsRecovery')}
                            {'\n'}
                            <Text
                                testID={`${props.testIDPrefix}.${diagnostic.code}.${index}.code`}
                                selectable
                            >
                                {t('settingsPlugins.diagnosticsTechnicalCode', { code: diagnostic.code })}
                            </Text>
                        </Text>
                    )}
                    subtitleLines={0}
                    icon={<Icon name="bug" size={29} color={theme.colors.text.secondary} />}
                    showChevron={false}
                    mode="info"
                />
            ))}
        </ItemGroup>
    );
}
