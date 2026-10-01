import { describe, expect, it } from 'vitest';

import { t } from '@/text';

import { resolveAccountIdentityFacts } from './accountIdentityFacts';

const encryptionFact = (facts: ReturnType<typeof resolveAccountIdentityFacts>) =>
    facts?.find((fact) => fact.key === 'encryption');

describe('Account identity facts', () => {
    it('states the encryption mode only from the Account answer', () => {
        const plain = resolveAccountIdentityFacts({
            username: 'lee', homeName: 'Studio',
            security: { kind: 'ready', projection: { encryptionMode: 'plain' } },
        });
        expect(plain?.map((fact) => fact.text)).toEqual(['@lee', 'Studio', t('settingsAccount.notEndToEndEncrypted')]);
        expect(encryptionFact(resolveAccountIdentityFacts({
            username: null, homeName: null,
            security: { kind: 'ready', projection: { encryptionMode: 'e2ee' } },
        }))).toMatchObject({ icon: 'lock', text: t('settingsAccount.endToEndEncrypted') });
    });

    it('holds the encryption fact while it loads and when the Home cannot be read, claiming neither mode', () => {
        const loading = encryptionFact(resolveAccountIdentityFacts({ username: null, homeName: null, security: { kind: 'loading' } }));
        const unread = encryptionFact(resolveAccountIdentityFacts({ username: null, homeName: 'Studio', security: { kind: 'unavailable' } }));
        expect(loading).toMatchObject({ testID: 'settings-account-encryption-fact', text: t('settingsAccount.encryptionFactChecking') });
        expect(unread).toMatchObject({ testID: 'settings-account-encryption-fact', text: t('settingsAccount.encryptionFactUnread') });
        for (const fact of [loading, unread]) {
            expect(fact?.text).not.toBe(t('settingsAccount.endToEndEncrypted'));
            expect(fact?.text).not.toBe(t('settingsAccount.notEndToEndEncrypted'));
        }
    });
});
