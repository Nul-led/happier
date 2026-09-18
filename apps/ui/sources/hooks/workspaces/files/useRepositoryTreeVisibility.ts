import * as React from 'react';
import { useRepositoryTreeRevealedPaths } from './useRepositoryTreeRevealedPaths';

export function useRepositoryTreeVisibility(scopeKey: string) {
    const [visibilityMode, setVisibilityMode] = React.useState<'project' | 'all'>('project');
    const [status, setStatus] = React.useState<Readonly<{ scopeKey: string; available?: boolean }> | null>(null);
    const gitIgnoreAvailable = status?.scopeKey === scopeKey ? status.available : undefined;
    const setGitIgnoreAvailable = React.useCallback((available: boolean | undefined) => {
        setStatus(previous => previous?.scopeKey === scopeKey && previous.available === available ? previous : { scopeKey, available });
    }, [scopeKey]);
    const { paths: revealedPaths, revealPath, latestRequest } = useRepositoryTreeRevealedPaths(scopeKey);
    return { visibilityMode, setVisibilityMode, gitIgnoreAvailable, setGitIgnoreAvailable, revealedPaths, revealPath, latestRequest };
}
