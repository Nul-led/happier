import { describe, expect, it } from 'vitest';
import type { ProjectedAuthenticationCatalog } from '@happier-dev/cli-common/authentication/authMethodCatalog';

import type { VerifiedAccountServiceAuthority } from '@/auth/accountDirectory/accountDirectoryAuthClient';
import { buildServerFeaturesResponse } from '@/hooks/server/serverFeaturesTestUtils';

import { composeWelcomeEntryModel, type WelcomeAuthenticationMethod } from './composeWelcomeEntryModel';

const target = { kind: 'saved_profile', profileRef: 'home-a' } as const;
const method = (id: string, actionId: 'login' | 'provision', mode: 'keyed' | 'keyless'): WelcomeAuthenticationMethod => ({
    method: { id, enabledActions: [{ id: actionId, mode }] } satisfies ProjectedAuthenticationCatalog['methods'][number],
    action: { id: actionId, mode },
    execution: id === 'key_challenge'
        ? actionId === 'provision' ? { kind: 'generated_key' } : { kind: 'key_entry' }
        : id === 'mtls'
            ? { kind: 'mtls' }
            : { kind: 'oauth', providerId: id, mode },
    authority: { purpose: 'home', target },
    intendedHome: target,
});

describe('composeWelcomeEntryModel', () => {
    it('keeps Home actions live while optional service discovery is loading', () => {
        const model = composeWelcomeEntryModel({
            target: { kind: 'selected_home', home: target, label: 'Home A' },
            homeMethods: [method('key_challenge', 'provision', 'keyed'), method('github', 'login', 'keyless')],
            context: { kind: 'home' },
            allowedNavigation: { changeHome: true, selectService: false, scanOrPasteHome: true, createPersonalHome: false },
            serviceCatalogState: { kind: 'loading', hintName: 'Happier' },
            userHistory: 'first_time',
        });

        expect(model.actions.map((row) => row.action.kind)).toEqual([
            'authenticate', 'authenticate', 'scan_or_paste_home', 'choose_home',
        ]);
        expect(model.actions.filter((row) => row.emphasis === 'primary')).toHaveLength(1);
        expect(model.notice).toEqual({ kind: 'service_loading', serviceName: 'Happier' });
    });

    it('preserves every service provider and its exact authority tuple', () => {
        const features = buildServerFeaturesResponse();
        const authority = {
            endpointUrl: 'https://accounts.example.test',
            serverIdentityId: 'service-a',
            canonicalServerUrl: 'https://accounts.example.test',
            capability: {
                version: 1 as const,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: {
                    keyId: 'a'.repeat(64),
                    publicKeyBase64Url: 'A'.repeat(43),
                },
            },
            snapshot: {
                status: 'ready' as const,
                serverIdentityId: 'service-a',
                features: {
                    ...features,
                    capabilities: {
                        ...features.capabilities,
                        accountDirectory: {
                            version: 1 as const,
                            homeDirectory: true,
                            homeEnrollment: true,
                            homeLoginAssertion: {
                                keyId: 'a'.repeat(64),
                                publicKeyBase64Url: 'A'.repeat(43),
                            },
                        },
                        server: { canonicalServerUrl: 'https://accounts.example.test' },
                        serverIdentity: { serverIdentityId: 'service-a' },
                    },
                },
            },
        } satisfies VerifiedAccountServiceAuthority;
        const serviceMethod = (id: string): WelcomeAuthenticationMethod => ({
            method: { id, enabledActions: [{ id: 'login', mode: 'keyless' }] },
            action: { id: 'login', mode: 'keyless' },
            execution: { kind: 'oauth', providerId: id, mode: 'keyless' },
            authority: { purpose: 'account_service', service: authority },
            intendedHome: target,
        });
        const model = composeWelcomeEntryModel({
            target: { kind: 'explicit_home', home: target, label: 'Home A' },
            homeMethods: [],
            context: { kind: 'home' },
            allowedNavigation: { changeHome: false, selectService: false, scanOrPasteHome: true, createPersonalHome: false },
            serviceCatalogState: { kind: 'ready', authority, name: 'Acme', methods: [serviceMethod('github'), serviceMethod('google')] },
            userHistory: 'returning',
        });

        expect(model.actions.slice(1).map((row) => row.action.kind === 'authenticate' ? row.action.request.method.id : row.action.kind))
            .toEqual(['github', 'google']);
        expect(model.actions[1]?.id).toContain('service:service-a:https://accounts.example.test|account_service|github|login|keyless');
    });

    describe('same-server dual-role dedupe', () => {
        const selfAuthority = (serverIdentityId: string): VerifiedAccountServiceAuthority => {
            const features = buildServerFeaturesResponse();
            const capability = {
                version: 1 as const,
                homeDirectory: true,
                homeEnrollment: true,
                homeLoginAssertion: { keyId: 'a'.repeat(64), publicKeyBase64Url: 'A'.repeat(43) },
            };
            return {
                endpointUrl: 'https://home-a.example.test',
                serverIdentityId,
                canonicalServerUrl: 'https://home-a.example.test',
                capability,
                snapshot: {
                    status: 'ready' as const,
                    serverIdentityId,
                    features: {
                        ...features,
                        capabilities: {
                            ...features.capabilities,
                            accountDirectory: capability,
                            server: { canonicalServerUrl: 'https://home-a.example.test' },
                            serverIdentity: { serverIdentityId },
                        },
                    },
                },
            };
        };
        const serviceMethod = (
            authority: VerifiedAccountServiceAuthority,
            id: string,
            execution: WelcomeAuthenticationMethod['execution'] = { kind: 'oauth', providerId: id, mode: 'keyless' },
            actionId: 'login' | 'provision' = 'login',
            mode: 'keyed' | 'keyless' = 'keyless',
        ): WelcomeAuthenticationMethod => ({
            method: { id, enabledActions: [{ id: actionId, mode }] },
            action: { id: actionId, mode },
            execution: execution as never,
            authority: { purpose: 'account_service', service: authority },
            intendedHome: target,
        });
        const methodIds = (model: ReturnType<typeof composeWelcomeEntryModel>) => model.actions
            .filter((row) => row.action.kind === 'authenticate')
            .map((row) => row.action.kind === 'authenticate'
                ? `${row.action.request.authority.purpose}:${row.action.request.method.id}:${row.action.request.action.id}`
                : row.action.kind);

        it('keeps the direct Home row and drops the identical same-server service row', () => {
            const authority = selfAuthority('identity-home-a');
            const model = composeWelcomeEntryModel({
                target: { kind: 'selected_home', home: target, label: 'Home A' },
                homeMethods: [method('github', 'login', 'keyless'), method('key_challenge', 'login', 'keyed')],
                observedHomeServerIdentityId: 'identity-home-a',
                context: { kind: 'home' },
                allowedNavigation: { changeHome: false, selectService: false, scanOrPasteHome: false, createPersonalHome: false },
                serviceCatalogState: {
                    kind: 'ready', authority, name: 'Home A',
                    methods: [serviceMethod(authority, 'github'), serviceMethod(authority, 'google')],
                },
                userHistory: 'returning',
            });

            expect(methodIds(model)).toEqual([
                'home:github:login',
                'home:key_challenge:login',
                'account_service:google:login',
            ]);
        });

        it('never dedupes across distinct server identities or distinct method/action/mode/execution', () => {
            const foreign = selfAuthority('identity-service-b');
            const model = composeWelcomeEntryModel({
                target: { kind: 'selected_home', home: target, label: 'Home A' },
                homeMethods: [method('github', 'login', 'keyless')],
                observedHomeServerIdentityId: 'identity-home-a',
                context: { kind: 'home' },
                allowedNavigation: { changeHome: false, selectService: false, scanOrPasteHome: false, createPersonalHome: false },
                serviceCatalogState: { kind: 'ready', authority: foreign, name: 'Service B', methods: [serviceMethod(foreign, 'github')] },
                userHistory: 'returning',
            });
            expect(methodIds(model)).toEqual(['home:github:login', 'account_service:github:login']);

            const self = selfAuthority('identity-home-a');
            const distinct = composeWelcomeEntryModel({
                target: { kind: 'selected_home', home: target, label: 'Home A' },
                homeMethods: [method('key_challenge', 'login', 'keyed'), method('github', 'provision', 'keyed')],
                observedHomeServerIdentityId: 'identity-home-a',
                context: { kind: 'home' },
                allowedNavigation: { changeHome: false, selectService: false, scanOrPasteHome: false, createPersonalHome: false },
                serviceCatalogState: {
                    kind: 'ready', authority: self, name: 'Home A',
                    methods: [
                        // Same method id but a provisioning action the Home does not offer for it.
                        serviceMethod(self, 'key_challenge', { kind: 'generated_key' }, 'provision', 'keyed'),
                        // Same provider id, different mode.
                        serviceMethod(self, 'github', { kind: 'oauth', providerId: 'github', mode: 'keyless' }, 'provision', 'keyless'),
                    ],
                },
                userHistory: 'returning',
            });
            expect(methodIds(distinct)).toEqual([
                'home:key_challenge:login',
                'account_service:key_challenge:provision',
                'account_service:github:provision',
                'home:github:provision',
            ]);
        });
    });
});
