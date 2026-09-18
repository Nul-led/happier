import type { TeamIdentityConnectionSettingsV1 } from '@happier-dev/protocol/teams';

export type OidcConnectionSettingsDraft = Readonly<{
    allowedUsers: string;
    allowedEmailDomains: string;
    groupsAny: string;
    groupsAll: string;
}>;

export function parseIdentityList(value: string): string[] {
    return [...new Set(value.split(/[\n,]/u).map((item) => item.trim()).filter(Boolean))];
}

export function connectionSettingsFromDraft(draft: OidcConnectionSettingsDraft): TeamIdentityConnectionSettingsV1 {
    return {
        v: 1,
        kind: 'oidc',
        allowedUsers: parseIdentityList(draft.allowedUsers),
        allowedEmailDomains: parseIdentityList(draft.allowedEmailDomains),
        groupsAny: parseIdentityList(draft.groupsAny),
        groupsAll: parseIdentityList(draft.groupsAll),
    };
}
