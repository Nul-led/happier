import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';

import { InjectedAuthProvider, getCurrentAuth, useAuth, useOptionalAuth } from './AuthContext';

describe('injected auth context', () => {
    it('offers an absent auth projection without requiring an embedding provider', async () => {
        function Probe() { return React.createElement('AuthProbe', { auth: useOptionalAuth() }); }
        const screen = await renderScreen(<Probe />);
        expect(screen.root.findByType('AuthProbe').props.auth).toBeNull();
        await screen.unmount();
    });
    it('publishes only supplied credentials and refuses Account credential mutations', async () => {
        const credentials: AuthCredentials = { token: 'hap_v1_11111111-1111-4111-8111-111111111111_' + 'A'.repeat(43) };
        function Probe() {
            const auth = useAuth();
            return React.createElement('AuthProbe', { auth });
        }
        const screen = await renderScreen(<InjectedAuthProvider credentials={credentials}><Probe /></InjectedAuthProvider>);
        const auth = getCurrentAuth();
        expect(auth?.credentials).toBe(credentials);
        expect(auth?.isAuthenticated).toBe(true);
        expect(auth?.credentialAuthorityKind).toBe('api_token');
        await expect(auth?.loginWithCredentials({ token: 'another' })).rejects.toThrow('Injected credentials');
        await expect(auth?.logout()).rejects.toThrow('Injected credentials');
        await auth?.refreshFromActiveServer();
        expect(getCurrentAuth()?.credentials).toBe(credentials);
        await screen.unmount();
        expect(getCurrentAuth()).toBeNull();
    });
});
