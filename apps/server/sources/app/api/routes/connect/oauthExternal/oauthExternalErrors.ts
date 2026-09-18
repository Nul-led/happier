export const OAUTH_NOT_CONFIGURED_ERROR = "oauth_not_configured";
export const PROVIDER_ALREADY_LINKED_ERROR = "provider-already-linked";
export const RECOVERY_DISABLED_ERROR = "recovery-disabled";
export const AUTH_PROVIDER_CONFIGURATION_CHANGED_ERROR = "auth_provider_configuration_changed";

export class OAuthProviderConfigurationChangedError extends Error {
    constructor(readonly pendingKey: string) {
        super(AUTH_PROVIDER_CONFIGURATION_CHANGED_ERROR);
        this.name = "OAuthProviderConfigurationChangedError";
    }
}
