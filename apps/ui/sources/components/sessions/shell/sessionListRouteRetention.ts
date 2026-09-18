export type SessionListRouteRemovalNavigation = Readonly<{
    addListener: (event: 'beforeRemove', listener: () => void) => () => void;
}>;

export function registerSessionListRouteRemovalRelease(
    navigation: SessionListRouteRemovalNavigation,
    release: () => void,
): () => void {
    return navigation.addListener('beforeRemove', release);
}
