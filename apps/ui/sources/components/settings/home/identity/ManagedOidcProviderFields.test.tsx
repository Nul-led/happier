import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { Switch } from '@/components/ui/forms/Switch';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { ManagedOidcProviderFields } from './ManagedOidcProviderFields';
import { EMPTY_MANAGED_OIDC_PROVIDER_DRAFT } from './managedOidcProviderDraft';

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock().module;
});

describe('shared OIDC fields', () => {
    it('renders advanced options as accessible form controls with field-local validation', async () => {
        const onChange = vi.fn();
        const screen = await renderScreen(<ManagedOidcProviderFields
            draft={EMPTY_MANAGED_OIDC_PROVIDER_DRAFT} isEdit={false} advanced editable
            onAdvancedChange={vi.fn()} onChange={onChange}
            validation={{ code: 'scopes', field: 'scopes' }}
        />);
        expect(screen.findByTestId('identity-provider-scopes')?.props.accessibilityHint).toBeTruthy();
        const switches = screen.findAllByType(Switch);
        expect(switches).toHaveLength(2);
        switches[1].props.onValueChange(true);
        expect(onChange).toHaveBeenCalledWith('storeRefreshToken', true);
        screen.findByType(DropdownMenu).props.onSelect('client_secret_basic');
        expect(onChange).toHaveBeenCalledWith('clientAuthenticationMethod', 'client_secret_basic');
        const toggle = screen.findHostByTestId('identity-provider-advanced-toggle');
        expect(toggle?.props['aria-expanded'] ?? toggle?.props.accessibilityState?.expanded).toBe(true);
        for (const name of ['allowed-users', 'allowed-domains', 'groups-any', 'groups-all', 'button-color', 'icon-hint']) {
            expect(screen.findByTestId(`identity-provider-${name}`)).not.toBeNull();
        }
    });
});
