import * as React from 'react';
import { type Href } from 'expo-router';
import { useLocalSearchParams, Stack } from '@/components/appShell/workspace/destinationRoute';

import { ApprovalDetailScreen } from '@/components/approvals/ApprovalDetailScreen';
import { t } from '@/text';
import { normalizeInternalReturnPath } from '@/utils/path/routeUtils';

const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export function ApprovalDetailPage() {
  const { id, serverId, completionHref, completionFocusFrom, completionFocusTo } = useLocalSearchParams<{
    id: string;
    serverId?: string;
    completionHref?: string;
    completionFocusFrom?: string;
    completionFocusTo?: string;
  }>();
  if (!id) return null;
  const normalizedCompletionHref = normalizeInternalReturnPath(single(completionHref)) as Href | null;

  const headerTitle = t('approvals.title');
  const screenOptions = React.useMemo(() => {
    return { title: headerTitle } as const;
  }, [headerTitle]);

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <ApprovalDetailScreen
        artifactId={id}
        serverId={single(serverId)}
        completionHref={normalizedCompletionHref ?? undefined}
        completionFocusFrom={single(completionFocusFrom)}
        completionFocusTo={single(completionFocusTo)}
      />
    </>
  );
}
import { WorkspaceRouteEntry } from '@/components/appShell/workspace/createWorkspaceRouteEntry';
export { ApprovalDetailPage as WorkspaceRouteBody };
export default function RouteEntry() { return <WorkspaceRouteEntry Body={ApprovalDetailPage} />; }
