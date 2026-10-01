import type { PageHeaderMetaFact } from '@/components/ui/layout/PageHeader';
import { t } from '@/text';

type AccountEncryptionAnswer =
    | Readonly<{ kind: 'loading' }>
    | Readonly<{ kind: 'unavailable' }>
    | Readonly<{ kind: 'ready'; projection: Readonly<{ encryptionMode: 'plain' | 'e2ee' }> }>;

/**
 * The Account's distinguishing facts, under its identifier on the Account page. The encryption fact
 * always holds its line: it states the mode once the Account answers and claims neither before.
 */
export function resolveAccountIdentityFacts(input: Readonly<{
    username: string | null | undefined;
    homeName: string | null | undefined;
    security: AccountEncryptionAnswer;
}>): PageHeaderMetaFact[] {
    const { security } = input;
    return [
        ...(input.username ? [{ key: 'handle', text: `@${input.username}` }] : []),
        ...(input.homeName ? [{ key: 'home', text: input.homeName }] : []),
        encryptionFact(security),
    ];
}

function encryptionFact(security: AccountEncryptionAnswer): PageHeaderMetaFact {
    const testID = 'settings-account-encryption-fact';
    if (security.kind === 'ready') {
        return security.projection.encryptionMode === 'e2ee'
            ? { key: 'encryption', icon: 'lock', text: t('settingsAccount.endToEndEncrypted'), testID }
            : { key: 'encryption', icon: 'lock-open', text: t('settingsAccount.notEndToEndEncrypted'), testID };
    }
    // Only the Account's answer states a mode; until then the fact holds its line and claims neither.
    return {
        key: 'encryption',
        text: t(security.kind === 'loading' ? 'settingsAccount.encryptionFactChecking' : 'settingsAccount.encryptionFactUnread'),
        testID,
    };
}
