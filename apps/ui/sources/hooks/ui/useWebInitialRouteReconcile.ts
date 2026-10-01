import * as React from 'react';
import { Platform } from 'react-native';
import { router, type Href } from 'expo-router';

function normalizeWebPathname(raw: string): string {
  let path = raw;
  if (!path.startsWith('/')) path = `/${path}`;
  for (const suffix of ['/index.html', '/']) {
    if (path.length > 1 && path.endsWith(suffix)) {
      path = path.slice(0, -suffix.length) || '/';
    }
  }
  return path;
}

function isStrictWebPathExtension(params: Readonly<{
  browserPathname: string;
  currentPathname: string;
}>): boolean {
  if (!params.browserPathname.startsWith(params.currentPathname)) return false;
  if (params.browserPathname.length <= params.currentPathname.length) return false;

  if (params.currentPathname === '/') {
    return params.browserPathname.startsWith('/');
  }

  return params.browserPathname.charAt(params.currentPathname.length) === '/';
}

/**
 * Expo Router can occasionally hydrate the initial route to a less-specific match on web refresh
 * (e.g. `/session/:id` instead of `/session/:id/info`). When that happens, the UI shows the
 * wrong screen while the browser URL remains the deep-link target.
 *
 * This hook reconciles the initial router state with the real browser location exactly once.
 * A scoped Session route also retains its initial Home when the router briefly hydrates
 * the same pathname without that query parameter.
 */
export function useWebInitialRouteReconcile(params: Readonly<{
  routerPathname: string;
  routerServerId?: string | string[] | null;
}>): void {
  const routerPathnameRef = React.useRef(params.routerPathname);
  const routerServerIdRef = React.useRef(params.routerServerId);
  const initialHrefRef = React.useRef<string | null>(null);
  const initialSessionServerIdRef = React.useRef<string | null>(null);
  const doneRef = React.useRef(false);

  // Capture the first browser address before router layout effects can rewrite it.
  if (initialHrefRef.current === null && Platform.OS === 'web' && typeof window !== 'undefined') {
    initialHrefRef.current = `${window.location.pathname}${window.location.search ?? ''}${window.location.hash ?? ''}`;
    if (/^\/session\/[^/]+(?:\/|$)/.test(normalizeWebPathname(window.location.pathname ?? '/'))) {
      initialSessionServerIdRef.current = new URLSearchParams(window.location.search ?? '').get('serverId')?.trim() || null;
    }
  }

  React.useEffect(() => {
    routerPathnameRef.current = params.routerPathname;
    routerServerIdRef.current = params.routerServerId;
  }, [params.routerPathname, params.routerServerId]);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof window === 'undefined') return;

    const delaysMs = [0, 50, 200, 1000];
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    const attempt = () => {
      if (doneRef.current) return;
      const expectedHref = initialHrefRef.current;
      if (!expectedHref) return;

      const currentHref = `${window.location.pathname}${window.location.search ?? ''}${window.location.hash ?? ''}`;
      const browserPathname = normalizeWebPathname(window.location.pathname ?? '/');
      const currentPathname = normalizeWebPathname(routerPathnameRef.current ?? '/');
      const initialPathname = normalizeWebPathname(expectedHref.split(/[?#]/, 1)[0] ?? '/');
      // A same-path Session rewrite can remove its Home before local list hydration.
      // A different path or an unrelated query change is a real navigation.
      if (currentHref !== expectedHref && (
        browserPathname !== initialPathname
        || !initialSessionServerIdRef.current
      )) {
        doneRef.current = true;
        return;
      }

      if (browserPathname === currentPathname) {
        const initialSessionServerId = initialSessionServerIdRef.current;
        if (initialSessionServerId) {
          const browserServerId = new URLSearchParams(window.location.search ?? '').get('serverId')?.trim() || null;
          const routerServerIdRaw = routerServerIdRef.current;
          const routerServerId = (Array.isArray(routerServerIdRaw) ? routerServerIdRaw[0] : routerServerIdRaw)?.trim() || null;
          if (browserServerId !== routerServerId || !browserServerId) {
            const search = new URLSearchParams(window.location.search ?? '');
            search.set('serverId', initialSessionServerId);
            router.replace(`${window.location.pathname}?${search.toString()}${window.location.hash ?? ''}` as Href);
            return;
          }
        }
        doneRef.current = true;
        return;
      }

      // Only reconcile when the browser path is a strict extension of the current router path.
      if (!isStrictWebPathExtension({ browserPathname, currentPathname })) return;

      router.replace(expectedHref as Href);
    };

    for (const delay of delaysMs) {
      timers.push(setTimeout(attempt, delay));
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
}
