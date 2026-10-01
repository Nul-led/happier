import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { renderScreen } from '@/dev/testkit/render/renderScreen';
import { standardCleanup } from '@/dev/testkit/cleanup/standardCleanup';

// Locale is an environment boundary; these contracts exercise routes/commands, not translation loading.
vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock();
});

const route = createExpoRouterMock();
vi.mock('expo-router', () => route.module);
// Credentials are an external boundary; the legacy index must settle while signed out.
vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: false }),
}));

describe('/setup', () => {
    afterEach(standardCleanup);
    it('returns to Home without mounting setup or requiring authentication', async () => {
        const Screen = (await import('@/app/(app)/setup/index')).default;
        const screen = await renderScreen(<Screen />);
        expect(screen.findByType('Redirect').props.href).toBe('/');
    });
});
