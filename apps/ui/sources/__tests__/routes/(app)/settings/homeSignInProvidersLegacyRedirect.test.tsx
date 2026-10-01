import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerState = vi.hoisted(() => ({ params: {} as Record<string, string> }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const mock = createExpoRouterMock();
    return { ...mock.module, useLocalSearchParams: () => routerState.params };
});

async function redirectTargetFor(load: () => Promise<{ default: React.ComponentType }>, params: Record<string, string>): Promise<unknown> {
    routerState.params = params;
    const Route = (await load()).default;
    const screen = await renderScreen(<Route />);
    return screen.tree.root.findByType('Redirect' as never).props.href;
}

/**
 * Identity providers and GitHub Apps moved from Policies to the Sign-in providers page. Links saved
 * before the move (bookmarks, a pending OAuth return recorded on an older build) keep working.
 */
describe('Home identity destinations under Policies', () => {
    it('open the same identity provider pages under Sign-in providers', async () => {
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/identity/new'),
            { serverId: 'home 1' },
        )).toBe('/settings/home/home%201/sign-in-providers/identity/new');
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/identity/[providerId]/index'),
            { serverId: 'home-1', providerId: 'provider/1' },
        )).toBe('/settings/home/home-1/sign-in-providers/identity/provider%2F1');
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/identity/[providerId]/edit'),
            { serverId: 'home-1', providerId: 'provider-1' },
        )).toBe('/settings/home/home-1/sign-in-providers/identity/provider-1/edit');
    });

    it('keep the query a saved link carried, such as a search anchor', async () => {
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/identity/[providerId]/edit'),
            { serverId: 'home-1', providerId: 'provider-1', setting: 'homeAdministration.oidc.issuer' },
        )).toBe('/settings/home/home-1/sign-in-providers/identity/provider-1/edit?setting=homeAdministration.oidc.issuer');
    });

    it('open the same GitHub App pages under Sign-in providers', async () => {
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/github-apps/new'),
            { serverId: 'home-1' },
        )).toBe('/settings/home/home-1/sign-in-providers/github-apps/new');
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/github-apps/[registrationId]/index'),
            { serverId: 'home-1', registrationId: 'registration-1' },
        )).toBe('/settings/home/home-1/sign-in-providers/github-apps/registration-1');
        expect(await redirectTargetFor(
            () => import('@/app/(app)/settings/home/[serverId]/policies/github-apps/[registrationId]/edit'),
            { serverId: 'home-1', registrationId: 'registration-1' },
        )).toBe('/settings/home/home-1/sign-in-providers/github-apps/registration-1/edit');
    });
});
