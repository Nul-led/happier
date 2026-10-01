import { describe, expect, it } from 'vitest';

import {
    resolveAlreadyUseHappierOffer,
    resolveHomesReconcileOffer,
    resolveServiceHomeStorage,
    type JourneyHome,
} from './homesJourneyModel';

const personal: JourneyHome = { id: 'personal', createdAt: 1_000, signedIn: true, personalHomeOnThisDevice: true };
const studio: JourneyHome = { id: 'studio', createdAt: 5_000, signedIn: true, personalHomeOnThisDevice: false };
const acme: JourneyHome = { id: 'acme', createdAt: 6_000, signedIn: true, personalHomeOnThisDevice: false };

describe('resolveAlreadyUseHappierOffer', () => {
    it('offers the doorway on a computer whose only Home is the one it made for itself', () => {
        expect(resolveAlreadyUseHappierOffer({ canHostPersonalHome: true, homes: [personal] })).toBe(true);
    });

    it('offers it while the Personal Home is still being prepared (no Home saved yet)', () => {
        expect(resolveAlreadyUseHappierOffer({ canHostPersonalHome: true, homes: [] })).toBe(true);
    });

    it('leaves once this device is signed in to any other Home', () => {
        expect(resolveAlreadyUseHappierOffer({ canHostPersonalHome: true, homes: [personal, studio] })).toBe(false);
    });

    it('ignores a saved Home this device was never signed in to', () => {
        const seeded: JourneyHome = { ...studio, signedIn: false };
        expect(resolveAlreadyUseHappierOffer({ canHostPersonalHome: true, homes: [personal, seeded] })).toBe(true);
    });

    it('is never offered where no Personal Home can run (a phone uses its welcome screen)', () => {
        expect(resolveAlreadyUseHappierOffer({ canHostPersonalHome: false, homes: [] })).toBe(false);
    });
});

describe('resolveHomesReconcileOffer', () => {
    it('offers the Homes signed in after this device made its Personal Home', () => {
        expect(resolveHomesReconcileOffer({ homes: [personal, studio, acme], acknowledgedHomeIds: [] }))
            .toEqual({ personalHomeId: 'personal', foundHomeIds: ['studio', 'acme'] });
    });

    it('has nothing to reconcile without a Personal Home on this device (upgraded installs keep their Home)', () => {
        expect(resolveHomesReconcileOffer({ homes: [studio, acme], acknowledgedHomeIds: [] })).toBeNull();
    });

    it('never counts Homes this device already used before it made its Personal Home', () => {
        const earlier: JourneyHome = { ...studio, createdAt: 500 };
        expect(resolveHomesReconcileOffer({ homes: [personal, earlier], acknowledgedHomeIds: [] })).toBeNull();
    });

    it('stays settled once the person has chosen, and returns only for a Home added after that', () => {
        expect(resolveHomesReconcileOffer({ homes: [personal, studio], acknowledgedHomeIds: ['studio'] })).toBeNull();
        expect(resolveHomesReconcileOffer({ homes: [personal, studio, acme], acknowledgedHomeIds: ['studio'] }))
            .toEqual({ personalHomeId: 'personal', foundHomeIds: ['acme'] });
    });

    it('waits for a sign-in to be confirmed before offering a Home', () => {
        const unconfirmed: JourneyHome = { ...studio, signedIn: false };
        expect(resolveHomesReconcileOffer({ homes: [personal, unconfirmed], acknowledgedHomeIds: [] })).toBeNull();
    });
});

describe('resolveServiceHomeStorage', () => {
    const encryption = (storagePolicy: 'required_e2ee' | 'optional' | 'plaintext_only', defaultAccountMode: 'e2ee' | 'plain') => ({
        storagePolicy, defaultAccountMode, allowAccountOptOut: storagePolicy === 'optional',
        plainAccountSettingsAtRest: 'server_sealed' as const, plainAccountCredentialsAtRest: 'server_sealed' as const,
    });

    it('follows the Account mode the service can create: always end-to-end, never, or by default', () => {
        expect(resolveServiceHomeStorage(encryption('required_e2ee', 'e2ee'))).toBe('e2ee');
        expect(resolveServiceHomeStorage(encryption('plaintext_only', 'plain'))).toBe('plain');
        expect(resolveServiceHomeStorage(encryption('optional', 'e2ee'))).toBe('e2ee_by_default');
        expect(resolveServiceHomeStorage(encryption('optional', 'plain'))).toBe('plain_by_default');
    });

    it('says nothing about storage when the service has not said', () => {
        expect(resolveServiceHomeStorage(undefined)).toBeNull();
    });
});
