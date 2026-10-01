import { describe, expect, it } from 'vitest';

import {
    areRunnerManagedProviderRetainedAuthoritiesEqual,
    mergeRunnerManagedDependencyRetentionV1,
    RunnerManagedProviderRetainedAuthorityV1Schema,
} from './runnerManagedDependencyRetention';

const bundledAuthority = Object.freeze({
    pluginId: 'acme.provider',
    sourceCustody: Object.freeze({
        kind: 'managed' as const,
        immutableGenerationId: 'provider-generation-p',
        installSource: 'npm' as const,
    }),
    manifestAuthority: 'bundled_first_party' as const,
    hardRevocationRevisionAtAdmission: 7,
});

describe('Runner managed Provider retained authority', () => {
    it('strictly requires and preserves the private Provider source class', () => {
        expect(
            RunnerManagedProviderRetainedAuthorityV1Schema.safeParse({
                pluginId: bundledAuthority.pluginId,
                sourceCustody: bundledAuthority.sourceCustody,
                hardRevocationRevisionAtAdmission:
                    bundledAuthority.hardRevocationRevisionAtAdmission,
            }).success,
        ).toBe(false);
        expect(
            RunnerManagedProviderRetainedAuthorityV1Schema.parse(
                bundledAuthority,
            ),
        ).toEqual(bundledAuthority);
        expect(mergeRunnerManagedDependencyRetentionV1({
            v: 1,
            adoptedManagedProviderAuthority: bundledAuthority,
            sourceCustodies: [],
            qualifiedDependencyIds: [],
        }).adoptedManagedProviderAuthority).toEqual(bundledAuthority);
    });

    it('treats differing Provider source classes as different authorities', () => {
        expect(areRunnerManagedProviderRetainedAuthoritiesEqual(
            bundledAuthority,
            {
                ...bundledAuthority,
                manifestAuthority: 'external',
            },
        )).toBe(false);
        expect(() => mergeRunnerManagedDependencyRetentionV1(
            {
                v: 1,
                adoptedManagedProviderAuthority: bundledAuthority,
                sourceCustodies: [],
                qualifiedDependencyIds: [],
            },
            {
                v: 1,
                adoptedManagedProviderAuthority: {
                    ...bundledAuthority,
                    sourceCustody: {
                        kind: 'bundled_first_party',
                        packagedRuntime: {
                            kind: 'pinned_runner_snapshot',
                            snapshotId: 'provider-generation-p',
                        },
                    },
                    manifestAuthority: 'external',
                },
                sourceCustodies: [],
                qualifiedDependencyIds: [],
            },
        )).toThrow(
            'Runner retention cannot merge competing adopted Provider authorities',
        );
    });
});
