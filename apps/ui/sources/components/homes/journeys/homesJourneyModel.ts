/** The part of a service's advertised encryption capabilities that decides how its Homes store data. */
type ServiceEncryption = Readonly<{
    storagePolicy: 'required_e2ee' | 'optional' | 'plaintext_only';
    defaultAccountMode: 'e2ee' | 'plain';
}>;

/**
 * One saved Home as the Homes journeys see it: when this device saved it, whether this device is
 * confirmed signed in to it (`unknown` counts as not yet), and whether it is the Personal Home this
 * device made for itself.
 */
export type JourneyHome = Readonly<{
    id: string;
    createdAt: number;
    signedIn: boolean;
    personalHomeOnThisDevice: boolean;
}>;

function otherSignedInHomes(homes: readonly JourneyHome[]): JourneyHome[] {
    return homes.filter((home) => home.signedIn && !home.personalHomeOnThisDevice);
}

/**
 * "Already use Happier?" (Direction B): shown on a computer that can run its own Personal Home for
 * as long as that is the only Home it uses — including while it is still being prepared. Once this
 * device is signed in to any other Home, the doorway has done its job and leaves (the reconcile
 * offer takes over). A saved Home this device never signed in to does not count.
 */
export function resolveAlreadyUseHappierOffer(input: Readonly<{
    canHostPersonalHome: boolean;
    homes: readonly JourneyHome[];
}>): boolean {
    if (!input.canHostPersonalHome) return false;
    return otherSignedInHomes(input.homes).length === 0;
}

export type HomesReconcileOffer = Readonly<{ personalHomeId: string; foundHomeIds: readonly string[] }>;

/**
 * After a sign-in finds Homes (J2): the Homes this device signed in to after it made its Personal
 * Home, not yet settled by the person's choice. Upgraded installs have no Personal Home made here
 * (or made it after their Homes) and so never see it; "Keep both" / "Use …" records the Homes it
 * settled, and only a Home added later brings it back.
 */
export function resolveHomesReconcileOffer(input: Readonly<{
    homes: readonly JourneyHome[];
    acknowledgedHomeIds: readonly string[];
}>): HomesReconcileOffer | null {
    const personal = input.homes.find((home) => home.personalHomeOnThisDevice);
    if (!personal) return null;
    const acknowledged = new Set(input.acknowledgedHomeIds);
    const found = otherSignedInHomes(input.homes)
        .filter((home) => home.createdAt >= personal.createdAt && !acknowledged.has(home.id))
        .map((home) => home.id);
    return found.length > 0 ? { personalHomeId: personal.id, foundHomeIds: found } : null;
}

/**
 * How a Home on a sign-in service stores sessions, from the Account modes the service creates: always
 * end-to-end encrypted, never, or one of the two by default (the person chooses at sign-up).
 */
export type ServiceHomeStorage = 'e2ee' | 'plain' | 'e2ee_by_default' | 'plain_by_default';

export function resolveServiceHomeStorage(encryption: ServiceEncryption | undefined): ServiceHomeStorage | null {
    if (!encryption) return null;
    switch (encryption.storagePolicy) {
        case 'required_e2ee':
            return 'e2ee';
        case 'plaintext_only':
            return 'plain';
        case 'optional':
            return encryption.defaultAccountMode === 'e2ee' ? 'e2ee_by_default' : 'plain_by_default';
    }
}
