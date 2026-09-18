import type { ApiSessionClient, ApiSessionClientOptions } from '@/api/session/sessionClient';
import { createAccountSessionClientTransport } from '@/api/client/createAccountSessionClientTransport';
import type { Session } from '@/api/types';
import { readStoredCredentials } from '@/persistence';

/** Exercises the ordinary Account composition against each test's OS/network boundaries. */
export function createTestApiSessionClient(
    SessionClient: typeof ApiSessionClient,
    token: string,
    session: Session,
    options: Partial<ApiSessionClientOptions> = {},
): ApiSessionClient {
    return new SessionClient(token, session, {
        transport: createAccountSessionClientTransport(token),
        metadataAuthority: {
            kind: 'owner',
            credentials: { token, encryption: null },
            readCurrentCredentials: readStoredCredentials,
        },
        ...options,
    });
}
