import * as React from 'react';
import { FieldTextInput, type FieldTextInputProps } from '@/components/ui/forms/FieldTextInput';
import { Switch } from '@/components/ui/forms/Switch';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { ExpandableItem } from '@/components/ui/lists/ExpandableItem';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { SettingAnchor, SettingRow, SettingSection } from '@/components/settings/shell/SettingRow';
import { HOME_MANAGED_OIDC_SETTINGS, TEAM_MANAGED_OIDC_SETTINGS } from '@/components/settings/identity/identitySettings';
import { t } from '@/text';
import type { ManagedOidcProviderDraft, validateManagedIdentityProviderDraft } from './managedOidcProviderDraft';

export type ManagedOidcProviderInputRefs = Readonly<Partial<Record<keyof ManagedOidcProviderDraft, React.RefObject<{ focus(): void } | null>>>>;
type Validation = ReturnType<typeof validateManagedIdentityProviderDraft>;
type TextDraftKey = Exclude<keyof ManagedOidcProviderDraft, 'fetchUserInfo' | 'storeRefreshToken' | 'clientAuthenticationMethod'>;

export function managedOidcValidationMessage(validation: NonNullable<Validation>): string {
    return t(validation.code === 'issuer' ? 'identityAdministration.invalidIssuer'
        : validation.code === 'secret' ? 'identityAdministration.secretRequired'
            : validation.code === 'scopes' ? 'identityAdministration.invalidScopes' : 'identityAdministration.required');
}

export const ManagedOidcProviderFields = React.memo(function ManagedOidcProviderFields(props: Readonly<{
    draft: ManagedOidcProviderDraft;
    ownerKind?: 'home' | 'team';
    isEdit: boolean;
    advanced: boolean;
    editable: boolean;
    onAdvancedChange: (advanced: boolean) => void;
    onChange: <K extends keyof ManagedOidcProviderDraft>(key: K, value: ManagedOidcProviderDraft[K]) => void;
    inputRefs?: ManagedOidcProviderInputRefs;
    validation?: Validation;
    testIdPrefix?: string;
}>) {
    const prefix = props.testIdPrefix ?? 'identity-provider';
    const settings = props.ownerKind === 'team' ? TEAM_MANAGED_OIDC_SETTINGS : HOME_MANAGED_OIDC_SETTINGS;
    const [authenticationMenuOpen, setAuthenticationMenuOpen] = React.useState(false);
    const field = (key: TextDraftKey, id: string, input: Partial<FieldTextInputProps> = {}, subtitle?: string) => (
        <SettingRow setting={settings.settings[key]} subtitle={subtitle} subtitleLines={0} accessoryLayout={input.multiline ? 'stacked' : 'adaptive'} showChevron={false} rightElement={
            <FieldTextInput {...input} ref={props.inputRefs?.[key]} testID={`${prefix}-${id}`} accessibilityLabel={t(settings.settings[key].titleKey)} value={props.draft[key]} editable={props.editable} error={props.validation?.field === key ? managedOidcValidationMessage(props.validation) : null} onChangeText={(value) => props.onChange(key, value)} />
        } />
    );
    return <>
        <SettingSection section={settings.sectionRefs.configuration}><ItemGroup title={t('identityAdministration.configuration')}>
            {field('displayName', 'name')}
            {field('issuer', 'issuer')}
            {field('clientId', 'client-id')}
            {field('clientSecret', 'client-secret', { secureTextEntry: true, autoComplete: 'off' }, props.isEdit ? t('identityAdministration.secretRetain') : undefined)}
        </ItemGroup></SettingSection>
        <SettingSection section={settings.sectionRefs.advanced}><ItemGroup>
            <ExpandableItem expanded={props.advanced} onExpandedChange={props.onAdvancedChange} header={({ headerProps }) => <Item onPress={headerProps.onPress} accessibilityRole={headerProps.accessibilityRole} accessibilityExpanded={headerProps.accessibilityState.expanded} testID={`${prefix}-advanced-toggle`} title={t(props.advanced ? 'identityAdministration.hideAdvanced' : 'identityAdministration.advanced')} showChevron={false} />}>
                {props.advanced ? <>
                    <SettingAnchor setting={settings.settings.clientAuthenticationMethod}><DropdownMenu
                        testID={`${prefix}-client-authentication`}
                        open={authenticationMenuOpen}
                        onOpenChange={setAuthenticationMenuOpen}
                        selectedId={props.draft.clientAuthenticationMethod}
                        items={[
                            { id: 'client_secret_post', title: t('identityAdministration.clientSecretPost') },
                            { id: 'client_secret_basic', title: t('identityAdministration.clientSecretBasic') },
                        ]}
                        itemTrigger={{ title: t('identityAdministration.clientAuthenticationMethod'), itemProps: { disabled: !props.editable } }}
                        onSelect={(value) => {
                            if (props.editable && (value === 'client_secret_post' || value === 'client_secret_basic')) props.onChange('clientAuthenticationMethod', value);
                        }}
                    /></SettingAnchor>
                    {field('scopes', 'scopes')}
                    {field('loginClaim', 'login-claim')}
                    {field('emailClaim', 'email-claim')}
                    {field('groupsClaim', 'groups-claim')}
                    <SettingRow setting={settings.settings.fetchUserInfo} showChevron={false} rightElement={<Switch testID={`${prefix}-fetch-user-info`} value={props.draft.fetchUserInfo} disabled={!props.editable} onValueChange={(value) => props.onChange('fetchUserInfo', value)} />} />
                    <SettingRow setting={settings.settings.storeRefreshToken} showChevron={false} rightElement={<Switch testID={`${prefix}-store-refresh-token`} value={props.draft.storeRefreshToken} disabled={!props.editable} onValueChange={(value) => props.onChange('storeRefreshToken', value)} />} />
                    {field('usersAllowlist', 'allowed-users', { multiline: true }, t('identityAdministration.allowRulesHint'))}
                    {field('emailDomains', 'allowed-domains', { multiline: true })}
                    {field('groupsAny', 'groups-any', { multiline: true })}
                    {field('groupsAll', 'groups-all', { multiline: true })}
                    {field('buttonColor', 'button-color', {}, t('identityAdministration.brandingHint'))}
                    {field('iconHint', 'icon-hint')}
                </> : null}
            </ExpandableItem>
        </ItemGroup></SettingSection>
    </>;
});
