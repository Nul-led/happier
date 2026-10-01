import * as React from 'react';
import { usePathname } from '@/components/appShell/workspace/destinationRoute';

import { t } from '@/text';
import { PageHeader, type PageHeaderProps } from '@/components/ui/layout/PageHeader';
import { resolveSettingsRouteTitleKey } from '@/components/settings/navigation/settingsRouteRegistry';

/**
 * A settings page's header. The title comes from the route registry that also titles the native
 * header, unless the page passes its own (entity pages).
 */
export const SettingsPageHeader = React.memo(function SettingsPageHeader(
    props: Partial<Pick<PageHeaderProps, 'title'>> & Omit<PageHeaderProps, 'title'>,
) {
    const pathname = usePathname();
    const titleKey = resolveSettingsRouteTitleKey(pathname);
    const title = props.title ?? (titleKey ? t(titleKey) : '');
    return <PageHeader {...props} title={title} />;
});
