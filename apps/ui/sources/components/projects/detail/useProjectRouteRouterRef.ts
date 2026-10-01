import * as React from 'react';
import { useRouter } from '@/components/appShell/workspace/destinationRoute';

export type ProjectRouteRouter = ReturnType<typeof useRouter>;

export function useProjectRouteRouterRef(): React.MutableRefObject<ProjectRouteRouter> {
    const router = useRouter();
    const routerRef = React.useRef(router);
    routerRef.current = router;
    return routerRef;
}
