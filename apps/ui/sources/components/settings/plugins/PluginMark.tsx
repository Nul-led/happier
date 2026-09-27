import * as React from 'react';

import { MonogramMark } from '@/components/ui/layout/MonogramMark';

/**
 * A plugin's identity mark: the monogram of its name. Plugin records carry no admitted logo, so the
 * monogram is the whole identity; it is the same tile in the installed list, the Browse cards and the
 * plugin's own page header (`size="page"`).
 */
export const PluginMark = React.memo(function PluginMark(props: Readonly<{
    title: string;
    size?: 'row' | 'page';
    testID?: string;
}>) {
    return <MonogramMark title={props.title} size={props.size} testID={props.testID} />;
});
