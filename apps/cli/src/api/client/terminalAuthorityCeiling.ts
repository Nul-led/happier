import type { AxiosInstance } from 'axios';
import { AUTHORITY_CEILING_HEADER_V1 } from '@happier-dev/protocol/actions/invocationAuthority';
import { resolveEffectiveTerminalPresentUserPolicy } from '@/settings/accountSettings/resolveEffectiveTerminalPresentUserPolicy';
import { resolveServerHttpBaseUrl } from './serverHttpBaseUrl';

/** Installs the narrowing policy at the process's existing Axios boundary. */
export function installTerminalAuthorityCeiling(client: AxiosInstance): () => void {
  const interceptor = client.interceptors.request.use((request) => {
    const authorization = request.headers.get('Authorization');
    const token = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/u.exec(authorization)?.[1] : undefined;
    const isDaemonControl = typeof request.headers.get('x-happier-daemon-token') === 'string';
    if (!token && !isDaemonControl) return request;
    let policy = resolveEffectiveTerminalPresentUserPolicy();
    if (token) {
      const serverHttpBaseUrl = resolveServerHttpBaseUrl();
      try {
        const destination = new URL(request.url ?? '', request.baseURL);
        const home = new URL(serverHttpBaseUrl);
        const homePath = home.pathname.replace(/\/+$/u, '');
        if (destination.origin === home.origin
          && (destination.pathname === homePath || destination.pathname.startsWith(`${homePath}/`))) {
          policy = resolveEffectiveTerminalPresentUserPolicy({ token, serverHttpBaseUrl });
        }
      } catch { /* Axios owns malformed destination handling. */ }
    }
    if (policy === 'disallowed') request.headers.set(AUTHORITY_CEILING_HEADER_V1, 'account_automation');
    return request;
  });
  return () => client.interceptors.request.eject(interceptor);
}
