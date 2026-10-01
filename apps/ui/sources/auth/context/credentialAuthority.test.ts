import { describe, expect, it } from 'vitest';
import { readCredentialAuthorityKind } from './credentialAuthority';

const tokenFor = (payload: object) => `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

describe('installed credential authority projection', () => {
    it('retains current and released account/terminal kinds without trusting caller authority', () => {
        expect(readCredentialAuthorityKind(tokenFor({ sub: 'account-a' }))).toBe('account');
        expect(readCredentialAuthorityKind(tokenFor({ sub: 'account-a', session: 'released-terminal' }))).toBe('terminal');
        expect(readCredentialAuthorityKind(tokenFor({ sub: 'account-a', provenance: {
            v: 1, kind: 'terminal', authority: 'account_automation',
        } }))).toBe('terminal');
        expect(readCredentialAuthorityKind('hap_v1_11111111-1111-4111-8111-111111111111_' + 'A'.repeat(43))).toBe('api_token');
    });

    it('fails unsupported signed kinds, malformed bearers and future structured provenance closed', () => {
        for (const provenance of [
            { v: 1, kind: 'account_directory', authority: 'present_user' },
            { v: 1, kind: 'ephemeral_session_runner', authority: 'session_runtime' },
            { v: 1, kind: 'terminal', authority: 'present_user' },
            { v: 3, kind: 'account', authority: 'present_user' },
        ]) expect(readCredentialAuthorityKind(tokenFor({ sub: 'account-a', provenance }))).toBe('none');
        expect(readCredentialAuthorityKind(tokenFor({ provenance: { v: 1, kind: 'account', authority: 'present_user' } }))).toBe('none');
        expect(readCredentialAuthorityKind('malformed-bearer')).toBe('none');
        expect(readCredentialAuthorityKind(null)).toBe('none');
    });
});
