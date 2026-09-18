import { describe, expect, it } from 'vitest';

import {
    getSettingsStackScreenDefinitions,
    resolveSettingsRouteParentPathname,
} from './settingsRouteRegistry';

const translate = (key: string) => key;

describe('settingsRouteRegistry', () => {
    it('adds deterministic parent navigation to settings subroute headers', () => {
        const definitions = getSettingsStackScreenDefinitions(translate as never);
        const indexRoute = definitions.find((definition) => definition.name === 'index');
        const sessionRoute = definitions.find((definition) => definition.name === 'session');

        expect(indexRoute?.options.headerLeft).toBeUndefined();
        expect(typeof sessionRoute?.options.headerLeft).toBe('function');
    });

    it('resolves route parent paths from the current settings pathname', () => {
        expect(resolveSettingsRouteParentPathname('/settings')).toBeNull();
        expect(resolveSettingsRouteParentPathname('/settings/session')).toBe('/settings');
        expect(resolveSettingsRouteParentPathname('/settings/session/transcript/advanced')).toBe('/settings/session/transcript');
        expect(resolveSettingsRouteParentPathname('/settings/prompts/docs/doc%2F1/export')).toBe('/settings/prompts/docs/doc%2F1');
        expect(resolveSettingsRouteParentPathname('/settings/plugins/examples.descriptor-only/settings')).toBe('/settings/plugins/examples.descriptor-only');
        expect(resolveSettingsRouteParentPathname('/session/s1')).toBeNull();
    });

    it('skips non-route identity collection segments when navigating Home administration', () => {
        expect(resolveSettingsRouteParentPathname('/settings/home/home-1/policies/identity/new'))
            .toBe('/settings/home/home-1/policies');
        expect(resolveSettingsRouteParentPathname('/settings/home/home-1/policies/identity/provider-1'))
            .toBe('/settings/home/home-1/policies');
        expect(resolveSettingsRouteParentPathname('/settings/home/home-1/policies/github-apps/new'))
            .toBe('/settings/home/home-1/policies');
        expect(resolveSettingsRouteParentPathname('/settings/home/home-1/policies/github-apps/registration-1'))
            .toBe('/settings/home/home-1/policies');

        expect(resolveSettingsRouteParentPathname('/settings/home/home-1/policies/identity/provider-1/edit'))
            .toBe('/settings/home/home-1/policies/identity/provider-1');
    });

    it('skips the non-route GitHub Apps collection when navigating Team authentication', () => {
        expect(resolveSettingsRouteParentPathname(
            '/settings/teams/home-1/team-1/authentication/github-apps/registration-1',
        )).toBe('/settings/teams/home-1/team-1/authentication');

        expect(resolveSettingsRouteParentPathname(
            '/settings/teams/home-1/team-1/authentication/github-apps/registration-1/edit',
        )).toBe('/settings/teams/home-1/team-1/authentication/github-apps/registration-1');
    });

    it('registers model-management and native plugin-panel routes', () => {
        const names = getSettingsStackScreenDefinitions(translate as never).map((definition) => definition.name);
        expect(names).toContain('providers/[connectionId]/models');
        expect(names).toContain('agents/[agentId]/models');
        expect(names).toContain('plugins/panels');
        expect(names).toContain('plugins/webhooks');
        expect(names).toContain('plugins/[pluginId]/[pageId]');
    });

    it('registers the marketplace sources route with its section chrome title', () => {
        const sourcesRoute = getSettingsStackScreenDefinitions(translate as never)
            .find((definition) => definition.name === 'plugins/sources');

        expect(sourcesRoute).toBeDefined();
        expect(sourcesRoute?.options.headerTitle).toBe('settingsPlugins.sourceAdministration.title');
    });

    it('registers machine pool create and edit routes in the settings stack', () => {
        const routes = getSettingsStackScreenDefinitions(translate as never);

        expect(routes.find((definition) => definition.name === 'machines/pools/new')?.options.headerTitle)
            .toBe('machinePools.add');
        expect(routes.find((definition) => definition.name === 'machines/pools/[poolId]')?.options.headerTitle)
            .toBe('machinePools.title');
    });

    it('registers every Home administration and core Team destination in the settings stack', () => {
        const names = getSettingsStackScreenDefinitions(translate as never)
            .map((definition) => definition.name);

        expect(names).toEqual(expect.arrayContaining([
            'home/index',
            'home/[serverId]/index',
            'home/[serverId]/people',
            'home/[serverId]/people/[accountId]',
            'home/[serverId]/policies',
            'home/[serverId]/teams',
            'home/[serverId]/policies/identity/new',
            'home/[serverId]/policies/identity/[providerId]/index',
            'home/[serverId]/policies/identity/[providerId]/edit',
            'home/[serverId]/policies/github-apps/new',
            'home/[serverId]/policies/github-apps/[registrationId]/index',
            'home/[serverId]/policies/github-apps/[registrationId]/edit',
            'teams/index',
            'teams/new',
            'teams/[serverId]/[teamId]/index',
            'teams/[serverId]/[teamId]/members/index',
            'teams/[serverId]/[teamId]/members/add',
            'teams/[serverId]/[teamId]/members/[membershipId]',
            'teams/[serverId]/[teamId]/groups/index',
            'teams/[serverId]/[teamId]/groups/new',
            'teams/[serverId]/[teamId]/groups/[groupId]',
            'teams/[serverId]/[teamId]/invitations/index',
            'teams/[serverId]/[teamId]/invitations/new',
            'teams/[serverId]/[teamId]/settings',
            'teams/[serverId]/[teamId]/authentication',
            'teams/[serverId]/[teamId]/authentication/new',
            'teams/[serverId]/[teamId]/authentication/[connectionId]',
            'teams/[serverId]/[teamId]/authentication/[connectionId]/edit',
            'teams/[serverId]/[teamId]/authentication/directory',
            'teams/[serverId]/[teamId]/authentication/directory/[sourceId]',
        ]));
    });

    it('registers each Voice intent as a nested settings destination', () => {
        const names = getSettingsStackScreenDefinitions(translate as never).map((definition) => definition.name);

        expect(names).toEqual(expect.arrayContaining([
            'voice/dictation',
            'voice/conversations',
            'voice/privacy',
            'voice/advanced',
        ]));
    });
});
