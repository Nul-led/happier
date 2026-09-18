import type { AccountDisplayProfileV1 } from '@happier-dev/protocol';
import type {
    HomeAccountPickerRowV1,
    HomeAccountRowV1,
    HomeGovernancePolicyProjectionV1,
    HomeGovernanceProjectionV1,
} from '@happier-dev/protocol/home/governance';

/**
 * The Home answers the Home Administration suites share.
 *
 * These are the shapes a Home actually returns, so they travel through the same
 * strict schemas the app parses: a contract change fails these suites rather
 * than being absorbed by a per-file literal that drifted.
 */
export function homeGovernanceProjectionFixture(
    overrides?: Partial<HomeGovernanceProjectionV1>,
): HomeGovernanceProjectionV1 {
    return {
        viewer: { accountId: 'account-ada', homeRole: 'owner', status: 'active' },
        capabilities: {
            viewAdministration: true,
            manageAccounts: true,
            manageHomeRoles: true,
            manageTeamCreationPolicy: true,
            manageAuthentication: true,
            eraseAccounts: true,
            createTeam: true,
            manageAllTeams: true,
        },
        policy: {
            revision: 1,
            teamCreationPolicy: 'managed_only',
            authentication: { status: 'inherited' },
            teamProviders: { status: 'inherited' },
            identityNetwork: { status: 'inherited' },
        },
        setupState: 'owned',
        activeOwnerCount: 2,
        teamsEnabled: true,
        authenticationOptions: {
            methods: [],
            permittedAccountModes: ['e2ee'],
            recommendedProvisioningMode: 'e2ee',
            signInService: { deploymentMode: null, canDisable: false },
        },
        ...overrides,
    };
}

/**
 * The neutral presentation fields exactly as the strict Account profile schema
 * defines them. A row built any other way is one no Home could ever send.
 */
export function accountDisplayProfileFixture(
    firstName: string,
    overrides?: Partial<AccountDisplayProfileV1>,
): AccountDisplayProfileV1 {
    return {
        firstName,
        lastName: null,
        username: null,
        avatarUrl: null,
        ...overrides,
    };
}

/** The policy document a Home returns from its one policy mutation. */
export function homeGovernancePolicyProjectionFixture(
    overrides?: Partial<HomeGovernancePolicyProjectionV1>,
): HomeGovernancePolicyProjectionV1 {
    return { ...homeGovernanceProjectionFixture().policy, ...overrides };
}

export function homeAccountRowFixture(
    accountId: string,
    overrides?: Partial<HomeAccountRowV1>,
): HomeAccountRowV1 {
    return {
        accountId,
        homeRole: 'member',
        status: 'active',
        profile: accountDisplayProfileFixture(accountId),
        createdAt: 1,
        authentication: {
            signInEmail: null,
            usableMethodIds: [],
        },
        mutationCapabilities: {
            setRole: {
                member: { status: 'unavailable', reason: 'unchanged' },
                admin: { status: 'available' },
                owner: { status: 'available' },
            },
            disable: { status: 'available' },
            reenable: { status: 'unavailable', reason: 'target_not_suspended' },
            delete: { status: 'available' },
        },
        ...overrides,
    };
}

export function homeAccountPickerRowFixture(
    accountId: string,
    firstName: string,
): HomeAccountPickerRowV1 {
    return {
        accountId,
        profile: accountDisplayProfileFixture(firstName),
        eligible: true,
    };
}
