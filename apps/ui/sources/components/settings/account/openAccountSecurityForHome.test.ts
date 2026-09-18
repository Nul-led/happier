import { beforeEach, expect, it, vi } from 'vitest';

import { openAccountSecurityForHome } from './openAccountSecurityForHome';

const boundary = vi.hoisted(() => ({
    setActiveServerAndSwitch: vi.fn(),
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    setActiveServerAndSwitch: boundary.setActiveServerAndSwitch,
}));

beforeEach(() => {
    boundary.setActiveServerAndSwitch.mockReset();
});

it('refreshes the authenticated Account before opening Security when the exact Home is already active', async () => {
    boundary.setActiveServerAndSwitch.mockResolvedValueOnce('already_active');
    const refreshAuth = vi.fn(async () => {});
    const replace = vi.fn();

    await expect(openAccountSecurityForHome({
        serverId: 'home-a',
        router: { replace },
        refreshAuth,
        intent: 'email_password_connect',
        verificationToken: 'verify-home-a',
    })).resolves.toBe(true);

    expect(boundary.setActiveServerAndSwitch).toHaveBeenCalledWith({
        serverId: 'home-a',
        scope: 'device',
        refreshAuth,
        requireExactProfile: true,
    });
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledWith({
        pathname: '/settings/account/security',
        params: {
            serverId: 'home-a',
            intent: 'email_password_connect',
            verificationToken: 'verify-home-a',
        },
    });
});

it('does not refresh or navigate when retained credential custody blocks the switch', async () => {
    boundary.setActiveServerAndSwitch.mockResolvedValueOnce('blocked');
    const refreshAuth = vi.fn(async () => {});
    const replace = vi.fn();

    await expect(openAccountSecurityForHome({
        serverId: 'home-a',
        router: { replace },
        refreshAuth,
    })).resolves.toBe(false);

    expect(refreshAuth).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
});
